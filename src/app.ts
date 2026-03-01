import Fastify, { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { getConfig } from "./config";
import { errorHandlerPlugin } from "./plugins/error-handler";
import { InMemorySituationRepository } from "./repositories/in-memory-situation-repository";
import { registerPostSituationsRoute } from "./routes/v1/situations.post";
import { registerGetSituationAnalysisRoute } from "./routes/v1/situations.get-summary";
import { registerExportSituationCsvRoute } from "./routes/v1/situations.export-csv";
import { SituationBuilder } from "./services/situation-builder";
import { SportradarClient } from "./integrations/sportradar-client";
import { SportradarSoccerClient } from "./integrations/sportradar-soccer-client";
import { ScheduleCache } from "./integrations/schedule-cache";
import { SituationRepository } from "./repositories/situation-repository";
import { SituationInputs, Situation } from "./domain/situation";
import { NbaAdapter } from "./services/adapters/nba-adapter";
import { SoccerAdapter } from "./services/adapters/soccer-adapter";
import { AdapterRegistry } from "./services/adapters/adapter-registry";
import { registerLiveRoutes } from "./routes/v1/live.routes";
import { registerDocsRoute } from "./routes/docs";
import { InMemoryLiveSessionStore } from "./services/live/live-session-store";
import { LiveSessionService } from "./services/live/live-session-service";
import { OpenAiClient } from "./integrations/openai-client";

export interface BuildAppDeps {
  situationBuilder?: Pick<SituationBuilder, "build"> | { build(inputs: SituationInputs): Promise<Situation> };
  situationRepository?: SituationRepository;
  adapterRegistry?: AdapterRegistry;
  liveSessionService?: LiveSessionService;
}

export async function buildApp(deps: BuildAppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(websocket);
  await app.register(errorHandlerPlugin);
  await registerDocsRoute(app);

  const config = getConfig();
  const scheduleCache = new ScheduleCache();
  const sportradarNbaClient = new SportradarClient({
    apiKey: config.sportradarNbaApiKey,
    baseUrl: config.sportradarNbaBaseUrl,
    scheduleCache,
    retryMaxAttempts: config.sportradarRetryMaxAttempts,
    retryBaseDelayMs: config.sportradarRetryBaseDelayMs,
    retryMaxDelayMs: config.sportradarRetryMaxDelayMs,
  });
  const sportradarSoccerClient = new SportradarSoccerClient({
    apiKey: config.sportradarSoccerApiKey,
    accessLevel: config.sportradarSoccerAccessLevel,
    languageCode: config.sportradarSoccerLanguageCode,
    format: config.sportradarSoccerFormat,
  });
  const adapterRegistry = deps.adapterRegistry ?? new AdapterRegistry([
    new NbaAdapter(sportradarNbaClient),
    new SoccerAdapter(sportradarSoccerClient),
  ]);

  const situationRepository = deps.situationRepository ?? new InMemorySituationRepository();
  const situationBuilder = deps.situationBuilder ?? new SituationBuilder({
    adapterRegistry,
    pbpMaxConcurrency: config.situationPbpMaxConcurrency,
  });
  const liveSessionStore = new InMemoryLiveSessionStore();
  const openAiClient = new OpenAiClient({
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
  });
  const liveSessionService = deps.liveSessionService ?? new LiveSessionService(
    liveSessionStore,
    sportradarSoccerClient,
    sportradarNbaClient,
    openAiClient,
  );

  await registerPostSituationsRoute(app, {
    situationBuilder,
    situationRepository,
  });
  await registerGetSituationAnalysisRoute(app, {
    situationRepository,
    adapterRegistry,
  });
  await registerExportSituationCsvRoute(app, {
    situationRepository,
    adapterRegistry,
  });
  await registerLiveRoutes(app, {
    liveSessionService,
  });

  return app;
}
