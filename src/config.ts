import "dotenv/config";

export interface AppConfig {
  host: string;
  port: number;
  sportradarApiKey: string;
  sportradarBaseUrl: string;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 3000),
    sportradarApiKey: env.SPORTRADAR_API_KEY ?? "",
    sportradarBaseUrl: env.SPORTRADAR_BASE_URL ?? "https://api.sportradar.com/nba/trial/v7/en",
  };
}
