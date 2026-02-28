import "dotenv/config";

export interface AppConfig {
  host: string;
  port: number;
  sportradarNbaApiKey: string;
  sportradarNbaBaseUrl: string;
  sportradarSoccerApiKey: string;
  sportradarSoccerAccessLevel: string;
  sportradarSoccerLanguageCode: string;
  sportradarSoccerFormat: string;
  openAiApiKey: string;
  openAiModel: string;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 3000),
    sportradarNbaApiKey: env.SPORTRADAR_NBA_API_KEY ?? env.SPORTRADAR_API_KEY ?? "",
    sportradarNbaBaseUrl: env.SPORTRADAR_NBA_BASE_URL ?? "https://api.sportradar.com/nba/trial/v7/en",
    sportradarSoccerApiKey: env.SPORTRADAR_SOCCER_API_KEY ?? "",
    sportradarSoccerAccessLevel: env.SPORTRADAR_SOCCER_ACCESS_LEVEL ?? "trial",
    sportradarSoccerLanguageCode: env.SPORTRADAR_SOCCER_LANGUAGE_CODE ?? "en",
    sportradarSoccerFormat: env.SPORTRADAR_SOCCER_FORMAT ?? "json",
    openAiApiKey: env.OPENAI_API_KEY ?? "",
    openAiModel: env.OPENAI_MODEL ?? "gpt-5.2-mini",
  };
}
