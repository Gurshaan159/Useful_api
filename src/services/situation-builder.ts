import {
  MAX_MATCHED_STARTS,
  SITUATION_SCHEMA_VERSION,
  SKIP_REASONS,
  Situation,
  SituationByGameStatLine,
  SituationInputs,
  SituationMatchedStart,
  SkipReason,
  SituationStatLine,
} from "../domain/situation";
import { AmbiguousPlayerError } from "../lib/errors";
import { SportradarClient } from "../integrations/sportradar-client";
import { randomUUID } from "node:crypto";
import {
  addStats,
  divideStats,
  emptyStats,
  gameElapsedSeconds,
  normalizePlayByPlay,
  normalizePlayerName,
  NormalizedGame,
} from "./normalization";
import { getReliabilityGrade } from "./grading";

interface SituationBuilderDeps {
  sportradarClient: SportradarClient;
  now?: () => Date;
  idFactory?: () => string;
}

interface GameProcessingResult {
  starts: SituationMatchedStart[];
  totals: SituationStatLine;
  byGame: SituationByGameStatLine;
  skipReason?: SkipReason;
}

export class SituationBuilder {
  private readonly sportradarClient: SportradarClient;

  private readonly now: () => Date;

  private readonly idFactory: () => string;

  constructor(deps: SituationBuilderDeps) {
    this.sportradarClient = deps.sportradarClient;
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? (() => `sit_${randomUUID()}`);
  }

