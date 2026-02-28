import { buildApp } from "./app";
import { getConfig } from "./config";

async function start(): Promise<void> {
  const app = await buildApp();
  const config = getConfig();
  await app.listen({ host: config.host, port: config.port });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
