import { SituationByGameStatLine } from "../domain/situation";

const COLUMNS = [
  { key: "gameId", header: "GAME_ID", numeric: false },
  { key: "pts", header: "PTS", numeric: true },
  { key: "reb", header: "REB", numeric: true },
  { key: "ast", header: "AST", numeric: true },
  { key: "threePm", header: "3PM", numeric: true },
] as const;

type TableColumn = (typeof COLUMNS)[number];

export function renderByGameStatsTable(rows: SituationByGameStatLine[]): string {
  const sortedRows = [...rows].sort((a, b) => {
    if ((b.stats.pts ?? 0) !== (a.stats.pts ?? 0)) {
      return (b.stats.pts ?? 0) - (a.stats.pts ?? 0);
    }
    return a.gameId.localeCompare(b.gameId);
  });

  const widths = computeWidths(sortedRows);
  const header = COLUMNS.map((column) => padValue(column.header, widths.get(column.key)!, column)).join(" | ");
  const separator = COLUMNS.map((column) => "-".repeat(widths.get(column.key)!)).join("-+-");
  const body = sortedRows.map((row) =>
    COLUMNS.map((column) => {
      const normalizedValue = column.key === "gameId"
        ? row.gameId
        : String(row.stats[column.key as keyof typeof row.stats] ?? 0);
      return padValue(normalizedValue, widths.get(column.key)!, column);
    }).join(" | "));

  if (body.length === 0) {
    return `${header}\n${separator}`;
  }
  return [header, separator, ...body].join("\n");
}

function computeWidths(rows: SituationByGameStatLine[]): Map<TableColumn["key"], number> {
  const widths = new Map<TableColumn["key"], number>();
  for (const column of COLUMNS) {
    widths.set(column.key, column.header.length);
  }

  for (const row of rows) {
    for (const column of COLUMNS) {
      const current = widths.get(column.key)!;
      const valueLength = column.key === "gameId"
        ? row.gameId.length
        : String(row.stats[column.key as keyof typeof row.stats] ?? 0).length;
      widths.set(column.key, Math.max(current, valueLength));
    }
  }

  return widths;
}

function padValue(value: string, width: number, column: TableColumn): string {
  return column.numeric ? value.padStart(width) : value.padEnd(width);
}
