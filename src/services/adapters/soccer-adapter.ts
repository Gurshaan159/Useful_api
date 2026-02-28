import { Situation, SituationByGameStatLine, SituationInputs, SituationMatchedStart, SituationStatLine } from "../../domain/situation";
import { InvalidRequestError } from "../../lib/errors";
import { LiveSportEventSummary, SportradarSoccerClient } from "../../integrations/sportradar-soccer-client";
import { addStatLines, divideStatLine, emptyStats, pickNumeric } from "./stats";
import { AnalysisResult, FocusEntity, NormalizedEvent, SportAdapter } from "./sport-adapter";

type SoccerEvent = NormalizedEvent & {
  eventId: string;
  teamId?: string;
  teamName?: string;
  scoreForTeam?: number;
  scoreAgainstTeam?: number;
  playersInvolved?: string[];
};

export class SoccerAdapter implements SportAdapter {
  readonly sport = "soccer" as const;

  constructor(private readonly client: SportradarSoccerClient) {}

  async getHistoricalGameIds(inputs: SituationInputs): Promise<string[]> {
    return this.client.getHistoricalGameIds(inputs, inputs.limits.maxGames);
  }

  async getRawGameEvents(gameId: string): Promise<unknown> {
    return this.client.getSportEventTimeline(gameId);
  }

  resolveFocusPlayerId(rawUpstream: unknown, focusEntity: FocusEntity): string | null {
    const root = asObject(rawUpstream);
    const competitors = asArray(asObject(root.sport_event).competitors) ?? [];
    const token = focusEntity.team?.trim().toLowerCase();
    if (!token) {
      return null;
    }
    for (const competitor of competitors) {
      const row = asObject(competitor);
      const id = asString(row.id);
      const name = asString(row.name)?.toLowerCase();
      const abbr = asString(row.abbreviation)?.toLowerCase();
      if ((id && id.toLowerCase().includes(token)) || name === token || abbr === token) {
        return id ?? null;
      }
    }
    return null;
  }

  normalizeEvents(rawUpstream: unknown, gameIdHint?: string): SoccerEvent[] {
    const root = asObject(rawUpstream);
    const sportEvent = asObject(root.sport_event);
    const gameId = asString(sportEvent.id) ?? gameIdHint ?? "unknown";
    const timeline = asArray(root.timeline) ?? asArray(root.events) ?? [];
    const events: SoccerEvent[] = [];
    for (let i = 0; i < timeline.length; i += 1) {
      const row = asObject(timeline[i]);
      const minute = pickNumeric(row.match_time ?? row.minute ?? row.time, 0);
      const period = pickNumeric(row.period ?? row.match_clock, minute > 45 ? 2 : 1);
      const outcome = asObject(row.outcome);
      const team = asObject(row.team);
      const players = asArray(row.players) ?? [];
      const score = asObject(row.score);
      const homeScore = pickNumeric(score.home, pickNumeric(row.home_score, 0));
      const awayScore = pickNumeric(score.away, pickNumeric(row.away_score, 0));
      const statsDelta = inferSoccerDelta(row);
      events.push({
        gameId,
        eventId: asString(row.id) ?? `${gameId}-${i}`,
        sequence: pickNumeric(row.order ?? row.sequence, i),
        periodOrHalf: period <= 1 ? 1 : 2,
        minuteOrClock: minute,
        scoreFor: homeScore,
        scoreAgainst: awayScore,
        type: asString(row.type) ?? asString(outcome.type) ?? "event",
        description: asString(row.description),
        actorPlayerId: asString(asObject(row.player).id) ?? asString(asObject(players[0]).id),
        actorPlayerName: asString(asObject(row.player).name) ?? asString(asObject(players[0]).name),
        statsDelta,
        teamId: asString(team.id),
        teamName: asString(team.name),
        playersInvolved: players.map((p) => asString(asObject(p).id)).filter((x): x is string => !!x),
      });
    }
    events.sort((a, b) => a.sequence - b.sequence);
    return events;
  }

