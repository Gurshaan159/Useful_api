import { FastifyInstance } from "fastify";
import { InvalidRequestError, NotFoundError } from "../../lib/errors";
import { SituationRepository } from "../../repositories/situation-repository";
import { AdapterRegistry } from "../../services/adapters/adapter-registry";
import { Sport } from "../../domain/situation";

interface GetSummaryDeps {
  situationRepository: SituationRepository;
  adapterRegistry: AdapterRegistry;
}

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      minLength: 5,
      pattern: "^sit_[A-Za-z0-9-]+$",
    },
  },
} as const;

const responseSchema = {
  200: {
    type: "object",
    additionalProperties: false,
    required: ["id", "status", "analysis"],
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["ready", "failed"] },
      analysis: {
        type: "object",
        additionalProperties: false,
        required: ["gamesScanned", "gamesUsed", "startsMatched", "reliabilityGrade", "totals", "perStart"],
        properties: {
          gamesScanned: { type: "number" },
          gamesUsed: { type: "number" },
          startsMatched: { type: "number" },
          reliabilityGrade: { type: "string", enum: ["A", "B", "C", "D"] },
          totals: {
            type: "object",
            additionalProperties: { type: "number" },
          },
          perStart: {
            type: "object",
            additionalProperties: { type: "number" },
          },
        },
      },
    },
  },
} as const;

const querySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sport"],
  properties: {
    sport: { type: "string", enum: ["nba", "soccer"] },
  },
} as const;

export async function registerGetSituationAnalysisRoute(
  app: FastifyInstance,
  deps: GetSummaryDeps,
): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { sport: Sport } }>(
    "/v1/situations/:id/analysis",
    {
      schema: {
        params: paramsSchema,
        querystring: querySchema,
        response: responseSchema,
      },
    },
    async (request) => {
      const situation = await deps.situationRepository.getById(request.params.id);
      if (!situation) {
        throw new NotFoundError("Situation not found or expired.", { id: request.params.id });
      }
      if (situation.sport !== request.query.sport) {
        throw new InvalidRequestError("sport query does not match stored situation sport.", {
          expected: situation.sport,
          received: request.query.sport,
        });
      }
      const adapter = deps.adapterRegistry.get(request.query.sport);
      const analysis = adapter.analysis(situation);

      return {
        id: situation.id,
        status: situation.status,
        analysis,
      };
    },
  );
}
