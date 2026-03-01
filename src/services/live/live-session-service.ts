import { InvalidRequestError, NotFoundError, UpstreamError } from "../../lib/errors";
import {
  extractLiveSportEvents,
  LiveSportEventSummary,
  SportradarSoccerClient,
} from "../../integrations/sportradar-soccer-client";
import { OpenAiClient } from "../../integrations/openai-client";
import { mapLiveEventSummaryToGameResponse, SoccerAdapter } from "../adapters/soccer-adapter";
import { CreateLiveSessionInput, InMemoryLiveSessionStore, LiveSession } from "./live-session-store";
import { SportradarClient } from "../../integrations/sportradar-client";
import { createConcurrencyLimiter } from "../../lib/concurrency-limiter";
import { normalizePlayByPlay } from "../normalization";
import { SituationStatLine } from "../../domain/situation";
import { addStatLines, emptyStats } from "../adapters/stats";

type StreamMessageType = "event" | "insight" | "narration" | "status" | "error";

export interface StreamMessage {
  type: StreamMessageType;
  ts: string;
  data: Record<string, unknown>;
}

type Subscriber = (message: StreamMessage) => void;

export interface CreateSessionRequest {
  sport: "soccer" | "nba";
  sportEventId: string;
  focusPlayerId?: string;
  focusPlayerName?: string;
  preferences?: {
    verbosity?: "short" | "medium" | "high";
  };
}

export interface NbaLiveAnalysisRequest {
  sportEventId: string;
  focusPlayerId?: string;
  focusPlayerName?: string;
  verbosity?: "short" | "medium" | "high";
}

export interface SoccerLiveAnalysisRequest {
  sportEventId: string;
  focusPlayerId?: string;
  focusPlayerName?: string;
  verbosity?: "short" | "medium" | "high";
}

export class LiveSessionService {
  private readonly subscribersBySession = new Map<string, Set<Subscriber>>();
  private readonly timersBySession = new Map<string, NodeJS.Timeout>();
  private readonly seenEventIdsBySession = new Map<string, Set<string>>();
  private readonly verbosityBySession = new Map<string, "short" | "medium" | "high">();
  private readonly nbaStateBySession = new Map<string, {
    historical: { pts: number; ast: number; reb: number; threePm: number; sampleSize: number };
    lastEventKey?: string;
    lastNarrationAtMs?: number;
  }>();

  constructor(
    private readonly store: InMemoryLiveSessionStore,
    private readonly soccerClient: SportradarSoccerClient,
    private readonly nbaClient: SportradarClient,
    private readonly openAiClient: OpenAiClient,
  ) {}

  async getLiveGames(sport: "soccer" | "nba"): Promise<Array<Record<string, unknown>>> {
    if (sport === "nba") {
      // Query adjacent UTC dates to avoid missing late local games near midnight UTC.
      const dayOffsets = [-1, 0, 1];
      const allGames = await Promise.all(dayOffsets.map(async (offset) => {
        const date = new Date(Date.now() + (offset * 24 * 60 * 60 * 1000));
        return this.nbaClient.getDailyScheduleGames(date);
      }));
      const uniqueByGameId = new Map<string, (typeof allGames)[number][number]>();
      for (const games of allGames) {
        for (const game of games) {
          uniqueByGameId.set(game.gameId, game);
        }
      }
      const inProgressGames = [...uniqueByGameId.values()].filter((game) => isNbaInProgress(game.status));
      const limit = createConcurrencyLimiter(3);
      const enriched = await Promise.all(inProgressGames.map((game) => limit(async () => {
        const payload = await this.nbaClient.getGamePlayByPlay(game.gameId);
        const analysis = extractNbaLiveAnalysis(payload);
        return {
          sportEventId: game.gameId,
          scheduled: game.scheduled ?? null,
          status: game.status ?? null,
          homeTeam: game.homeTeam ?? null,
          awayTeam: game.awayTeam ?? null,
          score: analysis.score ?? (game.homeScore != null && game.awayScore != null ? `${game.homeScore}-${game.awayScore}` : null),
          competition: "NBA",
          analysis,
        };
      })));
      return enriched;
    }
    const payload = await this.soccerClient.getLiveSchedules();
    return extractLiveSportEvents(payload)
      .filter((game) => isSoccerInProgress(game.status))
      .map(mapLiveEventSummaryToGameResponse);
  }

  async getPlayersForGame(sportEventId: string, sport: "soccer" | "nba"): Promise<Array<Record<string, unknown>>> {
    if (sport === "nba") {
      return this.getNbaPlayersForGame(sportEventId);
    }
    const timeline = await this.soccerClient.getSportEventTimeline(sportEventId);
    const playersFromExtended = extractPlayersFromSportEventTimeline(timeline);
    if (playersFromExtended.length > 0) {
      return playersFromExtended;
    }

    const livePayload = await this.soccerClient.getLiveTimelines();
    const playersFromLive = extractPlayersFromLiveTimelines(livePayload, sportEventId);
    return playersFromLive;
  }

