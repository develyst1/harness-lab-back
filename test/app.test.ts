import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, loadConfig } from "../src/app.ts";

const REPO_DATA = join(import.meta.dir, "..", "data");
const ORIGIN = "http://localhost:4100";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function appFor(dataDir: string, corsOrigin = ORIGIN) {
  return createApp({ dataDir, corsOrigin });
}

let tmpRoot: string;
beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "harness-lab-back-test-"));
});
afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function makeDataDir(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(tmpRoot, name);
  await mkdir(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) await writeFile(join(dir, file), text);
  return dir;
}

// The smallest valid data dir: all four pack files, each valid JSON.
const MINIMAL: Record<string, string> = { "runs.json": "[]", "tiers.json": "[]", "meta.json": "{}", "page.json": "{}" };

function minimalWithout(file: string): Record<string, string> {
  const files = { ...MINIMAL };
  delete files[file];
  return files;
}

const repoText = (file: string) => readFile(join(REPO_DATA, file), "utf8");

describe("GET /api/lab", () => {
  test("200 body equals the four data files parsed", async () => {
    const res = await appFor(REPO_DATA).request("/api/lab");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runs: await readJson(join(REPO_DATA, "runs.json")),
      tiers: await readJson(join(REPO_DATA, "tiers.json")),
      meta: await readJson(join(REPO_DATA, "meta.json")),
      page: await readJson(join(REPO_DATA, "page.json")),
    });
  });

  test("body keys are exactly meta, page, runs, tiers", async () => {
    const body = (await (await appFor(REPO_DATA).request("/api/lab")).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["meta", "page", "runs", "tiers"]);
  });

  test("rows keep pack order R1, R2, R3, R4a, R4b, R5", async () => {
    const body = (await (await appFor(REPO_DATA).request("/api/lab")).json()) as { runs: { id: string }[] };
    expect(body.runs.map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4a", "R4b", "R5"]);
  });

  test("Content-Type is application/json; charset=utf-8 and Cache-Control is no-store", async () => {
    const res = await appFor(REPO_DATA).request("/api/lab");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a DATA_DIR with one more row appended returns it last, earlier rows unchanged", async () => {
    const runs = (await readJson(join(REPO_DATA, "runs.json"))) as Record<string, unknown>[];
    const extra = { ...runs[runs.length - 1], id: "R-test", title: "appended test row" };
    const dir = await makeDataDir("appended-row", {
      "runs.json": JSON.stringify([...runs, extra]),
      "tiers.json": await repoText("tiers.json"),
      "meta.json": await repoText("meta.json"),
      "page.json": await repoText("page.json"),
    });
    const body = (await (await appFor(dir).request("/api/lab")).json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(runs.length + 1);
    expect(body.runs.slice(0, runs.length)).toEqual(runs);
    expect(body.runs[runs.length]).toEqual(extra);
  });

  test("data is read on every request (a changed file needs no restart)", async () => {
    const dir = await makeDataDir("reread", { ...MINIMAL, "runs.json": "[1]" });
    const app = appFor(dir);
    expect(((await (await app.request("/api/lab")).json()) as { runs: unknown[] }).runs).toEqual([1]);
    await writeFile(join(dir, "runs.json"), "[1,2]");
    expect(((await (await app.request("/api/lab")).json()) as { runs: unknown[] }).runs).toEqual([1, 2]);
  });
});

