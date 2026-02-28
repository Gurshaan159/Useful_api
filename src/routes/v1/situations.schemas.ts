import { DEFAULT_LIMITS, SituationInputs } from "../../domain/situation";
import { InvalidRangeError, InvalidRequestError } from "../../lib/errors";

export interface CreateSituationRequestBody {
  player: {
    name: string;
    team?: string;
  };
  filters: {
    quarter: 1 | 2 | 3 | 4;
    timeRemainingSeconds: {
      gte: number;
      lte: number;
    };
    scoreDiff: {
      gte: number;
      lte: number;
    };
  };
  limits?: {
    maxGames?: number;
    minStarts?: number;
    maxStartsPerGame?: number;
  };
  game?: {
    id: string;
  };
  season?: {
    year: number;
    type: "REG" | "PST" | "PRE";
  };
}

const playerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    team: { type: "string", minLength: 2, maxLength: 4 },
  },
} as const;

const filtersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quarter", "timeRemainingSeconds", "scoreDiff"],
  properties: {
    quarter: { type: "integer", enum: [1, 2, 3, 4] },
    timeRemainingSeconds: {
      type: "object",
      additionalProperties: false,
      required: ["gte", "lte"],
      properties: {
        gte: { type: "integer", minimum: 0, maximum: 720 },
        lte: { type: "integer", minimum: 0, maximum: 720 },
      },
    },
    scoreDiff: {
      type: "object",
      additionalProperties: false,
      required: ["gte", "lte"],
      properties: {
        gte: { type: "integer", minimum: -200, maximum: 200 },
        lte: { type: "integer", minimum: -200, maximum: 200 },
      },
    },
  },
} as const;

const limitsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    maxGames: { type: "integer", minimum: 1, maximum: 50 },
    minStarts: { type: "integer", minimum: 1, maximum: 100 },
    maxStartsPerGame: { type: "integer", minimum: 1, maximum: 10 },
  },
} as const;

const gameModeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["player", "filters", "game"],
  properties: {
    player: playerSchema,
    filters: filtersSchema,
    limits: limitsSchema,
    game: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

const seasonModeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["player", "filters", "season"],
  properties: {
    player: playerSchema,
    filters: filtersSchema,
    limits: limitsSchema,
    season: {
      type: "object",
      additionalProperties: false,
      required: ["year", "type"],
      properties: {
        year: { type: "integer", minimum: 2000, maximum: 2100 },
        type: { type: "string", enum: ["REG", "PST", "PRE"] },
      },
    },
  },
} as const;

export const createSituationBodySchema = {
  type: "object",
  oneOf: [gameModeSchema, seasonModeSchema],
} as const;

export const createSituationResponseSchema = {
  201: {
    type: "object",
    additionalProperties: false,
    required: ["id", "gamesScanned", "gamesUsed"],
    properties: {
      id: { type: "string", minLength: 1 },
      gamesScanned: { type: "number" },
      gamesUsed: { type: "number" },
    },
  },
} as const;

export function normalizeCreateSituationInputs(body: CreateSituationRequestBody): SituationInputs {
  const hasGame = !!body.game;
  const hasSeason = !!body.season;
  if (hasGame === hasSeason) {
    throw new InvalidRequestError("Exactly one mode is required: provide either game or season.");
  }

  const playerName = body.player.name.trim();
  if (!playerName) {
    throw new InvalidRequestError("player.name must be non-empty.");
  }

  if (body.filters.timeRemainingSeconds.gte > body.filters.timeRemainingSeconds.lte) {
    throw new InvalidRangeError("timeRemainingSeconds.gte must be <= lte.", {
      field: "filters.timeRemainingSeconds",
    });
  }
  if (body.filters.scoreDiff.gte > body.filters.scoreDiff.lte) {
    throw new InvalidRangeError("scoreDiff.gte must be <= lte.", {
      field: "filters.scoreDiff",
    });
  }

  return {
    player: {
      name: playerName,
      team: body.player.team?.trim().toUpperCase(),
    },
    filters: body.filters,
    limits: {
      maxGames: body.limits?.maxGames ?? DEFAULT_LIMITS.maxGames,
      minStarts: body.limits?.minStarts ?? DEFAULT_LIMITS.minStarts,
      maxStartsPerGame: body.limits?.maxStartsPerGame ?? DEFAULT_LIMITS.maxStartsPerGame,
    },
    game: body.game,
    season: body.season,
  };
}
