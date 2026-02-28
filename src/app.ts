import Fastify, { FastifyInstance } from "fastify";
import { getConfig } from "./config";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { InMemorySituationRepository } from "./repositories/in-memory-situation-repository";
import { registerPostSituationsRoute } from "./routes/v1/situations.post";
import { registerGetSituationAnalysisRoute } from "./routes/v1/situations.get-summary";
import { registerExportSituationCsvRoute } from "./routes/v1/situations.export-csv";
import { SituationBuilder } from "./services/situation-builder";
import { SportradarClient } from "./integrations/sportradar-client";
import { ScheduleCache } from "./integrations/schedule-cache";
import { SituationRepository } from "./repositories/situation-repository";
import { SituationInputs, Situation } from "./domain/situation";

export interface BuildAppDeps {
  situationBuilder?: Pick<SituationBuilder, "build"> | { build(inputs: SituationInputs): Promise<Situation> };
  situationRepository?: SituationRepository;
}

export async function buildApp(deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(errorHandlerPlugin);

  const config = getConfig();
  const scheduleCache = new ScheduleCache();
  const sportradarClient = new SportradarClient({
    apiKey: config.sportradarApiKey,
    baseUrl: config.sportradarBaseUrl,
    scheduleCache,
  });
  const situationRepository = deps.situationRepository ?? new InMemorySituationRepository();
  const situationBuilder = deps.situationBuilder ?? new SituationBuilder({ sportradarClient });

  await registerPostSituationsRoute(app, {
    situationBuilder,
    situationRepository,
  });
  await registerGetSituationAnalysisRoute(app, {
    situationRepository,
  });
  await registerExportSituationCsvRoute(app, {
    situationRepository,
  });

  return app;
}