  async analyzeNbaPlayerLive(input: NbaLiveAnalysisRequest): Promise<Record<string, unknown>> {
    const payload = await this.nbaClient.getGamePlayByPlay(input.sportEventId);
    const normalized = normalizePlayByPlay(payload);
    const focusPlayer = resolveNbaFocusPlayer(normalized, input.focusPlayerId, input.focusPlayerName);
    if (!focusPlayer) {
      throw new InvalidRequestError("Focus player not found in this live game.", {
        sportEventId: input.sportEventId,
        focusPlayerId: input.focusPlayerId,
        focusPlayerName: input.focusPlayerName,
      });
    }
    const currentTotals = accumulateNbaPlayerTotals(normalized, focusPlayer.id);
    const elapsedSeconds = inferElapsedSeconds(normalized);
    const projectedFinal = {
      pts: projectByPace(currentTotals.pts, elapsedSeconds, 48 * 60),
      ast: projectByPace(currentTotals.ast, elapsedSeconds, 48 * 60),
      reb: projectByPace(currentTotals.reb, elapsedSeconds, 48 * 60),
      threePm: projectByPace(currentTotals.threePm, elapsedSeconds, 48 * 60),
    };

    const historical = await this.computeNbaHistoricalAverages(input.sportEventId, focusPlayer.id, focusPlayer.teamId);
    const prediction = {
      pts: blendProjection(projectedFinal.pts, historical.pts),
      ast: blendProjection(projectedFinal.ast, historical.ast),
      reb: blendProjection(projectedFinal.reb, historical.reb),
      threePm: blendProjection(projectedFinal.threePm, historical.threePm),
    };
    const confidence = historical.sampleSize >= 5 ? "medium" : "low";

    let narration: any;
    try {
      narration = await this.openAiClient.createNarration({
        focusPlayer: focusPlayer.name,
        verbosity: input.verbosity ?? "short",
        context: [
          `NBA live analysis for ${focusPlayer.name}`,
          `Current totals: pts ${currentTotals.pts}, ast ${currentTotals.ast}, reb ${currentTotals.reb}, 3pm ${currentTotals.threePm}`,
          `Projected final by pace: pts ${projectedFinal.pts}, ast ${projectedFinal.ast}, reb ${projectedFinal.reb}, 3pm ${projectedFinal.threePm}`,
          `Historical averages (sample ${historical.sampleSize}): pts ${historical.pts}, ast ${historical.ast}, reb ${historical.reb}, 3pm ${historical.threePm}`,
          `Blended prediction: pts ${prediction.pts}, ast ${prediction.ast}, reb ${prediction.reb}, 3pm ${prediction.threePm}`,
        ].join("\n"),
      });
    } catch (error) {
      narration = {
        narration: `Live analysis generated for ${focusPlayer.name}. OpenAI narration unavailable for this request.`,
        bullets: [],
        callouts: [{ type: "warning", text: error instanceof Error ? error.message : "Narration unavailable" }],
      };
    }

    return {
      sport: "nba",
      sportEventId: input.sportEventId,
      player: {
        playerId: focusPlayer.id,
        name: focusPlayer.name,
        teamId: focusPlayer.teamId ?? null,
      },
      live: {
        elapsedSeconds,
        currentTotals,
      },
      historical: {
        averages: historical,
      },
      prediction: {
        projectedFinal,
        blendedPrediction: prediction,
        confidence,
      },
      narration,
    };
  }

  async analyzeSoccerPlayerLive(input: SoccerLiveAnalysisRequest): Promise<Record<string, unknown>> {
    const timeline = await this.soccerClient.getSportEventTimeline(input.sportEventId);
    const soccerAdapter = new SoccerAdapter(this.soccerClient);
    const events = soccerAdapter.normalizeEvents(timeline, input.sportEventId);

    const focus = resolveSoccerFocusPlayer(events, input.focusPlayerId, input.focusPlayerName)
      ?? pickSoccerFocusPlayer(events);
    if (!focus) {
      throw new InvalidRequestError("Focus player not found in this live game.", {
        sportEventId: input.sportEventId,
        focusPlayerId: input.focusPlayerId,
        focusPlayerName: input.focusPlayerName,
      });
    }

    const currentTotals = accumulateSoccerPlayerTotals(events, focus.id, focus.name);
    const elapsedMinutes = inferSoccerElapsedMinutes(events);
    const matchEnded = isMatchEnded(timeline);

    const projectedFinal = matchEnded
      ? {
          goals: currentTotals.goals ?? 0,
          assists: currentTotals.assists ?? 0,
          shots: currentTotals.shots ?? 0,
          touches: currentTotals.touches ?? 0,
        }
      : {
          goals: projectSoccerByPace(currentTotals.goals ?? 0, elapsedMinutes, 90),
          assists: projectSoccerByPace(currentTotals.assists ?? 0, elapsedMinutes, 90),
          shots: projectSoccerByPace(currentTotals.shots ?? 0, elapsedMinutes, 90),
          touches: projectSoccerByPace(currentTotals.touches ?? 0, elapsedMinutes, 90),
        };

    const historical = await computeSoccerHistoricalAverages(
      this.soccerClient,
      input.sportEventId,
      focus.id,
      focus.name,
      focus.teamId ?? null,
      timeline,
    );
    const prediction = {
      goals: blendProjection(projectedFinal.goals, historical.goals),
      assists: blendProjection(projectedFinal.assists, historical.assists),
      shots: blendProjection(projectedFinal.shots, historical.shots),
      touches: blendProjection(projectedFinal.touches, historical.touches),
    };
    const confidence = historical.sampleSize >= 5 ? "medium" : "low";

    let narration: Record<string, unknown>;
    try {
      const openAiNarration = await this.openAiClient.createNarration({
        focusPlayer: focus.name,
        verbosity: input.verbosity ?? "short",
        context: [
          `Soccer live analysis for ${focus.name}`,
          `Current: goals ${currentTotals.goals ?? 0}, assists ${currentTotals.assists ?? 0}, shots ${currentTotals.shots ?? 0}, touches ${currentTotals.touches ?? 0}`,
          `Projected final: goals ${projectedFinal.goals}, assists ${projectedFinal.assists}, shots ${projectedFinal.shots}, touches ${projectedFinal.touches}`,
          `Historical per 90 (sample ${historical.sampleSize}): goals ${historical.goals}, assists ${historical.assists}, shots ${historical.shots}, touches ${historical.touches}`,
        ].join("\n"),
      });
      narration = openAiNarration as unknown as Record<string, unknown>;
    } catch (error) {
      narration = {
        narration: `Live analysis for ${focus.name}. OpenAI narration unavailable.`,
        bullets: [],
        callouts: [{ type: "warning", text: error instanceof Error ? error.message : "Narration unavailable" }],
      };
    }

    return {
      sport: "soccer",
      sportEventId: input.sportEventId,
      player: {
        playerId: focus.id,
        name: focus.name,
        teamId: focus.teamId ?? null,
      },
      live: {
        elapsedMinutes,
        currentTotals: {
          goals: currentTotals.goals ?? 0,
          assists: currentTotals.assists ?? 0,
          shots: currentTotals.shots ?? 0,
          touches: currentTotals.touches ?? 0,
        },
      },
      historical: { averages: historical },
      prediction: {
        projectedFinal,
        blendedPrediction: prediction,
        confidence,
      },
      matchEnded,
      narration,
    };
  }