  detectStartPoints(events: SoccerEvent[], filters: SituationInputs["filters"]): SituationMatchedStart[] {
    if (!filters.soccer) {
      throw new InvalidRequestError("filters.soccer is required for sport='soccer'.");
    }
    const starts: SituationMatchedStart[] = [];
    let wasInWindow = false;
    for (const event of events) {
      if (event.periodOrHalf !== filters.soccer.half) {
        continue;
      }
      const goalDiff = event.scoreFor - event.scoreAgainst;
      const scoreState = goalDiff > 0 ? "leading" : goalDiff < 0 ? "trailing" : "drawing";
      const minuteInRange = event.minuteOrClock >= filters.soccer.minuteRange.gte
        && event.minuteOrClock <= filters.soccer.minuteRange.lte;
      const goalDiffInRange = filters.soccer.goalDiffRange
        ? goalDiff >= filters.soccer.goalDiffRange.gte && goalDiff <= filters.soccer.goalDiffRange.lte
        : true;
      const inWindow = minuteInRange && goalDiffInRange && scoreState === filters.soccer.scoreState;
      if (!wasInWindow && inWindow) {
        starts.push({
          gameId: event.gameId,
          half: event.periodOrHalf as 1 | 2,
          minute: event.minuteOrClock,
          goalDiffAtStart: goalDiff,
        });
      }
      wasInWindow = inWindow;
    }
    return starts;
  }

  computeStatsAfterStart(events: SoccerEvent[], startPoint: SituationMatchedStart, focusEntity: FocusEntity): SituationStatLine {
    const startIndex = events.findIndex((event) =>
      event.gameId === startPoint.gameId
      && event.periodOrHalf === startPoint.half
      && event.minuteOrClock >= (startPoint.minute ?? 0));
    if (startIndex < 0) {
      return emptyStats(["goals", "assists", "shots", "yellowCards", "redCards", "substitutions"]);
    }
    let totals = emptyStats(["goals", "assists", "shots", "yellowCards", "redCards", "substitutions"]);
    const targetName = focusEntity.playerName.trim().toLowerCase();
    for (let i = startIndex; i < events.length; i += 1) {
      const event = events[i];
      const matchesPlayer = !!focusEntity.playerId && (event.actorPlayerId === focusEntity.playerId
        || event.playersInvolved?.includes(focusEntity.playerId))
        || (!!event.actorPlayerName && event.actorPlayerName.trim().toLowerCase() === targetName);
      if (!matchesPlayer) {
        continue;
      }
      totals = addStatLines(totals, event.statsDelta ?? emptyStats());
    }
    return totals;
  }

  aggregate(statBundles: SituationStatLine[]): SituationStatLine {
    let totals = emptyStats(["goals", "assists", "shots", "yellowCards", "redCards", "substitutions"]);
    for (const bundle of statBundles) {
      totals = addStatLines(totals, bundle);
    }
    return totals;
  }

  exportCsv(situation: Situation): string {
    const keys = inferCsvKeys(situation);
    const rows = [...situation.stats.byGame].sort((a, b) => a.gameId.localeCompare(b.gameId));
    const lines: string[] = [];
    lines.push(`# situationId,${escapeCsv(situation.id)}`);
    lines.push(`gameId,${keys.join(",")}`);
    for (const row of rows) {
      lines.push([escapeCsv(row.gameId), ...keys.map((key) => `${row.stats[key as keyof SituationStatLine] ?? 0}`)].join(","));
    }
    return `${lines.join("\n")}\n`;
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

export function mapLiveEventSummaryToGameResponse(summary: LiveSportEventSummary): Record<string, unknown> {
  return {
    sportEventId: summary.sportEventId,
    scheduled: summary.scheduled ?? null,
    status: summary.status ?? null,
    homeTeam: summary.homeName ?? summary.homeAlias ?? null,
    awayTeam: summary.awayName ?? summary.awayAlias ?? null,
    score: summary.homeScore != null && summary.awayScore != null ? `${summary.homeScore}-${summary.awayScore}` : null,
    competition: summary.competition ?? null,
  };
}

function inferSoccerDelta(event: Record<string, unknown>): SituationStatLine {
  const type = (asString(event.type) ?? "").toLowerCase();
  const base = emptyStats(["goals", "assists", "shots", "yellowCards", "redCards", "substitutions"]);
  if (type.includes("goal")) {
    base.goals = 1;
    base.shots = 1;
    return base;
  }
  if (type.includes("assist")) {
    base.assists = 1;
    return base;
  }
  if (type.includes("shot")) {
    base.shots = 1;
    return base;
  }
  if (type.includes("yellow")) {
    base.yellowCards = 1;
    return base;
  }
  if (type.includes("red")) {
    base.redCards = 1;
    return base;
  }
  if (type.includes("substitution")) {
    base.substitutions = 1;
    return base;
  }
  return base;
}

function inferCsvKeys(situation: Situation): string[] {
  const set = new Set<string>();
  for (const key of Object.keys(situation.stats.totals)) {
    set.add(key);
  }
  for (const row of situation.stats.byGame) {
    for (const key of Object.keys(row.stats)) {
      set.add(key);
    }
  }
  return [...set];
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
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
