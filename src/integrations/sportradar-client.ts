import { SituationSeasonInput } from "../domain/situation";
import { UpstreamError, UpstreamTimeoutError } from "../lib/errors";
import { CachedScheduleGame, ScheduleCache } from "./schedule-cache";

export interface ScheduleGameSummary extends CachedScheduleGame {}

export interface SportradarClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  scheduleCache?: ScheduleCache;
}

export class SportradarClient {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly timeoutMs: number;

  private readonly scheduleCache: ScheduleCache;

  constructor(config: SportradarClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.scheduleCache = config.scheduleCache ?? new ScheduleCache();
  }

  async getScheduleGameIds(season: SituationSeasonInput): Promise<string[]> {
    const summaries = await this.getScheduleGames(season);
    return summaries
      .filter((game) => isClosedOrComplete(game.status))
      .map((game) => game.gameId);
  }

  async getScheduleGameIdsForTeam(season: SituationSeasonInput, teamToken: string): Promise<string[]> {
    const token = teamToken.trim().toLowerCase();
    const summaries = await this.getScheduleGames(season);
    return summaries
      .filter((game) => isClosedOrComplete(game.status))
      .filter((game) =>
        game.homeAlias?.toLowerCase() === token
        || game.awayAlias?.toLowerCase() === token
        || game.homeTeamId?.toLowerCase().includes(token)
        || game.awayTeamId?.toLowerCase().includes(token))
      .map((game) => game.gameId);
  }

  async getScheduleGames(season: SituationSeasonInput): Promise<ScheduleGameSummary[]> {
    const cached = this.scheduleCache.get(season);
    if (cached) {
      return cached;
    }

    const path = `/games/${season.year}/${season.type}/schedule.json`;
    const payload = await this.fetchJson(path, "getSchedule");
    const summaries = extractScheduleGames(payload);
    const sortedSummaries = summaries.sort((a, b) => b.scheduledAt - a.scheduledAt);

    this.scheduleCache.set(season, sortedSummaries);
    return sortedSummaries;
  }

  async getGamePlayByPlay(gameId: string): Promise<unknown> {
    const path = `/games/${gameId}/pbp.json`;
    return this.fetchJson(path, "getGamePlayByPlay");
  }

  private async fetchJson(path: string, operation: string): Promise<unknown> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${separator}api_key=${encodeURIComponent(this.apiKey)}`;
    const signal = AbortSignal.timeout(this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (isAbortError(error)) {
        throw new UpstreamTimeoutError("Sportradar request timed out.", {
          provider: "sportradar",
          operation,
          timeoutMs: this.timeoutMs,
        });
      }
      throw new UpstreamError("Failed to reach Sportradar.", {
        provider: "sportradar",
        operation,
      });
    }

    if (!response.ok) {
      throw new UpstreamError("Sportradar returned non-success status.", {
        provider: "sportradar",
        operation,
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (_error) {
      throw new UpstreamError("Sportradar returned invalid JSON payload.", {
        provider: "sportradar",
        operation,
      });
    }
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "name" in error && (error as { name: string }).name === "AbortError";
}

export function extractScheduleGames(payload: unknown): ScheduleGameSummary[] {
  if (!payload || typeof payload !== "object") {
    throw new UpstreamError("Invalid schedule payload shape.", {
      provider: "sportradar",
      operation: "getSchedule",
    });
  }

  const candidates = toArray((payload as any).games)
    ?? toArray((payload as any).game)
    ?? toArray((payload as any).league?.games)
    ?? [];

  const summaries: ScheduleGameSummary[] = [];
  for (const candidate of candidates) {
    const gameId = typeof candidate?.id === "string" ? candidate.id : null;
    const scheduled = candidate?.scheduled ?? candidate?.scheduled_at ?? candidate?.start_time;
    if (!gameId || typeof scheduled !== "string") {
      continue;
    }
    const scheduledAt = Date.parse(scheduled);
    if (Number.isNaN(scheduledAt)) {
      continue;
    }
    const home = asObject(candidate?.home);
    const away = asObject(candidate?.away);
    summaries.push({
      gameId,
      scheduledAt,
      status: asString(candidate?.status) ?? undefined,
      homeTeamId: asString(home.id) ?? undefined,
      awayTeamId: asString(away.id) ?? undefined,
      homeAlias: asString(home.alias) ?? undefined,
      awayAlias: asString(away.alias) ?? undefined,
    });
  }

  return summaries;
}

function toArray(value: unknown): any[] | null {
  return Array.isArray(value) ? value : null;
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isClosedOrComplete(status?: string): boolean {
  if (!status) {
    return false;
  }
  const normalized = status.toLowerCase();
  return normalized === "closed" || normalized === "complete";
}