  createSession(input: CreateSessionRequest): { id: string } {
    if (input.sport !== "soccer" && input.sport !== "nba") {
      throw new InvalidRequestError("Unsupported sport for live sessions.");
    }
    if (input.sport === "nba" && !input.focusPlayerId && !input.focusPlayerName) {
      throw new InvalidRequestError("NBA live sessions require focusPlayerId or focusPlayerName.");
    }
    const sessionInput: CreateLiveSessionInput = {
      sport: input.sport,
      sportEventId: input.sportEventId,
      focusPlayerId: input.focusPlayerId,
      focusPlayerName: input.focusPlayerName,
    };
    const session = this.store.create(sessionInput);
    this.verbosityBySession.set(session.id, input.preferences?.verbosity ?? "short");
    if (!input.focusPlayerId && !input.focusPlayerName) {
      this.store.update(session.id, {
        warnings: ["FOCUS_PLAYER_NOT_FOUND"],
      });
    }
    return { id: session.id };
  }

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    const session = this.store.getById(sessionId);
    if (!session) {
      throw new NotFoundError("Live session not found.", { id: sessionId });
    }
    const set = this.subscribersBySession.get(sessionId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribersBySession.set(sessionId, set);
    this.ensureSessionLoop(session);

    subscriber({
      type: "status",
      ts: new Date().toISOString(),
      data: {
        sessionId,
        status: session.status,
        warnings: session.warnings,
      },
    });

    return () => {
      const current = this.subscribersBySession.get(sessionId);
      if (!current) {
        return;
      }
      current.delete(subscriber);
      if (current.size === 0) {
        this.subscribersBySession.delete(sessionId);
      }
    };
  }

  private ensureSessionLoop(session: LiveSession): void {
    if (session.sport === "nba") {
      this.ensureNbaSessionLoop(session);
      return;
    }
    if (this.timersBySession.has(session.id)) {
      return;
    }
    this.store.update(session.id, { status: "running" });
    this.runSimilarityJob(session.id).catch((error) => {
      this.emit(session.id, {
        type: "error",
        ts: new Date().toISOString(),
        data: {
          code: "INSIGHT_JOB_FAILED",
          message: error instanceof Error ? error.message : "Similarity job failed",
        },
      });
    });

    const timer = setInterval(() => {
      this.tickSession(session.id).catch((error) => {
        this.emit(session.id, {
          type: "error",
          ts: new Date().toISOString(),
          data: {
            code: "LIVE_POLL_FAILED",
            message: error instanceof Error ? error.message : "Polling failed.",
          },
        });
      });
    }, 7_000);
    timer.unref();
    this.timersBySession.set(session.id, timer);
  }

  private ensureNbaSessionLoop(session: LiveSession): void {
    if (this.timersBySession.has(session.id)) {
      return;
    }
    this.store.update(session.id, { status: "running" });
    const timer = setInterval(() => {
      this.tickNbaSession(session.id).catch((error) => {
        this.emit(session.id, {
          type: "error",
          ts: new Date().toISOString(),
          data: {
            code: "LIVE_POLL_FAILED",
            message: error instanceof Error ? error.message : "NBA polling failed.",
          },
        });
      });
    }, 10_000);
    timer.unref();
    this.timersBySession.set(session.id, timer);
    this.tickNbaSession(session.id).catch(() => {});
  }

  private async tickSession(sessionId: string): Promise<void> {
    const session = this.store.getById(sessionId);
    if (!session) {
      return;
    }

    const payload = await this.soccerClient.getSportEventTimeline(session.sportEventId);
    const events = extractTimelineEvents(payload);
    const seen = this.seenEventIdsBySession.get(sessionId) ?? new Set<string>();
    this.seenEventIdsBySession.set(sessionId, seen);
    const focusName = session.focusPlayerName?.trim().toLowerCase();
    const focusId = session.focusPlayerId;
    const freshEvents = events
      .filter((event) => !seen.has(event.eventId))
      .map((event) => ({
        ...event,
        focusPlayerInvolved: (!!focusId && event.playersInvolved.includes(focusId))
          || (!!focusName && !!event.playerName && event.playerName.trim().toLowerCase() === focusName),
      }));
    for (const event of freshEvents) {
      seen.add(event.eventId);
      this.emit(sessionId, {
        type: "event",
        ts: new Date().toISOString(),
        data: {
          minute: event.minute,
          eventType: event.eventType,
          description: event.description,
          team: event.team,
          playersInvolved: event.playersInvolved,
          scoreSnapshot: event.scoreSnapshot,
          focusPlayerInvolved: event.focusPlayerInvolved,
        },
      });
      if (event.focusPlayerInvolved) {
        this.emit(sessionId, {
          type: "insight",
          ts: new Date().toISOString(),
          data: {
            focusHighlight: `${event.playerName ?? "Focus player"} involved in ${event.eventType} at ${event.minute}'.`,
          },
        });
      }
    }

    const maybeEnded = isMatchEnded(payload);
    if (maybeEnded) {
      this.store.update(sessionId, { status: "ended" });
      this.emit(sessionId, {
        type: "status",
        ts: new Date().toISOString(),
        data: {
          status: "ended",
          reason: "sport_event_not_live",
        },
      });
      this.stopSessionLoop(sessionId);
      return;
    }

    await this.maybeNarrate(sessionId, freshEvents);
  }

