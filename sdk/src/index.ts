/**
 * Gametime API JavaScript Client
 * Live sports data, player analysis, and predictions for NBA & Soccer.
 *
 * @example
 * ```js
 * import { createClient } from 'gametime-api-client';
 * const api = createClient({ baseUrl: 'https://gametimeapi.onrender.com' });
 * const games = await api.live.games('soccer');
 * const analysis = await api.live.soccerAnalysis({ sportEventId: games[0].sportEventId });
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

/** Create a Gametime API client */
export function createClient(options: ClientOptions = {}): { live: LiveApi } {
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

  return { live };
}

/** Pre-built client using default hosted API URL */
export const gametime = createClient();

export { ApiError };
