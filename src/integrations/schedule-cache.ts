import { SituationSeasonInput } from "../domain/situation";

export interface CachedScheduleGame {
  gameId: string;
  scheduledAt: number;
  status?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeAlias?: string;
  awayAlias?: string;
}

interface CacheEntry {
  expiresAtMs: number;
  games: CachedScheduleGame[];
}

export class ScheduleCache {
  private readonly ttlMs: number;

  private readonly store = new Map<string, CacheEntry>();

  constructor(ttlMs = 15 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  get(season: SituationSeasonInput): CachedScheduleGame[] | null {
    const key = this.toKey(season);
    const hit = this.store.get(key);
    if (!hit) {
      return null;
    }
    if (Date.now() >= hit.expiresAtMs) {
      this.store.delete(key);
      return null;
    }
    return [...hit.games];
  }

  set(season: SituationSeasonInput, games: CachedScheduleGame[]): void {
    const key = this.toKey(season);
    this.store.set(key, {
      expiresAtMs: Date.now() + this.ttlMs,
      games: [...games],
    });
  }

  private toKey(season: SituationSeasonInput): string {
    return `${season.year}:${season.type}`;
  }
}