  private stopSessionLoop(sessionId: string): void {
    const timer = this.timersBySession.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.timersBySession.delete(sessionId);
    }
  }

  private async tickNbaSession(sessionId: string): Promise<void> {
    const session = this.store.getById(sessionId);
    if (!session || session.sport !== "nba") {
      return;
    }
    const payload = await this.nbaClient.getGamePlayByPlay(session.sportEventId);
    const root = asObject(payload);
    const status = (asString(root.status) ?? "").toLowerCase();
    if (!isNbaInProgress(status)) {
      this.store.update(sessionId, { status: "ended" });
      this.emit(sessionId, {
        type: "status",
        ts: new Date().toISOString(),
        data: {
          status: "ended",
          reason: "sport_event_not_live",
        },
      });
      this.stopSessionLoop(sessionId);
      return;
    }

    const normalized = normalizePlayByPlay(payload);
    const focus = resolveNbaFocusPlayer(normalized, session.focusPlayerId, session.focusPlayerName);
    if (!focus) {
      this.emit(sessionId, {
        type: "error",
        ts: new Date().toISOString(),
        data: {
          code: "FOCUS_PLAYER_NOT_FOUND",
          message: "Focus player not found in current NBA game payload.",
        },
      });
      return;
    }

    const liveAnalysis = extractNbaLiveAnalysis(payload);
    const eventKey = `${liveAnalysis.period ?? "na"}|${liveAnalysis.clock ?? "na"}|${liveAnalysis.score ?? "na"}|${liveAnalysis.lastEvent ?? ""}`;
    const state = this.nbaStateBySession.get(sessionId) ?? {
      historical: { pts: 0, ast: 0, reb: 0, threePm: 0, sampleSize: 0 },
    };
    if (!state.historical.sampleSize) {
      state.historical = await this.computeNbaHistoricalAverages(session.sportEventId, focus.id, focus.teamId);
    }

    const currentTotals = accumulateNbaPlayerTotals(normalized, focus.id);
    const elapsedSeconds = inferElapsedSeconds(normalized);
    const projectedFinal = {
      pts: projectByPace(currentTotals.pts, elapsedSeconds, 48 * 60),
      ast: projectByPace(currentTotals.ast, elapsedSeconds, 48 * 60),
      reb: projectByPace(currentTotals.reb, elapsedSeconds, 48 * 60),
      threePm: projectByPace(currentTotals.threePm, elapsedSeconds, 48 * 60),
    };
    const blendedPrediction = {
      pts: blendProjection(projectedFinal.pts, state.historical.pts),
      ast: blendProjection(projectedFinal.ast, state.historical.ast),
      reb: blendProjection(projectedFinal.reb, state.historical.reb),
      threePm: blendProjection(projectedFinal.threePm, state.historical.threePm),
    };
    const confidence = state.historical.sampleSize >= 5 ? "medium" : "low";

    if (state.lastEventKey !== eventKey) {
      this.emit(sessionId, {
        type: "event",
        ts: new Date().toISOString(),
        data: {
          ...liveAnalysis,
          focusPlayer: {
            playerId: focus.id,
            name: focus.name,
          },
        },
      });
      state.lastEventKey = eventKey;
    }

    this.emit(sessionId, {
      type: "insight",
      ts: new Date().toISOString(),
      data: {
        focusPlayer: {
          playerId: focus.id,
          name: focus.name,
        },
        live: {
          elapsedSeconds,
          currentTotals,
        },
        prediction: {
          projectedFinal,
          blendedPrediction,
          confidence,
        },
        historical: state.historical,
      },
    });

    const nowMs = Date.now();
    if (!state.lastNarrationAtMs || nowMs - state.lastNarrationAtMs >= 15_000) {
      try {
        const narration = await this.openAiClient.createNarration({
          focusPlayer: focus.name,
          verbosity: this.verbosityBySession.get(sessionId) ?? "short",
          context: [
            `NBA live session update`,
            `Game: ${liveAnalysis.summary ?? "n/a"}`,
            `Current ${focus.name}: pts ${currentTotals.pts}, ast ${currentTotals.ast}, reb ${currentTotals.reb}, 3pm ${currentTotals.threePm}`,
            `Predicted final: pts ${blendedPrediction.pts}, ast ${blendedPrediction.ast}, reb ${blendedPrediction.reb}, 3pm ${blendedPrediction.threePm}`,
          ].join("\n"),
        });
        this.emit(sessionId, {
          type: "narration",
          ts: new Date().toISOString(),
          data: narration as unknown as Record<string, unknown>,
        });
      } catch (error) {
        this.emit(sessionId, {
          type: "error",
          ts: new Date().toISOString(),
          data: {
            code: "UPSTREAM_ERROR",
            message: error instanceof Error ? error.message : "Narration unavailable.",
          },
        });
      }
      state.lastNarrationAtMs = nowMs;
    }

    this.nbaStateBySession.set(sessionId, state);
  }

  private emit(sessionId: string, message: StreamMessage): void {
    const subscribers = this.subscribersBySession.get(sessionId);
    if (!subscribers) {
      return;
    }
    for (const subscriber of subscribers) {
      subscriber(message);
    }
  }

  private async runSimilarityJob(sessionId: string): Promise<void> {
    const session = this.store.getById(sessionId);
    if (!session) {
      return;
    }
    const live = await this.soccerClient.getLiveSchedules();
    const games = extractLiveSportEvents(live).slice(0, 30);
    const similar = games
      .filter((game) => game.sportEventId !== session.sportEventId)
      .slice(0, 5)
      .map((game, index) => ({
        sportEventId: game.sportEventId,
        distance: 0.2 + index * 0.15,
      }));

    const trends = {
      nextGoalIn10MinChance: Math.round((0.18 + similar.length * 0.07) * 100) / 100,
      focusPlayerSubChance: 0.22,
    };
    this.store.update(sessionId, {
      predictionState: {
        similarMatches: similar,
        trends,
        confidence: similar.length >= 4 ? "med" : "low",
      },
    });
    this.emit(sessionId, {
      type: "insight",
      ts: new Date().toISOString(),
      data: {
        similarMatches: similar,
        trends,
        confidence: similar.length >= 4 ? "med" : "low",
      },
    });
  }

  private async getNbaPlayersForGame(gameId: string): Promise<Array<Record<string, unknown>>> {
    const payload = await this.nbaClient.getGamePlayByPlay(gameId);
    const normalized = normalizePlayByPlay(payload);
    const touchCountByPlayer = new Map<string, number>();
    for (const event of normalized.events) {
      for (const playerId of Object.keys(event.playerStats)) {
        touchCountByPlayer.set(playerId, (touchCountByPlayer.get(playerId) ?? 0) + 1);
      }
    }
    return normalized.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      teamId: player.teamId ?? null,
      teamName: player.teamAlias ?? null,
      position: null,
      jerseyNumber: null,
      isActive: (touchCountByPlayer.get(player.id) ?? 0) > 0,
      touches: touchCountByPlayer.get(player.id) ?? 0,
    }));
  }

  private async computeNbaHistoricalAverages(
    currentGameId: string,
    playerId: string,
    playerTeamId?: string,
  ): Promise<{ pts: number; ast: number; reb: number; threePm: number; sampleSize: number }> {
    const currentYear = new Date().getUTCFullYear();
    const schedule = await this.loadNbaScheduleFallback(currentYear);
    const filtered = schedule
      .filter((game) => game.gameId !== currentGameId)
      .filter((game) => (game.status ?? "").toLowerCase() === "closed" || (game.status ?? "").toLowerCase() === "complete")
      .filter((game) => !playerTeamId
        || game.homeTeamId === playerTeamId
        || game.awayTeamId === playerTeamId)
      .slice(0, 6);
    const limit = createConcurrencyLimiter(2);
    const settled = await Promise.all(filtered.map((game) => limit(async () => {
      try {
        const payload = await this.nbaClient.getGamePlayByPlay(game.gameId);
        const normalized = normalizePlayByPlay(payload);
        return accumulateNbaPlayerTotals(normalized, playerId);
      } catch {
        return null;
      }
    })));
    const games = settled.filter((x): x is { pts: number; ast: number; reb: number; threePm: number } => x != null);
    if (games.length === 0) {
      return { pts: 0, ast: 0, reb: 0, threePm: 0, sampleSize: 0 };
    }
    const totals = games.reduce(
      (acc, game) => ({
        pts: acc.pts + game.pts,
        ast: acc.ast + game.ast,
        reb: acc.reb + game.reb,
        threePm: acc.threePm + game.threePm,
      }),
      { pts: 0, ast: 0, reb: 0, threePm: 0 },
    );
    const sampleSize = games.length;
    return {
      pts: round2(totals.pts / sampleSize),
      ast: round2(totals.ast / sampleSize),
      reb: round2(totals.reb / sampleSize),
      threePm: round2(totals.threePm / sampleSize),
      sampleSize,
    };
  }

  private async loadNbaScheduleFallback(year: number): Promise<Array<{ gameId: string; status?: string; homeTeamId?: string; awayTeamId?: string }>> {
    const attempts = [year, year - 1, year + 1];
    for (const y of attempts) {
      try {
        return await this.nbaClient.getScheduleGames({ year: y, type: "REG" });
      } catch (_error) {
        continue;
      }
    }
    return [];
  }

  private async maybeNarrate(
    sessionId: string,
    freshEvents: Array<{
      eventType: string;
      description: string;
      minute: number;
      scoreSnapshot?: string;
      focusPlayerInvolved: boolean;
    }>,
  ): Promise<void> {
    const session = this.store.getById(sessionId);
    if (!session) {
      return;
    }
    const nowMs = Date.now();
    if (session.lastNarrationAtMs && nowMs - session.lastNarrationAtMs < 15_000) {
      return;
    }
    const hasMajorEvent = freshEvents.some((event) => {
      const type = event.eventType.toLowerCase();
      return type.includes("goal") || type.includes("red") || type.includes("penalty");
    });
    const hasFresh = freshEvents.length > 0;
    if (!hasMajorEvent && !hasFresh) {
      return;
    }
    const context = freshEvents
      .slice(-5)
      .map((event) => `${event.minute}' ${event.eventType}: ${event.description} (${event.scoreSnapshot ?? "n/a"})`)
      .join("\n");

    try {
      const narration = await this.openAiClient.createNarration({
        focusPlayer: session.focusPlayerName ?? session.focusPlayerId ?? "the selected player",
        context: `${context}\nTrends: ${JSON.stringify(session.predictionState.trends)}`,
        verbosity: this.verbosityBySession.get(sessionId) ?? "short",
      });
      this.store.update(sessionId, {
        narrativeState: narration.narration,
        lastNarrationAtMs: nowMs,
      });
      this.emit(sessionId, {
        type: "narration",
        ts: new Date().toISOString(),
        data: narration as unknown as Record<string, unknown>,
      });
    } catch (error) {
      if (error instanceof UpstreamError) {
        this.emit(sessionId, {
          type: "error",
          ts: new Date().toISOString(),
          data: {
            code: error.code,
            message: error.message,
            details: error.details as Record<string, unknown> | undefined,
          },
        });
      }
    }
  }
}

