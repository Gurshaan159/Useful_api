import "dotenv/config";

export interface AppConfig {
  host: string;
  port: number;
  sportradarNbaApiKey: string;
  sportradarNbaBaseUrl: string;
  sportradarRetryMaxAttempts: number;
  sportradarRetryBaseDelayMs: number;
  sportradarRetryMaxDelayMs: number;
  sportradarSoccerApiKey: string;
  sportradarSoccerAccessLevel: string;
  sportradarSoccerLanguageCode: string;
  sportradarSoccerFormat: string;
  situationPbpMaxConcurrency: number;
  openAiApiKey: string;
  openAiModel: string;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 3000),
    sportradarNbaApiKey: env.SPORTRADAR_NBA_API_KEY ?? env.SPORTRADAR_API_KEY ?? "",
    sportradarNbaBaseUrl: env.SPORTRADAR_NBA_BASE_URL ?? "https://api.sportradar.com/nba/trial/v7/en",
    sportradarRetryMaxAttempts: parsePositiveInteger(env.SPORTRADAR_RETRY_MAX_ATTEMPTS, 5),
    sportradarRetryBaseDelayMs: parsePositiveInteger(env.SPORTRADAR_RETRY_BASE_DELAY_MS, 600),
    sportradarRetryMaxDelayMs: parsePositiveInteger(env.SPORTRADAR_RETRY_MAX_DELAY_MS, 15_000),
    sportradarSoccerApiKey: env.SPORTRADAR_SOCCER_API_KEY ?? "",
    sportradarSoccerAccessLevel: env.SPORTRADAR_SOCCER_ACCESS_LEVEL ?? "trial",
    sportradarSoccerLanguageCode: env.SPORTRADAR_SOCCER_LANGUAGE_CODE ?? "en",
    sportradarSoccerFormat: env.SPORTRADAR_SOCCER_FORMAT ?? "json",
    situationPbpMaxConcurrency: parsePositiveInteger(env.SITUATION_PBP_MAX_CONCURRENCY, 2),
    openAiApiKey: env.OPENAI_API_KEY ?? "",
    openAiModel: env.OPENAI_MODEL ?? "gpt-5.2-mini",
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}
