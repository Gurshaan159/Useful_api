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
        row.pts.toString(),
        row.reb.toString(),
        row.ast.toString(),
        row.threePm.toString(),
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

  const aVal = a[sortBy];
  const bVal = b[sortBy];
  if (aVal !== bVal) {
    return (aVal - bVal) * direction;
  }
  return a.gameId.localeCompare(b.gameId);
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}