function extractTimelineEvents(payload: unknown): Array<{
  eventId: string;
  minute: number;
  eventType: string;
  description: string;
  team?: string;
  playersInvolved: string[];
  playerName?: string;
  scoreSnapshot?: string;
  focusPlayerInvolved: boolean;
}> {
  const root = asObject(payload);
  const timeline = asArray(root.timeline) ?? [];
  return timeline.map((entry, index) => {
    const row = asObject(entry);
    const players = asArray(row.players) ?? [];
    const playerIds = players
      .map((player) => asString(asObject(player).id))
      .filter((x): x is string => !!x);
    const score = asObject(row.score);
    const scoreSnapshot = score.home != null && score.away != null ? `${score.home}-${score.away}` : undefined;
    return {
      eventId: asString(row.id) ?? `evt_${index}`,
      minute: asNumber(row.match_time) ?? asNumber(row.minute) ?? 0,
      eventType: asString(row.type) ?? "event",
      description: asString(row.description) ?? "",
      team: asString(asObject(row.team).name),
      playersInvolved: playerIds,
      playerName: asString(asObject(row.player).name),
      scoreSnapshot,
      focusPlayerInvolved: false,
    };
  });
}

function extractPlayersFromSportEventTimeline(payload: unknown): Array<Record<string, unknown>> {
  const root = asObject(payload);
  const lineups = asArray(root.lineups) ?? [];
  const timeline = asArray(root.timeline) ?? [];
  const players = new Map<string, Record<string, unknown>>();
  for (const lineup of lineups) {
    const row = asObject(lineup);
    const team = asObject(row.team);
    for (const player of asArray(row.players) ?? []) {
      const p = asObject(player);
      const id = asString(p.id);
      if (!id) {
        continue;
      }
      players.set(id, {
        playerId: id,
        name: asString(p.name) ?? null,
        teamId: asString(team.id) ?? null,
        teamName: asString(team.name) ?? null,
        position: asString(p.type) ?? null,
        jerseyNumber: asString(p.jersey_number) ?? null,
      });
    }
  }
  for (const event of timeline) {
    const row = asObject(event);
    const team = asObject(row.team);
    const actor = asObject(row.player);
    const id = asString(actor.id);
    if (!id || players.has(id)) {
      continue;
    }
    players.set(id, {
      playerId: id,
      name: asString(actor.name) ?? null,
      teamId: asString(team.id) ?? null,
      teamName: asString(team.name) ?? null,
      position: null,
      jerseyNumber: null,
    });
  }
  return [...players.values()];
}