  async build(inputs: SituationInputs): Promise<Situation> {
    const gameIds = inputs.game?.id
      ? [inputs.game.id]
      : inputs.player.team
        ? await this.sportradarClient.getScheduleGameIdsForTeam(inputs.season!, inputs.player.team)
        : await this.sportradarClient.getScheduleGameIds(inputs.season!);

    const meta: Omit<Situation["meta"], "reliabilityGrade"> = {
      gamesScanned: 0,
      gamesUsed: 0,
      startsMatched: 0,
      gamesSkippedByReason: {
        PLAYER_NOT_IN_GAME: 0,
        PLAYER_TEAM_UNKNOWN: 0,
        SCORE_UNRELIABLE: 0,
        CLOCK_PARSE_FAIL: 0,
        UPSTREAM_PBP_MISSING: 0,
      },
      warnings: [] as string[],
    };

    const totals = emptyStats();
    const byGame = new Map<string, SituationByGameStatLine>();
    const matchedStarts: SituationMatchedStart[] = [];
    const state: {
      resolvedPlayerId: string | null;
      resolvedPlayerTeamId: string | null;
    } = {
      resolvedPlayerId: null,
      resolvedPlayerTeamId: null,
    };

    const maxScans = Math.min(inputs.limits.maxGames, gameIds.length);
    let nextIndex = 0;
    const workerCount = Math.min(4, maxScans);

    const worker = async (): Promise<void> => {
      while (true) {
        if (meta.startsMatched >= inputs.limits.minStarts || meta.gamesScanned >= maxScans) {
          return;
        }
        const index = nextIndex;
        nextIndex += 1;
        if (index >= maxScans) {
          return;
        }

        const gameId = gameIds[index];
        meta.gamesScanned += 1;

        const result = await this.processGame(gameId, inputs, state);
        if (result.skipReason) {
          meta.gamesSkippedByReason[result.skipReason] += 1;
          continue;
        }

        if (result.starts.length > 0) {
          meta.gamesUsed += 1;
        }

        for (const start of result.starts) {
          if (matchedStarts.length >= MAX_MATCHED_STARTS) {
            if (!meta.warnings.includes("MATCHED_STARTS_CAPPED")) {
              meta.warnings.push("MATCHED_STARTS_CAPPED");
            }
            break;
          }
          matchedStarts.push(start);
          meta.startsMatched += 1;
        }

        const newTotals = addStats(totals, result.totals);
        totals.pts = newTotals.pts;
        totals.ast = newTotals.ast;
        totals.reb = newTotals.reb;
        totals.threePm = newTotals.threePm;

        const currentByGame = byGame.get(result.byGame.gameId) ?? {
          gameId: result.byGame.gameId,
          pts: 0,
          ast: 0,
          reb: 0,
          threePm: 0,
        };
        const combinedByGame = addStats(currentByGame, result.byGame);
        byGame.set(result.byGame.gameId, {
          gameId: result.byGame.gameId,
          ...combinedByGame,
        });
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const perStart = divideStats(totals, meta.startsMatched);
    const reliabilityGrade = getReliabilityGrade(meta.startsMatched);

    const createdAt = this.now().toISOString();
    return {
      id: this.idFactory(),
      schemaVersion: SITUATION_SCHEMA_VERSION,
      createdAt,
      expiresAt: createdAt,
      status: "ready",
      inputs,
      meta: {
        ...meta,
        reliabilityGrade,
      },
      stats: {
        totals,
        perStart,
        byGame: [...byGame.values()],
      },
      matchedStarts,
    };
  }

  private async processGame(
    gameId: string,
    inputs: SituationInputs,
    state: { resolvedPlayerId: string | null; resolvedPlayerTeamId: string | null },
  ): Promise<GameProcessingResult> {
    const payload = await this.sportradarClient.getGamePlayByPlay(gameId);
    const normalized = normalizePlayByPlay(payload);
    if (normalized.events.length === 0) {
      return {
        starts: [],
        totals: emptyStats(),
        byGame: { gameId, ...emptyStats() },
        skipReason: "UPSTREAM_PBP_MISSING",
      };
    }

    const resolution = resolvePlayer(normalized, inputs.player.name, inputs.player.team);
    if (resolution.ambiguous) {
      throw new AmbiguousPlayerError(`Multiple players matched name '${inputs.player.name}'.`, {
        candidates: resolution.candidates.map((x) => x.name),
      });
    }
    if (!resolution.playerId) {
      return {
        starts: [],
        totals: emptyStats(),
        byGame: { gameId, ...emptyStats() },
        skipReason: "PLAYER_NOT_IN_GAME",
      };
    }

    const playerId = state.resolvedPlayerId ?? resolution.playerId;
    state.resolvedPlayerId = playerId;
    const playerTeamId = state.resolvedPlayerTeamId ?? resolution.teamId;
    if (!playerTeamId) {
      return {
        starts: [],
        totals: emptyStats(),
        byGame: { gameId, ...emptyStats() },
        skipReason: "PLAYER_TEAM_UNKNOWN",
      };
    }
    state.resolvedPlayerTeamId = playerTeamId;

    const hasScoreData = normalized.events.some((event) => event.homeScore != null && event.awayScore != null);
    if (!hasScoreData) {
      return {
        starts: [],
        totals: emptyStats(),
        byGame: { gameId, ...emptyStats() },
        skipReason: "SCORE_UNRELIABLE",
      };
    }

    const starts: SituationMatchedStart[] = [];
    let totals = emptyStats();
    let wasInWindow = false;
    let lastAcceptedElapsed = -1_000_000;
    let clockParseFailed = false;

    const scoreboard = {
      homeScore: 0,
      awayScore: 0,
      initialized: false,
    };

    for (let i = 0; i < normalized.events.length; i += 1) {
      const event = normalized.events[i];
      if (event.homeScore != null && event.awayScore != null) {
        scoreboard.homeScore = event.homeScore;
        scoreboard.awayScore = event.awayScore;
        scoreboard.initialized = true;
      }

      if (event.period !== inputs.filters.quarter) {
        continue;
      }
      if (event.clockSecondsRemaining == null) {
        clockParseFailed = true;
        continue;
      }
      if (!scoreboard.initialized) {
        continue;
      }

      const scoreDiffAtEvent = getScoreDiffForTeam(normalized, scoreboard.homeScore, scoreboard.awayScore, playerTeamId);
      const inWindow =
        event.clockSecondsRemaining >= inputs.filters.timeRemainingSeconds.gte
        && event.clockSecondsRemaining <= inputs.filters.timeRemainingSeconds.lte
        && scoreDiffAtEvent >= inputs.filters.scoreDiff.gte
        && scoreDiffAtEvent <= inputs.filters.scoreDiff.lte;

      const elapsed = gameElapsedSeconds(event.period, event.clockSecondsRemaining);
      const separatedBy60s = elapsed - lastAcceptedElapsed >= 60;
      const canTakeMoreStarts = starts.length < inputs.limits.maxStartsPerGame;
      const shouldAccept = !wasInWindow && inWindow && separatedBy60s && canTakeMoreStarts;

      if (shouldAccept) {
        const start: SituationMatchedStart = {
          gameId,
          period: event.period,
          clockSecondsRemaining: event.clockSecondsRemaining,
          scoreDiffAtStart: scoreDiffAtEvent,
        };
        starts.push(start);
        lastAcceptedElapsed = elapsed;
        totals = addStats(totals, aggregatePlayerStatsFromIndex(normalized, playerId, i));
      }
      wasInWindow = inWindow;
    }

    if (starts.length === 0 && clockParseFailed) {
      return {
        starts: [],
        totals: emptyStats(),
        byGame: { gameId, ...emptyStats() },
        skipReason: "CLOCK_PARSE_FAIL",
      };
    }

    return { starts, totals, byGame: { gameId, ...totals } };
  }
}

function aggregatePlayerStatsFromIndex(game: NormalizedGame, playerId: string, startIndex: number): SituationStatLine {
  let total = emptyStats();
  for (let i = startIndex; i < game.events.length; i += 1) {
    const delta = game.events[i].playerStats[playerId];
    if (!delta) {
      continue;
    }
    total = addStats(total, delta);
  }
  return total;
}

function resolvePlayer(game: NormalizedGame, requestedName: string, requestedTeam?: string): {
  playerId: string | null;
  teamId: string | null;
  ambiguous: boolean;
  candidates: Array<{ id: string; name: string }>;
} {
  const normalizedRequestedName = normalizePlayerName(requestedName);
  const requestedTeamNorm = requestedTeam?.trim().toLowerCase();
  const exactMatches = game.players.filter((player) => normalizePlayerName(player.name) === normalizedRequestedName);

  const filteredByTeam = requestedTeamNorm
    ? exactMatches.filter((player) => {
        const teamIdNorm = player.teamId?.toLowerCase();
        const teamAliasNorm = player.teamAlias?.toLowerCase();
        return (
          (!!teamIdNorm && teamIdNorm.includes(requestedTeamNorm))
          || (!!teamAliasNorm && teamAliasNorm.includes(requestedTeamNorm))
        );
      })
    : exactMatches;
  const candidates = requestedTeamNorm && filteredByTeam.length === 0 ? exactMatches : filteredByTeam;

  if (candidates.length > 1) {
    return {
      playerId: null,
      teamId: null,
      ambiguous: true,
      candidates: candidates.map((x) => ({ id: x.id, name: x.name })),
    };
  }
  if (candidates.length === 1) {
    const chosen = candidates[0];
    const resolvedTeamId = chosen.teamId ?? resolveTeamIdFromAlias(game, chosen.teamAlias);
    return {
      playerId: chosen.id,
      teamId: resolvedTeamId ?? null,
      ambiguous: false,
      candidates: [],
    };
  }

  return { playerId: null, teamId: null, ambiguous: false, candidates: [] };
}

function resolveTeamIdFromAlias(game: NormalizedGame, teamAlias?: string): string | null {
  if (!teamAlias) {
    return null;
  }
  const normalizedAlias = teamAlias.trim().toLowerCase();
  if (game.homeTeamAlias?.toLowerCase() === normalizedAlias) {
    return game.homeTeamId ?? null;
  }
  if (game.awayTeamAlias?.toLowerCase() === normalizedAlias) {
    return game.awayTeamId ?? null;
  }
  return null;
}

function getScoreDiffForTeam(
  game: NormalizedGame,
  homeScore: number,
  awayScore: number,
  playerTeamId: string,
): number {
  if (game.homeTeamId && game.homeTeamId === playerTeamId) {
    return homeScore - awayScore;
  }
  if (game.awayTeamId && game.awayTeamId === playerTeamId) {
    return awayScore - homeScore;
  }
  return 0;
}
