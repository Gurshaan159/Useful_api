import { randomUUID } from "node:crypto";
import { Sport } from "../../domain/situation";

export interface LiveSession {
  id: string;
  sport: Sport;
  sportEventId: string;
  focusPlayerId?: string;
  focusPlayerName?: string;
  createdAt: string;
  status: "pending" | "running" | "ended" | "error";
  lastCursor?: string;
  lastEventHash?: string;
  narrativeState: string;
  predictionState: {
    similarMatches: Array<{ sportEventId: string; distance: number }>;
    trends: Record<string, number>;
    confidence: "low" | "med" | "high";
  };
  warnings: string[];
  lastNarrationAtMs?: number;
}

export interface CreateLiveSessionInput {
  sport: Sport;
  sportEventId: string;
  focusPlayerId?: string;
  focusPlayerName?: string;
}

export class InMemoryLiveSessionStore {
  private readonly store = new Map<string, LiveSession>();

  create(input: CreateLiveSessionInput): LiveSession {
    const id = `sess_${randomUUID()}`;
    const session: LiveSession = {
      id,
      sport: input.sport,
      sportEventId: input.sportEventId,
      focusPlayerId: input.focusPlayerId,
      focusPlayerName: input.focusPlayerName,
      createdAt: new Date().toISOString(),
      status: "pending",
      narrativeState: "",
      predictionState: {
        similarMatches: [],
        trends: {},
        confidence: "low",
      },
      warnings: [],
    };
    this.store.set(id, session);
    return session;
  }

  getById(id: string): LiveSession | null {
    return this.store.get(id) ?? null;
  }

  update(id: string, patch: Partial<LiveSession>): LiveSession | null {
    const current = this.store.get(id);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    this.store.set(id, next);
    return next;
  }
}