function extractPlayersFromLiveTimelines(payload: unknown, sportEventId: string): Array<Record<string, unknown>> {
  const events = extractLiveSportEvents(payload);
  const target = events.find((event) => event.sportEventId === sportEventId);
  if (!target) {
    return [];
  }
  return [
    {
      playerId: null,
      name: null,
      teamId: target.homeTeamId ?? null,
      teamName: target.homeName ?? target.homeAlias ?? null,
      position: null,
      jerseyNumber: null,
    },
    {
      playerId: null,
      name: null,
      teamId: target.awayTeamId ?? null,
      teamName: target.awayName ?? target.awayAlias ?? null,
      position: null,
      jerseyNumber: null,
    },
  ];
}

function isMatchEnded(payload: unknown): boolean {
  const root = asObject(payload);
  const status = asObject(root.sport_event_status);
  const candidate = (asString(status.match_status) ?? asString(status.status) ?? "").toLowerCase();
  return candidate.includes("ended")
    || candidate.includes("closed")
    || candidate.includes("complete")
    || candidate.includes("finished");
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function asArray(value: unknown): any[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isNbaInProgress(status?: string): boolean {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return normalized === "inprogress"
    || normalized === "in_progress"
    || normalized === "live"
    || normalized === "halftime";
}

function isSoccerInProgress(status?: string): boolean {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  if (
    normalized.includes("ended")
    || normalized.includes("closed")
    || normalized.includes("complete")
    || normalized.includes("finished")
    || normalized === "not_started"
    || normalized === "scheduled"
    || normalized === "postponed"
    || normalized === "cancelled"
    || normalized === "abandoned"
  ) {
    return false;
  }
  return true;
}

function extractNbaLiveAnalysis(payload: unknown): Record<string, unknown> {
  const root = asObject(payload);
  const home = asObject(root.home);
  const away = asObject(root.away);
  const events = extractNbaEvents(root);
  const latestScored = findLatestScoredEvent(events);
  const period = asNumber(latestScored?.period) ?? asNumber(latestScored?.quarter) ?? null;
  const clock = asString(latestScored?.clock ?? latestScored?.clock_remaining ?? root.clock) ?? null;
  const homeScore = asNumber(latestScored?.home_points) ?? asNumber(root.home_points) ?? asNumber(home.points) ?? null;
  const awayScore = asNumber(latestScored?.away_points) ?? asNumber(root.away_points) ?? asNumber(away.points) ?? null;
  const lastEventDescription = asString(
    latestScored?.description ?? latestScored?.clock_description ?? latestScored?.event_description,
  ) ?? null;

  const previousScored = latestScored ? findPreviousScoredEvent(events, latestScored.sequence) : null;
  const homeDelta = latestScored && previousScored
    ? (asNumber(latestScored.home_points) ?? homeScore ?? 0) - (asNumber(previousScored.home_points) ?? homeScore ?? 0)
    : 0;
  const awayDelta = latestScored && previousScored
    ? (asNumber(latestScored.away_points) ?? awayScore ?? 0) - (asNumber(previousScored.away_points) ?? awayScore ?? 0)
    : 0;
  const momentum = homeDelta > awayDelta ? "home" : awayDelta > homeDelta ? "away" : "even";

  const summary = buildNbaSummary(
    asString(home.name) ?? "Home",
    asString(away.name) ?? "Away",
    homeScore,
    awayScore,
    period,
    clock,
    lastEventDescription,
  );

  return {
    period,
    clock,
    score: homeScore != null && awayScore != null ? `${homeScore}-${awayScore}` : null,
    lastEvent: lastEventDescription,
    momentum,
    summary,
  };
}

function extractNbaEvents(root: Record<string, any>): Array<Record<string, any>> {
  const pbpEvents = asArray(asObject(root.pbp).events) ?? [];
  if (pbpEvents.length > 0) {
    return pbpEvents.map((x) => asObject(x));
  }
  const directEvents = asArray(root.events) ?? [];
  if (directEvents.length > 0) {
    return directEvents.map((x) => asObject(x));
  }
  const periods = asArray(root.periods) ?? [];
  const out: Array<Record<string, any>> = [];
  for (const period of periods) {
    const events = asArray(asObject(period).events) ?? [];
    for (const event of events) {
      out.push(asObject(event));
    }
  }
  return out;
}

function findLatestScoredEvent(events: Array<Record<string, any>>): Record<string, any> | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (asNumber(event.home_points) != null && asNumber(event.away_points) != null) {
      return event;
    }
  }
  return null;
}

