import { describe, expect, it } from "vitest";
import { SituationBuilder } from "../src/services/situation-builder";
import { SituationInputs } from "../src/domain/situation";

const inputs: SituationInputs = {
  sport: "nba",
  player: { name: "Stephen Curry" },
  filters: {
    nba: {
      quarter: 4,
      timeRemainingSeconds: { gte: 120, lte: 300 },
      scoreDiff: { gte: -5, lte: 5 },
    },
  },
  limits: {
    maxGames: 50,
    minStarts: 10,
    maxStartsPerGame: 3,
  },
  season: { year: 2025, type: "REG" },
};

describe("SituationBuilder", () => {
  it("applies enter-window + 60s separation + maxStartsPerGame and inclusive stats", async () => {
    const fakeClient = {
      async getScheduleGameIds(): Promise<string[]> {
        return ["g1"];
      },
      async getGamePlayByPlay(): Promise<unknown> {
        return {
          id: "g1",
          home: { id: "GSW", players: [{ id: "p1", full_name: "Stephen Curry", team_id: "GSW" }] },
          away: { id: "LAL", players: [{ id: "p2", full_name: "LeBron James", team_id: "LAL" }] },
          events: [
            { sequence: 1, period: 4, clock: "06:00", home_score: 90, away_score: 90, playerStats: {} },
            { sequence: 2, period: 4, clock: "04:50", home_score: 92, away_score: 90, playerStats: { p1: { pts: 2 } } },
            { sequence: 3, period: 4, clock: "04:40", home_score: 102, away_score: 90, playerStats: { p1: { ast: 1 } } },
            { sequence: 4, period: 4, clock: "03:30", home_score: 95, away_score: 93, playerStats: { p1: { threePm: 1, pts: 3 } } },
            { sequence: 5, period: 4, clock: "03:20", home_score: 95, away_score: 93, playerStats: { p1: { reb: 1 } } },
            { sequence: 6, period: 4, clock: "01:50", home_score: 99, away_score: 96, playerStats: { p1: { pts: 4 } } },
            { sequence: 7, period: 4, clock: "01:40", home_score: 99, away_score: 96, playerStats: { p1: { ast: 1 } } }
          ],
        };
      },
    };

    const builder = new SituationBuilder({
      sportradarClient: fakeClient as any,
      idFactory: () => "sit_fixed",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const situation = await builder.build(inputs);
    expect(situation.id).toBe("sit_fixed");
    expect(situation.sport).toBe("nba");
    expect(situation.meta.startsMatched).toBe(2);
    expect(situation.matchedStarts).toHaveLength(2);
    expect(situation.stats.totals).toEqual({
      pts: 16,
      ast: 3,
      reb: 2,
      threePm: 2,
    });
    expect(situation.stats.perStart).toEqual({
      pts: 8,
      ast: 1.5,
      reb: 1,
      threePm: 1,
    });
    expect(situation.stats.byGame).toEqual([
      { gameId: "g1", stats: { pts: 16, ast: 3, reb: 2, threePm: 2 } },
    ]);
  });

  it("creates a ready situation with zero stats when no starts matched", async () => {
    const fakeClient = {
      async getScheduleGameIds(): Promise<string[]> {
        return ["g2"];
      },
      async getGamePlayByPlay(): Promise<unknown> {
        return {
          id: "g2",
          home: { id: "GSW", players: [{ id: "p1", full_name: "Stephen Curry", team_id: "GSW" }] },
          away: { id: "LAL", players: [{ id: "p2", full_name: "LeBron James", team_id: "LAL" }] },
          events: [{ sequence: 1, period: 1, clock: "10:00", home_score: 10, away_score: 8, playerStats: {} }],
        };
      },
    };

    const builder = new SituationBuilder({
      sportradarClient: fakeClient as any,
      idFactory: () => "sit_zero",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const situation = await builder.build(inputs);
    expect(situation.status).toBe("ready");
    expect(situation.meta.startsMatched).toBe(0);
    expect(situation.meta.reliabilityGrade).toBe("D");
    expect(situation.stats.totals).toEqual({ pts: 0, ast: 0, reb: 0, threePm: 0 });
    expect(situation.stats.perStart).toEqual({ pts: 0, ast: 0, reb: 0, threePm: 0 });
    expect(situation.stats.byGame).toEqual([{ gameId: "g2", stats: { pts: 0, ast: 0, reb: 0, threePm: 0 } }]);
  });
});
