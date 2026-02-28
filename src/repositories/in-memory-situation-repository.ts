import { DEFAULT_TTL_MS, Situation } from "../domain/situation";
import { SituationRepository } from "./situation-repository";

interface RepoOptions {
  ttlMs?: number;
  sweepIntervalMs?: number;
}

export class InMemorySituationRepository implements SituationRepository {
  private readonly ttlMs: number;

  private readonly store = new Map<string, Situation>();

  private readonly sweepIntervalMs: number;

  private readonly sweepTimer: NodeJS.Timeout;

  constructor(options: RepoOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
    this.sweepTimer = setInterval(() => this.evictExpired(), this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  async create(situation: Situation): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    const stored: Situation = {
      ...situation,
      expiresAt,
    };
    this.store.set(situation.id, stored);
  }

  async getById(id: string): Promise<Situation | null> {
    const hit = this.store.get(id);
    if (!hit) {
      return null;
    }

    const now = Date.now();
    if (new Date(hit.expiresAt).getTime() <= now) {
      this.store.delete(id);
      return null;
    }

    return hit;
  }

  async update(id: string, patch: Partial<Situation>): Promise<void> {
    const current = await this.getById(id);
    if (!current) {
      return;
    }
    this.store.set(id, { ...current, ...patch });
  }

  close(): void {
    clearInterval(this.sweepTimer);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, situation] of this.store.entries()) {
      if (new Date(situation.expiresAt).getTime() <= now) {
        this.store.delete(id);
      }
    }
  }
}
