import { FastifyInstance } from "fastify";
import { NotFoundError } from "../../lib/errors";
import { SituationRepository } from "../../repositories/situation-repository";

interface GetSummaryDeps {
  situationRepository: SituationRepository;
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
            additionalProperties: false,
            required: ["pts", "reb", "ast", "threePm"],
            properties: {
              pts: { type: "number" },
              reb: { type: "number" },
              ast: { type: "number" },
              threePm: { type: "number" },
            },
          },
          perStart: {
            type: "object",
            additionalProperties: false,
            required: ["pts", "reb", "ast", "threePm"],
            properties: {
              pts: { type: "number" },
              reb: { type: "number" },
              ast: { type: "number" },
              threePm: { type: "number" },
            },
          },
        },
      },
    },
  },
} as const;

export async function registerGetSituationAnalysisRoute(
  app: FastifyInstance,
  deps: GetSummaryDeps,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/v1/situations/:id/analysis",
    {
      schema: {
        params: paramsSchema,
        response: responseSchema,
      },
    },
    async (request) => {
      const situation = await deps.situationRepository.getById(request.params.id);
      if (!situation) {
        throw new NotFoundError("Situation not found or expired.", { id: request.params.id });
      }

      return {
        id: situation.id,
        status: situation.status,
        analysis: {
          gamesScanned: situation.meta.gamesScanned,
          gamesUsed: situation.meta.gamesUsed,
          startsMatched: situation.meta.startsMatched,
          reliabilityGrade: situation.meta.reliabilityGrade,
          totals: situation.stats.totals,
          perStart: situation.stats.perStart,
        },
      };
    },
  );
}
