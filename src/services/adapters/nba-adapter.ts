import { Situation, SituationInputs, SituationMatchedStart, SituationStatLine } from "../../domain/situation";
import { AmbiguousPlayerError, InvalidRequestError } from "../../lib/errors";
import { extractScheduleGames, SportradarClient } from "../../integrations/sportradar-client";
import {
  gameElapsedSeconds,
  normalizePlayByPlay,
  normalizePlayerName,
} from "../normalization";
import { buildGamesCsv, sortAndLimitGames } from "../situation-games";
import { addStatLines, divideStatLine, emptyStats } from "./stats";
import { AnalysisResult, FocusEntity, NormalizedEvent, SportAdapter } from "./sport-adapter";

type NbaEvent = NormalizedEvent & {
  _playerStatsById: Record<string, SituationStatLine>;
  _playerTeamId?: string;
};

export class NbaAdapter implements SportAdapter {
  readonly sport = "nba" as const;

  constructor(private readonly client: SportradarClient) {}

  async getHistoricalGameIds(inputs: SituationInputs): Promise<string[]> {
    if (inputs.game?.id) {
      return [inputs.game.id];
    }
    if (!inputs.season) {
      throw new InvalidRequestError("season is required when game is not provided.");
    }
    if (inputs.player.team) {
      return this.client.getScheduleGameIdsForTeam(inputs.season, inputs.player.team);
    }
    return this.client.getScheduleGameIds(inputs.season);
  }

  async getRawGameEvents(gameId: string): Promise<unknown> {
    return this.client.getGamePlayByPlay(gameId);
  }

  resolveFocusPlayerId(rawUpstream: unknown, focusEntity: FocusEntity): string | null {
    const normalized = normalizePlayByPlay(rawUpstream);
    const resolution = resolveNbaPlayer(normalized, focusEntity.playerName, focusEntity.team);
    if (resolution.ambiguous) {
      throw new AmbiguousPlayerError(`Multiple players matched name '${focusEntity.playerName}'.`, {
        candidates: resolution.candidates.map((x) => x.name),
      });
    }
    return resolution.playerId ? resolution.playerId : null;
  }

  normalizeEvents(rawUpstream: unknown): NbaEvent[] {
    const normalized = normalizePlayByPlay(rawUpstream);
    return normalized.events.map((event) => ({
      gameId: event.gameId,
      sequence: event.sequence,
      periodOrHalf: event.period,
      minuteOrClock: event.clockSecondsRemaining ?? 0,
      scoreFor: event.homeScore ?? 0,
      scoreAgainst: event.awayScore ?? 0,
      type: "play",
      _playerStatsById: event.playerStats,
    }));
  }

  detectStartPoints(
    events: NbaEvent[],
    filters: SituationInputs["filters"],
    _focusEntity: FocusEntity,
  ): SituationMatchedStart[] {
    if (!filters.nba) {
      throw new InvalidRequestError("filters.nba is required for sport='nba'.");
    }
    const starts: SituationMatchedStart[] = [];
    let wasInWindow = false;
    let lastAcceptedElapsed = -1_000_000;
    for (const event of events) {
      const clock = event.minuteOrClock;
      if (event.periodOrHalf !== filters.nba.quarter) {
        continue;
      }
      const scoreDiffAtEvent = event.scoreFor - event.scoreAgainst;
      const inWindow = clock >= filters.nba.timeRemainingSeconds.gte
        && clock <= filters.nba.timeRemainingSeconds.lte
        && scoreDiffAtEvent >= filters.nba.scoreDiff.gte
        && scoreDiffAtEvent <= filters.nba.scoreDiff.lte;
      const elapsed = gameElapsedSeconds(event.periodOrHalf, clock);
      const separatedBy60s = elapsed - lastAcceptedElapsed >= 60;
      if (!wasInWindow && inWindow && separatedBy60s) {
        starts.push({
          gameId: event.gameId,
          period: event.periodOrHalf,
          clockSecondsRemaining: clock,
          scoreDiffAtStart: scoreDiffAtEvent,
        });
        lastAcceptedElapsed = elapsed;
      }
      wasInWindow = inWindow;
    }
    return starts;
  }

  computeStatsAfterStart(events: NbaEvent[], startPoint: SituationMatchedStart, focusEntity: FocusEntity): SituationStatLine {
    const startIndex = events.findIndex(
      (event) => event.gameId === startPoint.gameId
        && event.periodOrHalf === startPoint.period
        && event.minuteOrClock === startPoint.clockSecondsRemaining,
    );
    if (startIndex < 0) {
      return emptyStats(["pts", "reb", "ast", "threePm"]);
    }
    const totals = emptyStats(["pts", "reb", "ast", "threePm"]);
    const playerId = focusEntity.playerId;
    if (!playerId) {
      return totals;
    }
    for (let i = startIndex; i < events.length; i += 1) {
      const delta = events[i]._playerStatsById[playerId];
      if (!delta) {
        continue;
      }
      const combined = addStatLines(totals, delta);
      totals.pts = combined.pts ?? 0;
      totals.reb = combined.reb ?? 0;
      totals.ast = combined.ast ?? 0;
      totals.threePm = combined.threePm ?? 0;
    }
    return totals;
  }

  aggregate(statBundles: SituationStatLine[]): SituationStatLine {
    let totals = emptyStats(["pts", "reb", "ast", "threePm"]);
    for (const bundle of statBundles) {
      totals = addStatLines(totals, bundle);
    }
    return totals;
  }

  exportCsv(situation: Situation): string {
    const rows = sortAndLimitGames(situation.stats.byGame as any, "pts", "desc");
    return buildGamesCsv(
      situation.id,
      rows as any,
      true,
      situation.stats.totals as any,
      situation.stats.perStart as any,
    );
  }

  analysis(situation: Situation): AnalysisResult {
    return {
      gamesScanned: situation.meta.gamesScanned,
      gamesUsed: situation.meta.gamesUsed,
      startsMatched: situation.meta.startsMatched,
      reliabilityGrade: situation.meta.reliabilityGrade,
      totals: situation.stats.totals,
      perStart: situation.stats.perStart,
    };
  }
}

function resolveNbaPlayer(
  game: ReturnType<typeof normalizePlayByPlay>,
  requestedName: string,
  requestedTeam?: string,
): {
  playerId: string | null;
  teamId: string | null;
  ambiguous: boolean;
  candidates: Array<{ id: string; name: string }>;
} {
  const normalizedRequestedName = normalizePlayerName(requestedName);
  const requestedTeamNorm = requestedTeam?.trim().toLowerCase();
  const exactMatches = game.players.filter((player) => normalizePlayerName(player.name) === normalizedRequestedName);
  const filteredByTeam = requestedTeamNorm
    ? exactMatches.filter((player) =>
      player.teamId?.toLowerCase().includes(requestedTeamNorm) || player.teamAlias?.toLowerCase().includes(requestedTeamNorm))
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
    return {
      playerId: candidates[0].id,
      teamId: candidates[0].teamId ?? null,
      ambiguous: false,
      candidates: [],
    };
  }
  return { playerId: null, teamId: null, ambiguous: false, candidates: [] };
}
