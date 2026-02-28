import { SituationStatLine } from "../domain/situation";

export interface NormalizedPlayer {
  id: string;
  name: string;
  teamId?: string;
  teamAlias?: string;
}

export interface NormalizedEvent {
  gameId: string;
  sequence: number;
  period: number;
  clockSecondsRemaining: number | null;
  homeScore: number | null;
  awayScore: number | null;
  playerStats: Record<string, SituationStatLine>;
}

export interface NormalizedGame {
  gameId: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeamAlias?: string;
  awayTeamAlias?: string;
  players: NormalizedPlayer[];
  events: NormalizedEvent[];
}

export function emptyStats(): SituationStatLine {
  return {
    pts: 0,
    ast: 0,
    reb: 0,
    threePm: 0,
  };
}

export function addStats(a: SituationStatLine, b: SituationStatLine): SituationStatLine {
  return {
    pts: a.pts + b.pts,
    ast: a.ast + b.ast,
    reb: a.reb + b.reb,
    threePm: a.threePm + b.threePm,
  };
}

export function divideStats(stats: SituationStatLine, divisor: number): SituationStatLine {
  if (divisor <= 0) {
    return emptyStats();
  }
  return {
    pts: round2(stats.pts / divisor),
    ast: round2(stats.ast / divisor),
    reb: round2(stats.reb / divisor),
    threePm: round2(stats.threePm / divisor),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseClockToSeconds(clock: unknown): number | null {
  if (typeof clock === "number" && Number.isFinite(clock)) {
    if (clock < 0 || clock > 720) {
      return null;
    }
    return clock;
  }
  if (typeof clock !== "string") {
    return null;
  }
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(clock.trim());
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const total = minutes * 60 + seconds;
  if (total < 0 || total > 720) {
    return null;
  }
  return total;
}

export function normalizePlayerName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function gameElapsedSeconds(period: number, clockSecondsRemaining: number): number {
  return (period - 1) * 720 + (720 - clockSecondsRemaining);
}

export function normalizePlayByPlay(payload: unknown): NormalizedGame {
  const source = asObject(payload);
  const sourceGame = asObject(source.game);
  const sourceHome = asObject(source.home);
  const sourceAway = asObject(source.away);
  const gameHome = asObject(sourceGame.home);
  const gameAway = asObject(sourceGame.away);
  const sourcePbp = asObject(source.pbp);

  const gameId = asString(source.id) ?? asString(sourceGame.id) ?? asString(source.game_id) ?? "unknown";
  const homeTeamId = asString(sourceHome.id) ?? asString(gameHome.id) ?? undefined;
  const awayTeamId = asString(sourceAway.id) ?? asString(gameAway.id) ?? undefined;
  const homeTeamAlias = asString(sourceHome.alias) ?? asString(gameHome.alias) ?? undefined;
  const awayTeamAlias = asString(sourceAway.alias) ?? asString(gameAway.alias) ?? undefined;
  const periods = asArray(source.periods) ?? [];
  const players = extractPlayers(source);
  const eventsRaw: Array<{ row: Record<string, any>; periodHint: number | null }> = [];
  const rootEvents = asArray(source.events) ?? asArray(source.plays) ?? asArray(sourcePbp.events) ?? [];
  for (const eventRaw of rootEvents) {
    eventsRaw.push({ row: asObject(eventRaw), periodHint: null });
  }
  for (const periodRaw of periods) {
    const period = asObject(periodRaw);
    const periodNumber = asNumber(period.number) ?? asNumber(period.period) ?? null;
    for (const eventRaw of asArray(period.events) ?? []) {
      eventsRaw.push({ row: asObject(eventRaw), periodHint: periodNumber });
    }
  }

  const events: NormalizedEvent[] = [];
  const cumulativeByPlayer: Record<string, SituationStatLine> = {};
  for (let i = 0; i < eventsRaw.length; i += 1) {
    const row = eventsRaw[i].row;
    const period = asNumber(row.period) ?? asNumber(row.quarter) ?? eventsRaw[i].periodHint;
    if (!period) {
      continue;
    }
    const clockSecondsRemaining = parseClockToSeconds(row.clock ?? row.clock_remaining ?? row.time);
    const score = extractScore(row);
    events.push({
      gameId,
      sequence: asNumber(row.sequence) ?? i,
      period,
      clockSecondsRemaining,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
      playerStats: extractPlayerStats(row, cumulativeByPlayer),
    });
  }

  events.sort((a, b) => a.sequence - b.sequence);
  return { gameId, homeTeamId, awayTeamId, homeTeamAlias, awayTeamAlias, players, events };
}

function extractPlayers(source: Record<string, unknown>): NormalizedPlayer[] {
  const sourceGame = asObject(source.game);
  const sourceHome = asObject(source.home);
  const sourceAway = asObject(source.away);
  const playersRaw = asArray(source.players)
    ?? asArray(sourceGame.players)
    ?? asArray(sourceHome.players)
    ?? [];
  const sourcePeriods = asArray(source.periods) ?? [];
  const out: NormalizedPlayer[] = [];

  const pushPlayers = (list: unknown[], teamId?: string): void => {
    for (const item of list) {
      const row = asObject(item);
      const id = asString(row.id);
      const name = asString(row.full_name) ?? asString(row.name);
      if (!id || !name) {
        continue;
      }
      out.push({
        id,
        name,
        teamId: asString(row.team?.id) ?? asString(row.team_id) ?? teamId,
        teamAlias: asString(row.team?.alias) ?? asString(row.team_alias) ?? undefined,
      });
    }
  };

  pushPlayers(playersRaw);
  pushPlayers(asArray(sourceHome.players) ?? [], asString(sourceHome.id) ?? undefined);
  pushPlayers(asArray(sourceAway.players) ?? [], asString(sourceAway.id) ?? undefined);
  for (const periodRaw of sourcePeriods) {
    const period = asObject(periodRaw);
    for (const eventRaw of asArray(period.events) ?? []) {
      const event = asObject(eventRaw);
      for (const statRaw of asArray(event.statistics) ?? []) {
        const stat = asObject(statRaw);
        const statPlayer = asObject(stat.player);
        const statTeam = asObject(stat.team);
        const id = asString(statPlayer.id) ?? asString(stat.player_id) ?? asString(stat.id);
        const name = asString(statPlayer.full_name) ?? asString(stat.full_name) ?? asString(stat.name);
        if (!id || !name) {
          continue;
        }
        out.push({
          id,
          name,
          teamId: asString(statTeam.id) ?? asString(stat.team_id) ?? undefined,
          teamAlias: asString(statTeam.alias) ?? asString(stat.team_alias) ?? undefined,
        });
      }
    }
  }

  const dedup = new Map<string, NormalizedPlayer>();
  for (const p of out) {
    if (!dedup.has(p.id)) {
      dedup.set(p.id, p);
    }
  }
  return [...dedup.values()];
}

function extractScore(event: Record<string, unknown>): { homeScore: number | null; awayScore: number | null } {
  const score = asObject(event.score);
  const fromHome = asNumber(event.home_points) ?? asNumber(event.home_score) ?? asNumber(score.home);
  const fromAway = asNumber(event.away_points) ?? asNumber(event.away_score) ?? asNumber(score.away);
  if (fromHome != null && fromAway != null) {
    return { homeScore: fromHome, awayScore: fromAway };
  }
  return { homeScore: null, awayScore: null };
}

function extractPlayerStats(
  event: Record<string, unknown>,
  cumulativeByPlayer: Record<string, SituationStatLine>,
): Record<string, SituationStatLine> {
  const out: Record<string, SituationStatLine> = {};

  const rawMap = asObject(event.playerStats);
  for (const [playerId, value] of Object.entries(rawMap)) {
    const row = asObject(value);
    out[playerId] = {
      pts: asNumber(row.pts) ?? 0,
      ast: asNumber(row.ast) ?? 0,
      reb: asNumber(row.reb) ?? 0,
      threePm: asNumber(row.threePm) ?? asNumber(row.three_pm) ?? 0,
    };
  }

  const eventType = asString(event.event_type) ?? "";
  const statsList = asArray(event.statistics) ?? [];
  for (const stat of statsList) {
    const row = asObject(stat);
    const rowPlayer = asObject(row.player);
    const playerId = asString(rowPlayer.id) ?? asString(row.player_id) ?? asString(row.id);
    if (!playerId) {
      continue;
    }

    const inferred = inferStatDeltaFromPlay(row, eventType);
    if (inferred.pts !== 0 || inferred.ast !== 0 || inferred.reb !== 0 || inferred.threePm !== 0) {
      const line = out[playerId] ?? emptyStats();
      line.pts += inferred.pts;
      line.ast += inferred.ast;
      line.reb += inferred.reb;
      line.threePm += inferred.threePm;
      out[playerId] = line;
      const previousInferred = cumulativeByPlayer[playerId] ?? emptyStats();
      cumulativeByPlayer[playerId] = addStats(previousInferred, inferred);
      continue;
    }

    const previous = cumulativeByPlayer[playerId] ?? emptyStats();
    const pointsDelta = toDelta(
      asNumber(row.pts_delta),
      asNumber(row.points),
      previous.pts,
    );
    const assistsDelta = toDelta(
      asNumber(row.ast_delta),
      asNumber(row.assists),
      previous.ast,
    );
    const reboundsDelta = toDelta(
      asNumber(row.reb_delta),
      asNumber(row.rebounds),
      previous.reb,
    );
    const threesDelta = toDelta(
      asNumber(row.three_pm_delta),
      asNumber(row.three_points_made) ?? asNumber(row.three_pointers_made),
      previous.threePm,
    );
    const line = out[playerId] ?? emptyStats();
    line.pts += pointsDelta;
    line.ast += assistsDelta;
    line.reb += reboundsDelta;
    line.threePm += threesDelta;
    out[playerId] = line;
    cumulativeByPlayer[playerId] = {
      pts: previous.pts + pointsDelta,
      ast: previous.ast + assistsDelta,
      reb: previous.reb + reboundsDelta,
      threePm: previous.threePm + threesDelta,
    };
  }

  return out;
}

function inferStatDeltaFromPlay(statRow: Record<string, unknown>, eventType: string): SituationStatLine {
  const type = asString(statRow.type)?.toLowerCase() ?? "";
  const made = asBoolean(statRow.made);
  const shotType = asString(statRow.shot_type)?.toLowerCase() ?? "";

  const delta = emptyStats();
  if (type === "assist") {
    delta.ast = 1;
    return delta;
  }
  if (type === "rebound") {
    delta.reb = 1;
    return delta;
  }
  if (type === "freethrow" && made) {
    delta.pts = asNumber(statRow.points) ?? 1;
    return delta;
  }
  if (type === "fieldgoal" && made) {
    const isThree = eventType === "threepointmade" || shotType.includes("three");
    delta.pts = isThree ? 3 : 2;
    delta.threePm = isThree ? 1 : 0;
    return delta;
  }
  return delta;
}

function toDelta(explicitDelta: number | null, cumulative: number | null, previous: number): number {
  if (explicitDelta != null) {
    return explicitDelta;
  }
  if (cumulative == null) {
    return 0;
  }
  if (cumulative >= previous) {
    return cumulative - previous;
  }
  return cumulative;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
