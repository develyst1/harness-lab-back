import { Hono } from "hono";
import { cors } from "hono/cors";
import { findClip } from "./clips.ts";
import { type LabData, readLabData } from "./data.ts";

export type AppConfig = { dataDir: string; corsOrigin: string; clipsDir?: string };
export type Config = AppConfig & { port: number; host: string };

const DEFAULT_PORT = 4101;
const DEFAULT_CORS_ORIGIN = "http://localhost:4100";

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!(port >= 1 && port <= 65535)) {
    throw new Error(`PORT must be a whole number from 1 to 65535, got "${value}"`);
  }
  return port;
}

// Exactly one origin (scheme://host[:port], no path), never "*".
function parseCorsOrigin(value: string | undefined): string {
  if (!value) return DEFAULT_CORS_ORIGIN;
  let origin: string | undefined;
  try {
    origin = new URL(value).origin;
  } catch {
    origin = undefined;
  }
  if (origin !== value) {
    throw new Error(`CORS_ORIGIN must be exactly one origin such as ${DEFAULT_CORS_ORIGIN} (no path, never *), got "${value}"`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    port: parsePort(env.PORT),
    host: env.HOST || "127.0.0.1",
    corsOrigin: parseCorsOrigin(env.CORS_ORIGIN),
    dataDir: env.DATA_DIR || "./data",
    clipsDir: env.CLIPS_DIR || undefined, // no default: unset = no clips served
  };
}

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.use("*", cors({ origin: config.corsOrigin, allowMethods: ["GET"] }));

  app.get("/api/lab", async (c) => {
    c.header("Cache-Control", "no-store");
    let data: LabData;
    try {
      data = await readLabData(config.dataDir);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      console.error(`[api/lab] data_unavailable: ${cause}`);
      return c.json({ error: "data_unavailable" }, 500);
    }
    return c.json(data, 200, { "Content-Type": "application/json; charset=utf-8" });
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // A Bun.file body: Bun.serve answers Range itself (206, or 416) and then adds its own Accept-Ranges, so ours
  // goes only on requests without Range. HEAD is served by this GET route, but Hono drops the body for it, so
  // Bun cannot size it: HEAD carries Content-Length itself.
  app.get("/clips/:file", async (c) => {
    const clip = await findClip(c.req.param("file"), config.dataDir, config.clipsDir);
    if (!clip) return c.json({ error: "not_found" }, 404);
    const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "no-cache" });
    if (!c.req.header("Range")) headers.set("Accept-Ranges", "bytes");
    if (c.req.method === "HEAD") headers.set("Content-Length", String(clip.size));
    return new Response(clip, { headers });
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}
