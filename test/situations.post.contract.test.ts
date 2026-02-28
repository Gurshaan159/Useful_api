import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { Situation } from "../src/domain/situation";
import { AmbiguousPlayerError, UpstreamError } from "../src/lib/errors";

function makeSituation(id = "sit_test"): Situation {
  return {
    id,
    schemaVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    expiresAt: new Date("2026-01-01T00:30:00.000Z").toISOString(),
    status: "ready",
    inputs: {
      player: { name: "Stephen Curry" },
      filters: {
        quarter: 4,
        timeRemainingSeconds: { gte: 120, lte: 300 },
        scoreDiff: { gte: -5, lte: 5 },
      },
      limits: {
        maxGames: 50,
        minStarts: 10,
        maxStartsPerGame: 3,
      },
      season: { year: 2025, type: "REG" },
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
      totals: { pts: 10, ast: 2, reb: 3, threePm: 2 },
      perStart: { pts: 10, ast: 2, reb: 3, threePm: 2 },
      byGame: [{ gameId: "g1", pts: 10, ast: 2, reb: 3, threePm: 2 }],
    },
    matchedStarts: [{ gameId: "g1", period: 4, clockSecondsRemaining: 200, scoreDiffAtStart: 1 }],
  };
}

describe("POST /v1/situations contract", () => {
  const repository = {
    create: vi.fn(async () => {}),
    getById: vi.fn(async () => null),
  };

  beforeEach(() => {
    repository.create.mockClear();
  });

  it("returns id with gamesScanned and gamesUsed on success", async () => {
    const app = await buildApp({
      situationRepository: repository,
      situationBuilder: {
        build: vi.fn(async () => makeSituation("sit_abc123")),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/situations",
      payload: {
        player: { name: "Stephen Curry" },
        filters: {
          quarter: 4,
          timeRemainingSeconds: { gte: 120, lte: 300 },
          scoreDiff: { gte: -5, lte: 5 },
        },
        season: { year: 2025, type: "REG" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: "sit_abc123",
      gamesScanned: 1,
      gamesUsed: 1,
    });
    expect(Object.keys(response.json())).toEqual(["id", "gamesScanned", "gamesUsed"]);
    await app.close();
  });

  it("returns INVALID_RANGE for invalid ranges", async () => {
    const app = await buildApp({
      situationRepository: repository,
      situationBuilder: {
        build: vi.fn(async () => makeSituation("sit_should_not_happen")),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/situations",
      payload: {
        player: { name: "Stephen Curry" },
        filters: {
          quarter: 4,
          timeRemainingSeconds: { gte: 400, lte: 300 },
          scoreDiff: { gte: -5, lte: 5 },
        },
        season: { year: 2025, type: "REG" },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("INVALID_RANGE");
    await app.close();
  });

  it("returns INVALID_JSON for malformed payload", async () => {
    const app = await buildApp({
      situationRepository: repository,
      situationBuilder: {
        build: vi.fn(async () => makeSituation()),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/situations",
      headers: { "content-type": "application/json" },
      payload: "{\"player\":",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_JSON");
    await app.close();
  });

  it("returns AMBIGUOUS_PLAYER when builder cannot disambiguate", async () => {
    const app = await buildApp({
      situationRepository: repository,
      situationBuilder: {
        build: vi.fn(async () => {
          throw new AmbiguousPlayerError("ambiguous", { candidates: ["a", "b"] });
        }),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/situations",
      payload: {
        player: { name: "Jalen Williams" },
        filters: {
          quarter: 4,
          timeRemainingSeconds: { gte: 120, lte: 300 },
          scoreDiff: { gte: -5, lte: 5 },
        },
        season: { year: 2025, type: "REG" },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AMBIGUOUS_PLAYER");
    await app.close();
  });

  it("returns UPSTREAM_ERROR when provider call fails", async () => {
    const app = await buildApp({
      situationRepository: repository,
      situationBuilder: {
        build: vi.fn(async () => {
          throw new UpstreamError("provider failure", { provider: "sportradar" });
        }),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/situations",
      payload: {
        player: { name: "Stephen Curry" },
        filters: {
          quarter: 4,
          timeRemainingSeconds: { gte: 120, lte: 300 },
          scoreDiff: { gte: -5, lte: 5 },
        },
        game: { id: "sr_game_1" },
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("UPSTREAM_ERROR");
    await app.close();
  });
});
