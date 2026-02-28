import { FastifyInstance } from "fastify";
import { NotFoundError } from "../../lib/errors";
import { SituationRepository } from "../../repositories/situation-repository";
import { buildGamesCsv, sortAndLimitGames } from "../../services/situation-games";

interface ExportCsvDeps {
  situationRepository: SituationRepository;
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
    properties: {
      includeSummary: { type: "boolean", default: true },
    },
  },
} as const;

export async function registerExportSituationCsvRoute(
  app: FastifyInstance,
  deps: ExportCsvDeps,
): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { includeSummary?: boolean } }>(
    "/v1/situations/:id/export.csv",
    { schema: exportCsvSchema },
    async (request, reply) => {
      const situation = await deps.situationRepository.getById(request.params.id);
      if (!situation) {
        throw new NotFoundError("Situation not found or expired.", { id: request.params.id });
      }

      const rows = sortAndLimitGames(situation.stats.byGame, "pts", "desc");
      const csv = buildGamesCsv(
        situation.id,
        rows,
        request.query.includeSummary ?? true,
        situation.stats.totals,
        situation.stats.perStart,
      );

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename=\"situation_${situation.id}.csv\"`);
      return reply.send(csv);
    },
  );
}
