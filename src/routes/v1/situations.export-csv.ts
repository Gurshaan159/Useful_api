import { FastifyInstance } from "fastify";
import { Sport } from "../../domain/situation";
import { InvalidRequestError, NotFoundError } from "../../lib/errors";
import { SituationRepository } from "../../repositories/situation-repository";
import { AdapterRegistry } from "../../services/adapters/adapter-registry";

interface ExportCsvDeps {
  situationRepository: SituationRepository;
  adapterRegistry: AdapterRegistry;
}

const exportCsvSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string", minLength: 5, pattern: "^sit_[A-Za-z0-9-]+$" },
    },
  },
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["sport"],
    properties: {
      sport: { type: "string", enum: ["nba", "soccer"] },
      includeSummary: { type: "boolean", default: true },
    },
  },
} as const;

export async function registerExportSituationCsvRoute(
  app: FastifyInstance,
  deps: ExportCsvDeps,
): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { sport: Sport; includeSummary?: boolean } }>(
    "/v1/situations/:id/export.csv",
    { schema: exportCsvSchema },
    async (request, reply) => {
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
      const csv = adapter.exportCsv(situation);

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename=\"situation_${situation.id}.csv\"`);
      return reply.send(csv);
    },
  );
}
