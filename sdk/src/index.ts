/**
 * Gametime API JavaScript Client
 * Live sports data, player analysis, predictions, and historical situations for NBA & Soccer.
 *
 * @example
 * ```js
 * import { createClient } from 'gametime-api-client';
 * const api = createClient();
 * const games = await api.live.games('soccer');
 * const analysis = await api.live.soccerAnalysis({ sportEventId: games[0].sportEventId });
 * const { id } = await api.situations.create({ player: {...}, filters: {...}, season: {...} });
 * const csv = await api.situations.exportCsv(id, 'nba');
 * ```
 */

const DEFAULT_BASE = "https://gametimeapi.onrender.com";

export interface ClientOptions {
  /** API base URL. Default: https://gametimeapi.onrender.com */
  baseUrl?: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "GametimeApiError";
  }
}

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const CREATE_SITUATION_RETRY: Required<RetryOptions> = {
  maxAttempts: 5,
  baseDelayMs: 600,
  maxDelayMs: 12_000,
};

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? body;
    throw new ApiError(
      err?.message ?? body?.message ?? res.statusText,
      err?.code,
      res.status,
      err?.details
    );
  }
  return body as T;
}

async function requestWithRetry<T>(
  run: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = sanitizePositiveInt(options.maxAttempts, CREATE_SITUATION_RETRY.maxAttempts);
  const baseDelayMs = sanitizePositiveInt(options.baseDelayMs, CREATE_SITUATION_RETRY.baseDelayMs);
  const maxDelayMs = sanitizePositiveInt(options.maxDelayMs, CREATE_SITUATION_RETRY.maxDelayMs);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= maxAttempts) {
        throw error;
      }
      await sleep(calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
  throw lastError;
}

function get<T>(baseUrl: string, path: string): Promise<T> {
  return request<T>(baseUrl, path, { method: "GET" });
}

async function getText(baseUrl: string, path: string): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = body?.error ?? body;
    throw new ApiError(
      err?.message ?? body?.message ?? res.statusText,
      err?.code,
      res.status,
      err?.details
    );
  }
  return res.text();
}

