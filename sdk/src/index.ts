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
      return post<CreateSituationResponse>(baseUrl, "/v1/situations", params);
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