describe("GET /api/lab when data is unavailable", () => {
  let errorSpy: ReturnType<typeof spyOn>;
  beforeAll(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockClear());
  afterAll(() => errorSpy.mockRestore());

  test("missing data dir -> 500 data_unavailable, cause logged, not in body", async () => {
    const res = await appFor(join(tmpRoot, "does-not-exist")).request("/api/lab");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "data_unavailable" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("ENOENT");
  });

  test.each(["tiers.json", "meta.json", "page.json"])(
    "missing %s only -> 500 data_unavailable, log names it",
    async (file) => {
      const dir = await makeDataDir(`no-${file}`, minimalWithout(file));
      const res = await appFor(dir).request("/api/lab");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "data_unavailable" });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain(file);
    },
  );

  test("invalid JSON -> 500 data_unavailable, log names the broken file", async () => {
    const dir = await makeDataDir("bad-json", { ...MINIMAL, "tiers.json": "[{not json" });
    const res = await appFor(dir).request("/api/lab");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "data_unavailable" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("tiers.json");
  });

  test("invalid UTF-8 -> 500 data_unavailable (not served with replacement characters)", async () => {
    const dir = await makeDataDir("bad-utf8", minimalWithout("runs.json"));
    await writeFile(join(dir, "runs.json"), new Uint8Array([0x5b, 0x22, 0xff, 0xfe, 0x22, 0x5d])); // ["\xFF\xFE"]
    const res = await appFor(dir).request("/api/lab");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "data_unavailable" });
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("runs.json");
  });

  test("Cache-Control is no-store on the 500 too", async () => {
    const res = await appFor(join(tmpRoot, "does-not-exist")).request("/api/lab");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/health", () => {
  test("200 { ok: true } without reading data", async () => {
    const res = await appFor(join(tmpRoot, "does-not-exist")).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("anything else", () => {
  test("unknown path -> 404 { error: not_found }", async () => {
    const res = await appFor(REPO_DATA).request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("POST /api/lab -> 404 { error: not_found }", async () => {
    const res = await appFor(REPO_DATA).request("/api/lab", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("CORS", () => {
  test("Access-Control-Allow-Origin equals the CORS_ORIGIN env value", async () => {
    const env = { CORS_ORIGIN: "https://lab.example.test" };
    const app = createApp({ ...loadConfig(env), dataDir: REPO_DATA });
    const res = await app.request("/api/lab", { headers: { Origin: env.CORS_ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).toBe(env.CORS_ORIGIN);
  });

  test("another origin gets no Access-Control-Allow-Origin (never *)", async () => {
    const res = await appFor(REPO_DATA).request("/api/lab", { headers: { Origin: "https://other.example.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// /clips/:file goes through a real Bun.serve: Range (206) is answered by Bun itself, never by app.request().
describe("GET /clips/:file", () => {
  const CLIP = new Uint8Array(1000).map((_, i) => i % 251); // fake .mp4 bytes, not a real clip
  let clipsDir: string;
  let dataDir: string;
  let server: ReturnType<typeof Bun.serve>;
  let errorSpy: ReturnType<typeof spyOn>;
  const base = () => `http://127.0.0.1:${server.port}`;
  const serve = (config: { dataDir: string; clipsDir?: string }) =>
    Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: createApp({ corsOrigin: ORIGIN, ...config }).fetch });

  const named = (...videos: string[]) => JSON.stringify([{ id: "R1", items: [{}, ...videos.map((video) => ({ video }))] }, { id: "R2" }]);

  beforeAll(async () => {
    // "../secret.mp4" is named in runs.json and exists one level up: only the name pattern stops it.
    clipsDir = join(tmpRoot, "clips-root", "clips");
    await mkdir(clipsDir, { recursive: true });
    for (const file of ["a.mp4", "stray.mp4", "a.txt", ".mp4"]) await writeFile(join(clipsDir, file), CLIP);
    await writeFile(join(tmpRoot, "clips-root", "secret.mp4"), CLIP);
    dataDir = await makeDataDir("clips-data", {
      ...MINIMAL,
      "runs.json": named("a.mp4", "gone.mp4", "a.txt", ".mp4", "../secret.mp4"),
    });
    server = serve({ dataDir, clipsDir });
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockClear());
  afterAll(() => {
    server.stop(true);
    errorSpy.mockRestore();
  });

  async function expectNotFound(res: Response) {
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  }

  test("named in runs.json + present in CLIPS_DIR -> 200, the file's bytes, video headers", async () => {
    const res = await fetch(`${base()}/clips/a.mp4`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-length")).toBe(String(CLIP.length));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CLIP);
  });

  test("Range: bytes=0-9 -> 206, Content-Range bytes 0-9/<size>, 10 bytes", async () => {
    const res = await fetch(`${base()}/clips/a.mp4`, { headers: { Range: "bytes=0-9" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-9/${CLIP.length}`);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes"); // once: Bun adds its own on 206
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CLIP.slice(0, 10));
  });

  test("Range past the end -> 416, Content-Range bytes */<size>, Accept-Ranges once", async () => {
    const res = await fetch(`${base()}/clips/a.mp4`, { headers: { Range: `bytes=${CLIP.length}-` } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${CLIP.length}`);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  test("Range with an Origin header (CORS middleware touches the response) -> still 206", async () => {
    const res = await fetch(`${base()}/clips/a.mp4`, { headers: { Range: "bytes=0-9", Origin: ORIGIN } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-9/${CLIP.length}`);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CLIP.slice(0, 10));
  });

  test("Range from the middle -> 206 with those bytes", async () => {
    const res = await fetch(`${base()}/clips/a.mp4`, { headers: { Range: "bytes=500-999" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 500-999/${CLIP.length}`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CLIP.slice(500, 1000));
  });

  test("HEAD -> 200 with the same headers and Content-Length, no body", async () => {
    const res = await fetch(`${base()}/clips/a.mp4`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe(String(CLIP.length));
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test("present in CLIPS_DIR but not named in runs.json -> 404", async () => {
    await expectNotFound(await fetch(`${base()}/clips/stray.mp4`));
  });

  test("named in runs.json but absent from CLIPS_DIR -> 404, log names the file", async () => {
    await expectNotFound(await fetch(`${base()}/clips/gone.mp4`));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("gone.mp4");
  });

  // a.txt, .mp4 and ../secret.mp4 are named in runs.json and present: for them only the name pattern answers 404.
  test.each(["a.txt", ".mp4", "..%2Fsecret.mp4", "a%2F..mp4", "..%2Fdata%2Fruns.json", "%2E%2E%2Fsecret.mp4"])(
    "bad name %p -> 404, nothing logged",
    async (name) => {
      await expectNotFound(await fetch(`${base()}/clips/${name}`));
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  test("../x.mp4 in the path -> 404", async () => {
    await expectNotFound(await appFor(dataDir).request("/clips/../secret.mp4"));
  });

  test("CLIPS_DIR unset -> 404 for a named, present clip", async () => {
    const noClips = serve({ dataDir });
    try {
      await expectNotFound(await fetch(`http://127.0.0.1:${noClips.port}/clips/a.mp4`));
    } finally {
      noClips.stop(true);
    }
  });

  test("runs.json unreadable -> 404, cause logged, not in body", async () => {
    const broken = serve({ dataDir: join(tmpRoot, "does-not-exist"), clipsDir });
    try {
      const res = await fetch(`http://127.0.0.1:${broken.port}/clips/a.mp4`);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ error: "not_found" });
      expect(body).not.toContain("ENOENT");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("runs.json");
    } finally {
      broken.stop(true);
    }
  });

  test("runs.json is read on every request (a clip named later needs no restart)", async () => {
    const dir = await makeDataDir("clips-reread", { ...MINIMAL, "runs.json": named() });
    const app = createApp({ dataDir: dir, clipsDir, corsOrigin: ORIGIN });
    await expectNotFound(await app.request("/clips/a.mp4"));
    await writeFile(join(dir, "runs.json"), named("a.mp4"));
    expect((await app.request("/clips/a.mp4")).status).toBe(200);
  });

  test("/api/lab is unchanged when CLIPS_DIR is set", async () => {
    const res = await fetch(`${base()}/api/lab`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: JSON.parse(named("a.mp4", "gone.mp4", "a.txt", ".mp4", "../secret.mp4")), tiers: [], meta: {}, page: {} });
  });
});

describe("loadConfig", () => {
  test("CLIPS_DIR is read from the env; unset or empty means no clips", () => {
    expect(loadConfig({ CLIPS_DIR: "/srv/clips" }).clipsDir).toBe("/srv/clips");
    expect(loadConfig({}).clipsDir).toBeUndefined();
    expect(loadConfig({ CLIPS_DIR: "" }).clipsDir).toBeUndefined();
  });

  test("defaults when the env is empty", () => {
    expect(loadConfig({})).toEqual({
      port: 4101,
      host: "127.0.0.1",
      corsOrigin: "http://localhost:4100",
      dataDir: "./data",
    });
  });

  test("reads PORT, HOST, CORS_ORIGIN, DATA_DIR from the env", () => {
    expect(
      loadConfig({ PORT: "4999", HOST: "0.0.0.0", CORS_ORIGIN: "https://x.example.test", DATA_DIR: "/srv/data" }),
    ).toEqual({ port: 4999, host: "0.0.0.0", corsOrigin: "https://x.example.test", dataDir: "/srv/data" });
  });

  test.each(["abc", "70000", "0", " ", "0x10", "1e3", "4101.5", "-1"])("PORT=%p throws instead of falling back", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });

  test.each(["*", "http://localhost:4100/", "http://a.test,http://b.test", "localhost:4100", "not a url"])(
    "CORS_ORIGIN=%p throws (exactly one origin, never *)",
    (origin) => {
      expect(() => loadConfig({ CORS_ORIGIN: origin })).toThrow(/CORS_ORIGIN/);
    },
  );
});
