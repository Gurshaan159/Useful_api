export type ReliabilityGrade = "A" | "B" | "C" | "D";

export type SituationStatus = "ready" | "failed";

export type SkipReason =
  | "PLAYER_NOT_IN_GAME"
  | "PLAYER_TEAM_UNKNOWN"
  | "SCORE_UNRELIABLE"
  | "CLOCK_PARSE_FAIL"
  | "UPSTREAM_PBP_MISSING";

export interface SituationRange {
  gte: number;
  lte: number;
}

export interface SituationPlayerInput {
  name: string;
  team?: string;
}

export interface SituationFiltersInput {
  quarter: 1 | 2 | 3 | 4;
  timeRemainingSeconds: SituationRange;
  scoreDiff: SituationRange;
}

export interface SituationLimitsInput {
  maxGames: number;
  minStarts: number;
  maxStartsPerGame: number;
}

export interface SituationGameInput {
  id: string;
}

export interface SituationSeasonInput {
  year: number;
  type: "REG" | "PST" | "PRE";
}

export interface SituationInputs {
  player: SituationPlayerInput;
  filters: SituationFiltersInput;
  limits: SituationLimitsInput;
  game?: SituationGameInput;
  season?: SituationSeasonInput;
}

export interface SituationMatchedStart {
  gameId: string;
  period: number;
  clockSecondsRemaining: number;
  scoreDiffAtStart: number;
}

export interface SituationStatLine {
  pts: number;
  ast: number;
  reb: number;
  threePm: number;
}

export interface SituationByGameStatLine extends SituationStatLine {
  gameId: string;
}

export interface Situation {
  id: string;
  schemaVersion: number;
  createdAt: string;
  expiresAt: string;
  status: SituationStatus;
  inputs: SituationInputs;
  meta: {
    gamesScanned: number;
    gamesUsed: number;
    startsMatched: number;
    gamesSkippedByReason: Record<SkipReason, number>;
    warnings: string[];
    reliabilityGrade: ReliabilityGrade;
  };
  stats: {
    totals: SituationStatLine;
    perStart: SituationStatLine;
    byGame: SituationByGameStatLine[];
  };
  matchedStarts: SituationMatchedStart[];
}

export interface CreateSituationResult {
  id: string;
  situation: Situation;
}

export const SITUATION_SCHEMA_VERSION = 1;

export const DEFAULT_LIMITS: SituationLimitsInput = {
  maxGames: 50,
  minStarts: 10,
  maxStartsPerGame: 3,
};

export const MAX_MATCHED_STARTS = 50;

export const DEFAULT_TTL_MS = 30 * 60 * 1000;

export const SKIP_REASONS: ReadonlyArray<SkipReason> = [
  "PLAYER_NOT_IN_GAME",
  "PLAYER_TEAM_UNKNOWN",
  "SCORE_UNRELIABLE",
  "CLOCK_PARSE_FAIL",
  "UPSTREAM_PBP_MISSING",
];
