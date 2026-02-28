import { SituationByGameStatLine } from "../domain/situation";

export type GameSortBy = "pts" | "reb" | "ast" | "threePm" | "gameId";
export type SortOrder = "asc" | "desc";

export function sortAndLimitGames(
  rows: SituationByGameStatLine[],
  sortBy: GameSortBy = "pts",
  order: SortOrder = "desc",
  limit?: number,
): SituationByGameStatLine[] {
  const sorted = [...rows].sort((a, b) => compareRows(a, b, sortBy, order));
  if (limit == null) {
    return sorted;
  }
  return sorted.slice(0, limit);
}

export function buildGamesCsv(
  situationId: string,
  rows: SituationByGameStatLine[],
  includeSummary: boolean,
  totals: { pts: number; reb: number; ast: number; threePm: number },
  perStart: { pts: number; reb: number; ast: number; threePm: number },
): string {
  const lines: string[] = [];
  if (includeSummary) {
    lines.push(`# situationId,${escapeCsv(situationId)}`);
    lines.push(`# totals_pts,totals_reb,totals_ast,totals_threePm`);
    lines.push(`# ${totals.pts},${totals.reb},${totals.ast},${totals.threePm}`);
    lines.push(`# perStart_pts,perStart_reb,perStart_ast,perStart_threePm`);
    lines.push(`# ${perStart.pts},${perStart.reb},${perStart.ast},${perStart.threePm}`);
    lines.push("");
  }

  lines.push("gameId,pts,reb,ast,threePm");
  for (const row of rows) {
    lines.push(
      [
        escapeCsv(row.gameId),
        (row.stats.pts ?? 0).toString(),
        (row.stats.reb ?? 0).toString(),
        (row.stats.ast ?? 0).toString(),
        (row.stats.threePm ?? 0).toString(),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function compareRows(
  a: SituationByGameStatLine,
  b: SituationByGameStatLine,
  sortBy: GameSortBy,
  order: SortOrder,
): number {
  const direction = order === "asc" ? 1 : -1;
  if (sortBy === "gameId") {
    return a.gameId.localeCompare(b.gameId) * direction;
  }

  const bVal = b.stats[sortBy];
  const aStatVal = a.stats[sortBy];
  if (aStatVal !== bVal) {
    return ((aStatVal ?? 0) - (bVal ?? 0)) * direction;
  }
  return a.gameId.localeCompare(b.gameId);
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}
