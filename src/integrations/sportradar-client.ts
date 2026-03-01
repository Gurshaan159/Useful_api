import { SituationSeasonInput } from "../domain/situation";
import { UpstreamError, UpstreamTimeoutError } from "../lib/errors";
import { CachedScheduleGame, ScheduleCache } from "./schedule-cache";

export interface ScheduleGameSummary extends CachedScheduleGame {}
export interface NbaLiveGameSummary {
  gameId: string;
  scheduled?: string;
  status?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
}

export interface SportradarClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  scheduleCache?: ScheduleCache;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export class SportradarClient {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly timeoutMs: number;

  private readonly scheduleCache: ScheduleCache;

  private readonly retryMaxAttempts: number;

  private readonly retryBaseDelayMs: number;

  private readonly retryMaxDelayMs: number;

  constructor(config: SportradarClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.scheduleCache = config.scheduleCache ?? new ScheduleCache();
    this.retryMaxAttempts = sanitizePositiveInt(config.retryMaxAttempts, 5);
    this.retryBaseDelayMs = sanitizePositiveInt(config.retryBaseDelayMs, 600);
    this.retryMaxDelayMs = sanitizePositiveInt(config.retryMaxDelayMs, 15_000);
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

  async getDailyScheduleGames(date = new Date()): Promise<NbaLiveGameSummary[]> {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const path = `/games/${year}/${month}/${day}/schedule.json`;
    const payload = await this.fetchJson(path, "getDailySchedule");
    return extractDailyScheduleGames(payload);
  }

  private async fetchJson(path: string, operation: string): Promise<unknown> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${separator}api_key=${encodeURIComponent(this.apiKey)}`;
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt += 1) {
      const signal = AbortSignal.timeout(this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, { signal });
      } catch (error) {
        if (isAbortError(error)) {
          if (attempt >= this.retryMaxAttempts) {
            throw new UpstreamTimeoutError("Sportradar request timed out.", {
              provider: "sportradar",
              operation,
              timeoutMs: this.timeoutMs,
              attempts: attempt,
            });
          }
          await sleep(calculateBackoffDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs));
          continue;
        }
        if (attempt >= this.retryMaxAttempts) {
          throw new UpstreamError("Failed to reach Sportradar.", {
            provider: "sportradar",
            operation,
            attempts: attempt,
          });
        }
        await sleep(calculateBackoffDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs));
        continue;
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch (_error) {
          throw new UpstreamError("Sportradar returned invalid JSON payload.", {
            provider: "sportradar",
            operation,
            attempts: attempt,
          });
        }
      }

      lastStatus = response.status;
      const retryable = isRetryableStatus(response.status);
      if (!retryable || attempt >= this.retryMaxAttempts) {
        throw new UpstreamError("Sportradar returned non-success status.", {
          provider: "sportradar",
          operation,
          status: response.status,
          attempts: attempt,
          maxAttempts: this.retryMaxAttempts,
        });
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const delayMs = retryAfterMs ?? calculateBackoffDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs);
      await sleep(delayMs);
    }

    throw new UpstreamError("Sportradar returned non-success status.", {
      provider: "sportradar",
      operation,
      status: lastStatus,
      attempts: this.retryMaxAttempts,
      maxAttempts: this.retryMaxAttempts,
    });
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "name" in error && (error as { name: string }).name === "AbortError";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const retryAfterSeconds = Number(value);
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, Math.round(retryAfterSeconds * 1000));
  }
  const retryAfterDateMs = Date.parse(value);
  if (Number.isNaN(retryAfterDateMs)) {
    return null;
  }
  return Math.max(0, retryAfterDateMs - Date.now());
}

function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.min(250, Math.max(1, Math.floor(exponential * 0.25))));
  return Math.min(maxDelayMs, exponential + jitter);
}

function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function extractDailyScheduleGames(payload: unknown): NbaLiveGameSummary[] {
  if (!payload || typeof payload !== "object") {
    throw new UpstreamError("Invalid daily schedule payload shape.", {
      provider: "sportradar",
      operation: "getDailySchedule",
    });
  }
  const candidates = toArray((payload as any).games)
    ?? toArray((payload as any).game)
    ?? toArray((payload as any).league?.games)
    ?? [];
  const out: NbaLiveGameSummary[] = [];
  for (const candidate of candidates) {
    const gameId = asString(candidate?.id);
    if (!gameId) {
      continue;
    }
    const home = asObject(candidate?.home);
    const away = asObject(candidate?.away);
    out.push({
      gameId,
      scheduled: asString(candidate?.scheduled) ?? asString(candidate?.scheduled_at) ?? undefined,
      status: asString(candidate?.status) ?? undefined,
      homeTeam: asString(home?.name) ?? asString(home?.alias) ?? undefined,
      awayTeam: asString(away?.name) ?? asString(away?.alias) ?? undefined,
      homeScore: asNumber(candidate?.home_points) ?? asNumber(home?.points) ?? undefined,
      awayScore: asNumber(candidate?.away_points) ?? asNumber(away?.points) ?? undefined,
    });
  }
  return out;
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

function isClosedOrComplete(status?: string): boolean {
  if (!status) {
    return false;
  }
  const normalized = status.toLowerCase();
  return normalized === "closed" || normalized === "complete";
}
