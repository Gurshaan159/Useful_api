import { describe, expect, it } from "vitest";
import { renderByGameStatsTable } from "../src/services/table-renderer";

describe("renderByGameStatsTable", () => {
  it("sorts by points desc then gameId and right-aligns numeric columns", () => {
    const table = renderByGameStatsTable([
      { gameId: "game_b", pts: 8, reb: 10, ast: 5, threePm: 2 },
      { gameId: "game_a", pts: 8, reb: 9, ast: 1, threePm: 1 },
      { gameId: "game_c", pts: 15, reb: 7, ast: 3, threePm: 4 },
    ]);

    const lines = table.split("\n");
    expect(lines[0]).toContain("GAME_ID");
    expect(lines[0]).toContain("PTS");
    expect(lines[2].startsWith("game_c")).toBe(true);
    expect(lines[3].startsWith("game_a")).toBe(true);
    expect(lines[4].startsWith("game_b")).toBe(true);
  });
});
