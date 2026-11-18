import { resolve } from "node:path";
import { createApp, loadConfig } from "./app.ts";

const config = loadConfig(process.env);
const app = createApp(config);

const server = Bun.serve({ port: config.port, hostname: config.host, fetch: app.fetch });

console.log(
  `harness-lab-back listening on http://${server.hostname}:${server.port}` +
    ` · CORS_ORIGIN=${config.corsOrigin} · DATA_DIR=${resolve(config.dataDir)}` +
    ` · CLIPS_DIR=${config.clipsDir ? resolve(config.clipsDir) : "unset (no clips served)"}`,
);
