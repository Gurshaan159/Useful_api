import { DEFAULT_LIMITS, SituationInputs, Sport } from "../../domain/situation";
import { InvalidRangeError, InvalidRequestError } from "../../lib/errors";

export interface CreateSituationRequestBody {
  sport?: Sport;
  player: {
    name: string;
    id?: string;
    team?: string;
  };
  filters: Record<string, any> & {
    nba?: {
      quarter: 1 | 2 | 3 | 4;
      timeRemainingSeconds: { gte: number; lte: number };
      scoreDiff: { gte: number; lte: number };
    };
    soccer?: {
      half: 1 | 2;
      minuteRange: { gte: number; lte: number };
      scoreState: "leading" | "drawing" | "trailing";
      goalDiffRange?: { gte: number; lte: number };
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

const nbaSportFiltersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nba"],
  properties: {
    nba: filtersSchema,
  },
} as const;

const soccerFiltersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["soccer"],
  properties: {
    soccer: {
      type: "object",
      additionalProperties: false,
      required: ["half", "minuteRange", "scoreState"],
      properties: {
        half: { type: "integer", enum: [1, 2] },
        minuteRange: {
          type: "object",
          additionalProperties: false,
          required: ["gte", "lte"],
          properties: {
            gte: { type: "integer", minimum: 0, maximum: 120 },
            lte: { type: "integer", minimum: 0, maximum: 120 },
          },
        },
        scoreState: { type: "string", enum: ["leading", "drawing", "trailing"] },
        goalDiffRange: {
          type: "object",
          additionalProperties: false,
          required: ["gte", "lte"],
          properties: {
            gte: { type: "integer", minimum: -5, maximum: 5 },
            lte: { type: "integer", minimum: -5, maximum: 5 },
          },
        },
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

const newNbaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sport", "player", "filters"],
  properties: {
    sport: { type: "string", enum: ["nba"] },
    player: {
      ...playerSchema,
      properties: {
        ...playerSchema.properties,
        id: { type: "string", minLength: 1 },
      },
    },
    filters: nbaSportFiltersSchema,
    limits: limitsSchema,
    game: gameModeSchema.properties.game,
    season: seasonModeSchema.properties.season,
  },
  oneOf: [
    { required: ["game"] },
    { required: ["season"] },
  ],
} as const;

const newSoccerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sport", "player", "filters"],
  properties: {
    sport: { type: "string", enum: ["soccer"] },
    player: {
      ...playerSchema,
      properties: {
        ...playerSchema.properties,
        id: { type: "string", minLength: 1 },
      },
    },
    filters: soccerFiltersSchema,
    limits: limitsSchema,
    game: gameModeSchema.properties.game,
    season: seasonModeSchema.properties.season,
  },
  oneOf: [
    { required: ["game"] },
    { required: ["season"] },
  ],
} as const;

export const createSituationBodySchema = {
  type: "object",
  additionalProperties: true,
  required: ["player", "filters"],
  properties: {
    sport: { type: "string", enum: ["nba", "soccer"] },
    player: {
      type: "object",
      additionalProperties: true,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        id: { type: "string", minLength: 1 },
        team: { type: "string", minLength: 1 },
      },
    },
    filters: { type: "object" },
    limits: limitsSchema,
    game: gameModeSchema.properties.game,
    season: seasonModeSchema.properties.season,
  },
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
  const sport = body.sport ?? "nba";
  const hasGame = !!body.game;
  const hasSeason = !!body.season;
  if (hasGame === hasSeason) {
    throw new InvalidRequestError("Exactly one mode is required: provide either game or season.");
  }

  const playerName = body.player.name.trim();
  if (!playerName) {
    throw new InvalidRequestError("player.name must be non-empty.");
  }

  const filters = normalizeFilters(sport, body.filters);

  return {
    sport,
    player: {
      name: playerName,
      id: body.player.id?.trim(),
      team: body.player.team?.trim().toUpperCase(),
    },
    filters,
    limits: {
      maxGames: body.limits?.maxGames ?? DEFAULT_LIMITS.maxGames,
      minStarts: body.limits?.minStarts ?? DEFAULT_LIMITS.minStarts,
      maxStartsPerGame: body.limits?.maxStartsPerGame ?? DEFAULT_LIMITS.maxStartsPerGame,
    },
    game: body.game,
    season: body.season,
  };
}

function normalizeFilters(sport: Sport, filters: CreateSituationRequestBody["filters"]): SituationInputs["filters"] {
  if (sport === "nba") {
    const nba = filters.nba ?? {
      quarter: filters.quarter,
      timeRemainingSeconds: filters.timeRemainingSeconds,
      scoreDiff: filters.scoreDiff,
    };
    if (!nba || !nba.timeRemainingSeconds || !nba.scoreDiff || !nba.quarter) {
      throw new InvalidRequestError("filters.nba is required for sport=nba.");
    }
    if (nba.timeRemainingSeconds.gte > nba.timeRemainingSeconds.lte) {
      throw new InvalidRangeError("timeRemainingSeconds.gte must be <= lte.", {
        field: "filters.nba.timeRemainingSeconds",
      });
    }
    if (nba.scoreDiff.gte > nba.scoreDiff.lte) {
      throw new InvalidRangeError("scoreDiff.gte must be <= lte.", {
        field: "filters.nba.scoreDiff",
      });
    }
    return { nba };
  }

  const soccer = filters.soccer;
  if (!soccer) {
    throw new InvalidRequestError("filters.soccer is required for sport=soccer.");
  }
  if (soccer.minuteRange.gte > soccer.minuteRange.lte) {
    throw new InvalidRangeError("minuteRange.gte must be <= lte.", {
      field: "filters.soccer.minuteRange",
    });
  }
  if (soccer.goalDiffRange && soccer.goalDiffRange.gte > soccer.goalDiffRange.lte) {
    throw new InvalidRangeError("goalDiffRange.gte must be <= lte.", {
      field: "filters.soccer.goalDiffRange",
    });
  }
  return { soccer };
}
