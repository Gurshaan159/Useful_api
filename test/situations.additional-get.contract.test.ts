import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { Situation } from "../src/domain/situation";

function makeSituation(id = "sit_extra"): Situation {
  return {
    id,
    sport: "nba",
    schemaVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    expiresAt: new Date("2026-01-01T00:30:00.000Z").toISOString(),
    status: "ready",
    inputs: {
      sport: "nba",
      player: { name: "LeBron James", team: "LAL" },
      filters: {
        nba: {
          quarter: 4,
          timeRemainingSeconds: { gte: 0, lte: 720 },
          scoreDiff: { gte: -50, lte: 50 },
        },
      },
      limits: { maxGames: 4, minStarts: 2, maxStartsPerGame: 1 },
      season: { year: 2025, type: "REG" },
    },
    meta: {
      gamesScanned: 4,
      gamesUsed: 4,
      startsMatched: 4,
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
      totals: { pts: 13, reb: 5, ast: 6, threePm: 1 },
      perStart: { pts: 3.25, reb: 1.25, ast: 1.5, threePm: 0.25 },
      byGame: [
        { gameId: "g2", stats: { pts: 7, reb: 0, ast: 1, threePm: 0 } },
        { gameId: "g1", stats: { pts: 4, reb: 2, ast: 0, threePm: 0 } },
        { gameId: "g3", stats: { pts: 2, reb: 2, ast: 2, threePm: 1 } },
      ],
    },
    matchedStarts: [
      { gameId: "g1", period: 4, clockSecondsRemaining: 680, scoreDiffAtStart: 0 },
      { gameId: "g2", period: 4, clockSecondsRemaining: 700, scoreDiffAtStart: 0 },
      { gameId: "g3", period: 4, clockSecondsRemaining: 710, scoreDiffAtStart: 0 },
    ],
  };
}

describe("Additional GET endpoints", () => {
  it("returns analysis payload", async () => {
    const situation = makeSituation("sit_summary-1");
    const repo = {
      create: vi.fn(async () => {}),
      getById: vi.fn(async () => situation),
    };
    const app = await buildApp({
      situationRepository: repo,
      situationBuilder: { build: vi.fn(async () => situation) },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/situations/sit_summary-1/analysis?sport=nba",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "sit_summary-1",
      status: "ready",
      analysis: {
        gamesScanned: 4,
        gamesUsed: 4,
        startsMatched: 4,
        reliabilityGrade: "D",
        totals: { pts: 13, reb: 5, ast: 6, threePm: 1 },
        perStart: { pts: 3.25, reb: 1.25, ast: 1.5, threePm: 0.25 },
      },
    });
    await app.close();
  });

  it("returns downloadable CSV export", async () => {
    const situation = makeSituation("sit_csv-1");
    const repo = {
      create: vi.fn(async () => {}),
      getById: vi.fn(async () => situation),
    };
    const app = await buildApp({
      situationRepository: repo,
      situationBuilder: { build: vi.fn(async () => situation) },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/situations/sit_csv-1/export.csv?sport=nba&includeSummary=false",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("situation_sit_csv-1.csv");
    expect(response.body).toContain("gameId,pts,reb,ast,threePm");
    expect(response.body).toContain("g2,7,0,1,0");
    await app.close();
  });
});
