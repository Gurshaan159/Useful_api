import { SituationStatLine } from "../../domain/situation";

export function emptyStats(seedKeys: string[] = []): SituationStatLine {
  const out: SituationStatLine = {
    pts: 0,
    ast: 0,
    reb: 0,
    threePm: 0,
  };
  for (const key of seedKeys) {
    ((out as unknown) as Record<string, number>)[key] = 0;
  }
  return out;
}

export function addStatLines(a: SituationStatLine, b: SituationStatLine): SituationStatLine {
  const out: SituationStatLine = { ...a };
  for (const [key, value] of Object.entries(b)) {
    ((out as unknown) as Record<string, number>)[key] = (((out as unknown) as Record<string, number | undefined>)[key] ?? 0)
      + (value ?? 0);
  }
  return out;
}

export function divideStatLine(stats: SituationStatLine, divisor: number): SituationStatLine {
  if (divisor <= 0) {
    return emptyStats(Object.keys(stats));
  }
  const out: SituationStatLine = emptyStats(Object.keys(stats));
  for (const [key, value] of Object.entries(stats)) {
    ((out as unknown) as Record<string, number>)[key] = Math.round(((value ?? 0) / divisor) * 100) / 100;
  }
  return out;
}

export function pickNumeric(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