function findPreviousScoredEvent(
  events: Array<Record<string, any>>,
  latestSequence: unknown,
): Record<string, any> | null {
  const latestSeq = asNumber(latestSequence);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (asNumber(event.home_points) == null || asNumber(event.away_points) == null) {
      continue;
    }
    const seq = asNumber(event.sequence);
    if (latestSeq == null || seq == null || seq < latestSeq) {
      return event;
    }
  }
  return null;
}

function buildNbaSummary(
  homeTeam: string,
  awayTeam: string,
  homeScore: number | null,
  awayScore: number | null,
  period: number | null,
  clock: string | null,
  lastEvent: string | null,
): string {
  const score = homeScore != null && awayScore != null ? `${homeTeam} ${homeScore}-${awayScore} ${awayTeam}` : `${homeTeam} vs ${awayTeam}`;
  const frame = period != null ? `Q${period}` : "live";
  const clockPart = clock ? ` ${clock}` : "";
  const eventPart = lastEvent ? ` Last: ${lastEvent}` : "";
  return `${score} (${frame}${clockPart}).${eventPart}`;
}

function resolveNbaFocusPlayer(
  game: ReturnType<typeof normalizePlayByPlay>,
  focusPlayerId?: string,
  focusPlayerName?: string,
): { id: string; name: string; teamId?: string } | null {
  if (focusPlayerId) {
    const byId = game.players.find((player) => player.id === focusPlayerId);
    if (byId) {
      return { id: byId.id, name: byId.name, teamId: byId.teamId };
    }
  }
  if (focusPlayerName) {
    const normalizedName = focusPlayerName.trim().toLowerCase();
    const byName = game.players.find((player) => player.name.trim().toLowerCase() === normalizedName);
    if (byName) {
      return { id: byName.id, name: byName.name, teamId: byName.teamId };
    }
  }
  return null;
}

function accumulateNbaPlayerTotals(
  game: ReturnType<typeof normalizePlayByPlay>,
  playerId: string,
): { pts: number; ast: number; reb: number; threePm: number } {
  const totals = { pts: 0, ast: 0, reb: 0, threePm: 0 };
  for (const event of game.events) {
    const delta = event.playerStats[playerId];
    if (!delta) {
      continue;
    }
    totals.pts += delta.pts ?? 0;
    totals.ast += delta.ast ?? 0;
    totals.reb += delta.reb ?? 0;
    totals.threePm += delta.threePm ?? 0;
  }
  return totals;
}

function inferElapsedSeconds(game: ReturnType<typeof normalizePlayByPlay>): number {
  const latest = game.events.reduce<{ period: number; clock: number } | null>((acc, event) => {
    if (event.clockSecondsRemaining == null) {
      return acc;
    }
    if (!acc) {
      return { period: event.period, clock: event.clockSecondsRemaining };
    }
    if (event.period > acc.period) {
      return { period: event.period, clock: event.clockSecondsRemaining };
    }
    if (event.period === acc.period && event.clockSecondsRemaining < acc.clock) {
      return { period: event.period, clock: event.clockSecondsRemaining };
    }
    return acc;
  }, null);
  if (!latest) {
    return 1;
  }
  const elapsed = (latest.period - 1) * 720 + (720 - latest.clock);
  return Math.max(1, elapsed);
}

function projectByPace(currentValue: number, elapsedSeconds: number, gameSeconds: number): number {
  const pace = currentValue / Math.max(1, elapsedSeconds);
  return round2(pace * gameSeconds);
}

