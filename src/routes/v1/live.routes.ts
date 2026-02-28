import { FastifyInstance } from "fastify";
import { CreateSessionRequest, LiveSessionService, NbaLiveAnalysisRequest } from "../../services/live/live-session-service";

interface LiveRoutesDeps {
  liveSessionService: LiveSessionService;
}

const liveGamesQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sport"],
  properties: {
    sport: { type: "string", enum: ["soccer", "nba"] },
  },
} as const;

const soccerOnlyQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sport"],
  properties: {
    sport: { type: "string", enum: ["soccer"] },
  },
} as const;

const gamesPlayersQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sport"],
  properties: {
    sport: { type: "string", enum: ["soccer", "nba"] },
  },
} as const;

const sessionCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sport", "sportEventId"],
  properties: {
    sport: { type: "string", enum: ["soccer", "nba"] },
    sportEventId: { type: "string", minLength: 1 },
    focusPlayerId: { type: "string", minLength: 1 },
    focusPlayerName: { type: "string", minLength: 1 },
    preferences: {
      type: "object",
      additionalProperties: false,
      properties: {
        verbosity: { type: "string", enum: ["short", "medium", "high"] },
      },
    },
  },
} as const;

export async function registerLiveRoutes(app: FastifyInstance, deps: LiveRoutesDeps): Promise<void> {
  app.get<{ Querystring: { sport: "soccer" | "nba" } }>(
    "/v1/live/games",
    { schema: { querystring: liveGamesQuerySchema } },
    async (request) => {
      return deps.liveSessionService.getLiveGames(request.query.sport);
    },
  );

  app.get<{ Params: { sportEventId: string }; Querystring: { sport: "soccer" | "nba" } }>(
    "/v1/live/games/:sportEventId/players",
    {
      schema: {
        querystring: gamesPlayersQuerySchema,
        params: {
          type: "object",
          additionalProperties: false,
          required: ["sportEventId"],
          properties: {
            sportEventId: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      return deps.liveSessionService.getPlayersForGame(request.params.sportEventId, request.query.sport);
    },
  );

  app.post<{ Body: NbaLiveAnalysisRequest }>(
    "/v1/live/nba/analysis",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["sportEventId"],
          properties: {
            sportEventId: { type: "string", minLength: 1 },
            focusPlayerId: { type: "string", minLength: 1 },
            focusPlayerName: { type: "string", minLength: 1 },
            verbosity: { type: "string", enum: ["short", "medium", "high"] },
          },
        },
      },
    },
    async (request) => {
      return deps.liveSessionService.analyzeNbaPlayerLive(request.body);
    },
  );

  app.post<{ Body: CreateSessionRequest }>(
    "/v1/live/sessions",
    {
      schema: {
        body: sessionCreateBodySchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["id"],
            properties: {
              id: { type: "string" },
            },
          },
        },
      },
    },
    async (request) => {
      return deps.liveSessionService.createSession(request.body);
    },
  );

  app.get(
    "/v1/live/sessions/:id/stream",
    { websocket: true },
    (connection, req) => {
      const params = req.params as { id: string };
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = deps.liveSessionService.subscribe(params.id, (message) => {
          connection.send(JSON.stringify(message));
        });
      } catch (error) {
        const errMessage = {
          type: "error",
          ts: new Date().toISOString(),
          data: {
            code: "NOT_FOUND",
            message: error instanceof Error ? error.message : "Session not found.",
          },
        };
        connection.send(JSON.stringify(errMessage));
        connection.close();
        return;
      }
      connection.on("close", () => {
        if (unsubscribe) {
          unsubscribe();
        }
      });
    },
  );
}
