import { describe, expect, it } from "vitest";
import { InMemorySituationRepository } from "../src/repositories/in-memory-situation-repository";
import { Situation } from "../src/domain/situation";

function fixtureSituation(id: string): Situation {
  return {
    id,
    sport: "nba",
    schemaVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    expiresAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    status: "ready",
    inputs: {
      sport: "nba",
      player: { name: "Stephen Curry" },
      filters: {
        nba: {
          quarter: 4,
          timeRemainingSeconds: { gte: 120, lte: 300 },
          scoreDiff: { gte: -5, lte: 5 },
        },
      },
      limits: { maxGames: 50, minStarts: 10, maxStartsPerGame: 3 },
      game: { id: "g1" },
    },
    meta: {
      gamesScanned: 1,
      gamesUsed: 1,
      startsMatched: 1,
      gamesSkippedByReason: {
        PLAYER_NOT_IN_GAME: 0,
        PLAYER_TEAM_UNKNOWN: 0,
        SCORE_UNRELIABLE: 0,
        CLOCK_PARSE_FAIL: 0,
        UPSTREAM_PBP_MISSING: 0,
      },
      warnings: [],
      reliabilityGrade: "D",
    },
    stats: {
      totals: { pts: 1, ast: 2, reb: 3, threePm: 4 },
      perStart: { pts: 1, ast: 2, reb: 3, threePm: 4 },
      byGame: [{ gameId: "g1", stats: { pts: 1, ast: 2, reb: 3, threePm: 4 } }],
    },
    matchedStarts: [{ gameId: "g1", period: 4, clockSecondsRemaining: 200, scoreDiffAtStart: 0 }],
  };
}

describe("InMemorySituationRepository", () => {
  it("evicts stale entries based on TTL", async () => {
    const repo = new InMemorySituationRepository({ ttlMs: 25, sweepIntervalMs: 10 });
    await repo.create(fixtureSituation("sit_ttl"));
    const immediate = await repo.getById("sit_ttl");
    expect(immediate?.id).toBe("sit_ttl");

    await new Promise((resolve) => setTimeout(resolve, 50));
    const expired = await repo.getById("sit_ttl");
    expect(expired).toBeNull();
    repo.close();
  });
});