function blendProjection(paceProjection: number, historicalAverage: number): number {
  if (historicalAverage <= 0) {
    return round2(paceProjection);
  }
  return round2((paceProjection * 0.6) + (historicalAverage * 0.4));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Soccer live analysis helpers
type SoccerNormalizedEvent = {
  actorPlayerId?: string;
  actorPlayerName?: string;
  playersInvolved?: string[];
  minuteOrClock: number;
  statsDelta?: { goals?: number; assists?: number; shots?: number; touches?: number };
  teamId?: string;
};

function resolveSoccerFocusPlayer(
  events: SoccerNormalizedEvent[],
  focusPlayerId?: string,
  focusPlayerName?: string,
): { id: string; name: string; teamId?: string } | null {
  const targetId = focusPlayerId?.trim();
  const targetName = focusPlayerName?.trim().toLowerCase();
  const idToName = new Map<string, string>();
  const idToTeam = new Map<string, string>();
  for (const event of events) {
    if (event.actorPlayerId && event.actorPlayerName) {
      idToName.set(event.actorPlayerId, event.actorPlayerName);
      if (event.teamId) idToTeam.set(event.actorPlayerId, event.teamId);
    }
    for (const pid of event.playersInvolved ?? []) {
      if (event.actorPlayerId === pid && event.actorPlayerName) {
        idToName.set(pid, event.actorPlayerName);
        if (event.teamId) idToTeam.set(pid, event.teamId);
      }
    }
  }
  if (targetId) {
    const name = idToName.get(targetId) ?? focusPlayerName ?? "Unknown";
    const teamId = idToTeam.get(targetId);
    const found = events.some(
      (e) =>
        e.actorPlayerId === targetId || e.playersInvolved?.includes(targetId),
    );
    if (found) return { id: targetId, name, teamId };
  }
  if (targetName) {
    for (const event of events) {
      const actorName = event.actorPlayerName?.trim().toLowerCase();
      if (actorName === targetName && event.actorPlayerId) {
        return {
          id: event.actorPlayerId,
          name: event.actorPlayerName ?? "Unknown",
          teamId: event.teamId,
        };
      }
    }
  }
  return null;
}

function pickSoccerFocusPlayer(events: SoccerNormalizedEvent[]): { id: string; name: string; teamId?: string } | null {
  const involvement = new Map<string, { touches: number; name?: string; teamId?: string }>();
  for (const event of events) {
    if (event.actorPlayerId) {
      const current = involvement.get(event.actorPlayerId) ?? { touches: 0 };
      involvement.set(event.actorPlayerId, {
        touches: current.touches + 1,
        name: event.actorPlayerName ?? current.name,
        teamId: event.teamId ?? current.teamId,
      });
    }
    for (const playerId of event.playersInvolved ?? []) {
      const current = involvement.get(playerId) ?? { touches: 0 };
      involvement.set(playerId, {
        touches: current.touches + 1,
        name: current.name,
        teamId: event.teamId ?? current.teamId,
      });
    }
  }
  let best: { id: string; touches: number; name?: string; teamId?: string } | null = null;
  for (const [id, row] of involvement.entries()) {
    if (!best || row.touches > best.touches) {
      best = { id, touches: row.touches, name: row.name, teamId: row.teamId };
    }
  }
  if (!best) {
    return null;
  }
  return {
    id: best.id,
    name: best.name ?? "Auto-selected focus player",
    teamId: best.teamId,
  };
}

function accumulateSoccerPlayerTotals(
  events: SoccerNormalizedEvent[],
  focusPlayerId: string,
  focusPlayerName: string,
): { goals: number; assists: number; shots: number; touches: number } {
  let totals: SituationStatLine = emptyStats(["goals", "assists", "shots", "touches"]);
  const targetName = focusPlayerName.trim().toLowerCase();
  for (const event of events) {
    const matches =
      event.actorPlayerId === focusPlayerId ||
      event.playersInvolved?.includes(focusPlayerId) ||
      (!!event.actorPlayerName && event.actorPlayerName.trim().toLowerCase() === targetName);
    if (matches) {
      totals = addStatLines(
        totals,
        {
          ...(event.statsDelta ?? {}),
          touches: 1,
        } as unknown as SituationStatLine,
      );
    }
  }
  return {
    goals: totals.goals ?? 0,
    assists: totals.assists ?? 0,
    shots: totals.shots ?? 0,
    touches: totals.touches ?? 0,
  };
}

function inferSoccerElapsedMinutes(events: SoccerNormalizedEvent[]): number {
  if (events.length === 0) return 1;
  const maxMinute = Math.max(...events.map((e) => e.minuteOrClock ?? 0));
  return Math.max(1, maxMinute);
}

function projectSoccerByPace(current: number, elapsedMinutes: number, gameMinutes: number): number {
  const pace = current / Math.max(1, elapsedMinutes);
  return round2(pace * gameMinutes);
}

function getTeamAbbreviationFromTimeline(payload: unknown, teamId: string): string | null {
  const root = asObject(payload);
  const sportEvent = asObject(root.sport_event);
  const competitors = asArray(sportEvent.competitors) ?? [];
  for (const c of competitors) {
    const row = asObject(c);
    if (asString(row.id) === teamId) {
      return asString(row.abbreviation) ?? asString(row.name) ?? null;
    }
  }
  return null;
}

async function computeSoccerHistoricalAverages(
  soccerClient: SportradarSoccerClient,
  currentGameId: string,
  playerId: string,
  playerName: string,
  teamId: string | null,
  timelinePayload: unknown,
): Promise<{ goals: number; assists: number; shots: number; touches: number; sampleSize: number }> {
  if (!teamId) {
    return { goals: 0, assists: 0, shots: 0, touches: 0, sampleSize: 0 };
  }
  const teamAbbr = getTeamAbbreviationFromTimeline(timelinePayload, teamId);
  if (!teamAbbr) {
    return { goals: 0, assists: 0, shots: 0, touches: 0, sampleSize: 0 };
  }
  const inputs = {
    sport: "soccer" as const,
    player: { name: playerName, team: teamAbbr },
    filters: {
      soccer: {
        half: 2 as const,
        minuteRange: { gte: 0, lte: 90 },
        scoreState: "drawing" as const,
        goalDiffRange: { gte: -10, lte: 10 },
      },
    },
    limits: { maxGames: 6, minStarts: 1, maxStartsPerGame: 1 },
  };
  let gameIds: string[];
  try {
    gameIds = await soccerClient.getHistoricalGameIds(inputs, 6);
  } catch {
    return { goals: 0, assists: 0, shots: 0, touches: 0, sampleSize: 0 };
  }
  gameIds = gameIds.filter((id) => id !== currentGameId).slice(0, 6);
  const soccerAdapter = new SoccerAdapter(soccerClient);
  const limit = createConcurrencyLimiter(2);
  const settled = await Promise.all(
    gameIds.map((gameId) =>
      limit(async () => {
        try {
          const raw = await soccerClient.getSportEventTimeline(gameId);
          const evts = soccerAdapter.normalizeEvents(raw, gameId);
          return accumulateSoccerPlayerTotals(evts as SoccerNormalizedEvent[], playerId, playerName);
        } catch {
          return null;
        }
      }),
    ),
  );
  const results = settled.filter((x): x is { goals: number; assists: number; shots: number; touches: number } => x != null);
  if (results.length === 0) {
    return { goals: 0, assists: 0, shots: 0, touches: 0, sampleSize: 0 };
  }
  const totals = results.reduce(
    (acc, r) => ({
      goals: acc.goals + r.goals,
      assists: acc.assists + r.assists,
      shots: acc.shots + r.shots,
      touches: acc.touches + r.touches,
    }),
    { goals: 0, assists: 0, shots: 0, touches: 0 },
  );
  const n = results.length;
  return {
    goals: round2(totals.goals / n),
    assists: round2(totals.assists / n),
    shots: round2(totals.shots / n),
    touches: round2(totals.touches / n),
    sampleSize: n,
  };
}