function post<T>(baseUrl: string, path: string, body: object): Promise<T> {
  return request<T>(baseUrl, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Live games and analysis */
export interface LiveApi {
  /** Fetch in-progress live games for a sport */
  games(sport: "soccer" | "nba"): Promise<LiveGame[]>;

  /** Fetch players for a specific game */
  players(sportEventId: string, sport: "soccer" | "nba"): Promise<LivePlayer[]>;

  /** Soccer player prediction analysis (auto-picks focus player if not provided) */
  soccerAnalysis(params: {
    sportEventId: string;
    focusPlayerId?: string;
    focusPlayerName?: string;
  }): Promise<SoccerAnalysis>;

  /** NBA player prediction analysis */
  nbaAnalysis(params: {
    sportEventId: string;
    focusPlayerId?: string;
    focusPlayerName?: string;
    verbosity?: "short" | "medium" | "high";
  }): Promise<NbaAnalysis>;

  /** Create a live session for WebSocket streaming */
  createSession(params: {
    sport: "soccer" | "nba";
    sportEventId: string;
    focusPlayerId?: string;
    focusPlayerName?: string;
  }): Promise<{ id: string }>;
}

export interface LiveGame {
  sportEventId: string;
  scheduled?: string;
  status?: string;
  homeTeam?: string;
  awayTeam?: string;
  score?: string | null;
  competition?: string | null;
  analysis?: Record<string, unknown>;
}

export interface LivePlayer {
  playerId: string;
  name?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  touches?: number;
  isActive?: boolean;
}

export interface SoccerAnalysis {
  sport: "soccer";
  sportEventId: string;
  player: { playerId: string; name: string; teamId?: string | null };
  live: {
    elapsedMinutes: number;
    currentTotals: { goals: number; assists: number; shots: number; touches: number };
  };
  historical: { averages: Record<string, number> };
  prediction: {
    projectedFinal: Record<string, number>;
    blendedPrediction: Record<string, number>;
    confidence: string;
  };
  matchEnded: boolean;
  narration?: Record<string, unknown>;
}

export interface NbaAnalysis {
  sport: "nba";
  sportEventId: string;
  player: { playerId: string; name: string; teamId?: string | null };
  live: {
    elapsedSeconds: number;
    currentTotals: { pts: number; ast: number; reb: number; threePm: number };
  };
  historical: { averages: Record<string, number> };
  prediction: {
    projectedFinal: Record<string, number>;
    blendedPrediction: Record<string, number>;
    confidence: string;
  };
  narration?: Record<string, unknown>;
}

/** Situation create filters */
export interface SituationFiltersNba {
  nba: {
    quarter: 1 | 2 | 3 | 4;
    timeRemainingSeconds: { gte: number; lte: number };
    scoreDiff: { gte: number; lte: number };
  };
}

export interface SituationFiltersSoccer {
  soccer: {
    half: 1 | 2;
    minuteRange: { gte: number; lte: number };
    scoreState: "leading" | "drawing" | "trailing";
    goalDiffRange?: { gte: number; lte: number };
  };
}

export interface CreateSituationParams {
  sport?: "nba" | "soccer";
  player: { name: string; id?: string; team?: string };
  filters: SituationFiltersNba | SituationFiltersSoccer;
  limits?: { maxGames?: number; minStarts?: number; maxStartsPerGame?: number };
  game?: { id: string };
  season?: { year: number; type: "REG" | "PST" | "PRE" };
}

export interface CreateSituationResponse {
  id: string;
  gamesScanned: number;
  gamesUsed: number;
}

export interface SituationAnalysis {
  id: string;
  status: "ready" | "failed";
  analysis: {
    gamesScanned: number;
    gamesUsed: number;
    startsMatched: number;
    reliabilityGrade: "A" | "B" | "C" | "D";
    totals: Record<string, number>;
    perStart: Record<string, number>;
  };
}

/** Situations: create, analysis, CSV export */
export interface SituationsApi {
  /** Create a situation (provide either game or season, not both) */
  create(params: CreateSituationParams): Promise<CreateSituationResponse>;

  /** Get analysis for a situation */
  analysis(id: string, sport: "nba" | "soccer"): Promise<SituationAnalysis>;

  /** Export situation stats as CSV string */
  exportCsv(
    id: string,
    sport: "nba" | "soccer",
    options?: { includeSummary?: boolean }
  ): Promise<string>;
}

/** Create a Gametime API client */
export function createClient(options: ClientOptions = {}): { live: LiveApi; situations: SituationsApi } {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;

  const live: LiveApi = {
    games(sport) {
      return get<LiveGame[]>(baseUrl, `/v1/live/games?sport=${sport}`);
    },

    players(sportEventId, sport) {
      const path = `/v1/live/games/${encodeURIComponent(sportEventId)}/players?sport=${sport}`;
      return get<LivePlayer[]>(baseUrl, path);
    },

    async soccerAnalysis(params) {
      return post<SoccerAnalysis>(baseUrl, "/v1/live/soccer/analysis", params);
    },

    async nbaAnalysis(params) {
      return post<NbaAnalysis>(baseUrl, "/v1/live/nba/analysis", params);
    },

    async createSession(params) {
      return post<{ id: string }>(baseUrl, "/v1/live/sessions", params);
    },
  };

  const situations: SituationsApi = {
    create(params) {
      return requestWithRetry(
        () => post<CreateSituationResponse>(baseUrl, "/v1/situations", params),
        isRetryableCreateSituationError
      );
    },

    analysis(id, sport) {
      return get<SituationAnalysis>(baseUrl, `/v1/situations/${encodeURIComponent(id)}/analysis?sport=${sport}`);
    },

    exportCsv(id, sport, options) {
      const q = new URLSearchParams({ sport });
      if (options?.includeSummary !== undefined) q.set("includeSummary", String(options.includeSummary));
      return getText(baseUrl, `/v1/situations/${encodeURIComponent(id)}/export.csv?${q}`);
    },
  };

  return { live, situations };
}

/** Pre-built client using default hosted API URL */
export const gametime = createClient();

export { ApiError };

function isRetryableCreateSituationError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  const status = error.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const upstreamStatus = (error.details as { status?: unknown } | undefined)?.status;
  return upstreamStatus === 429;
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
