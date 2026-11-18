import { readFile } from "node:fs/promises";
import { join } from "node:path";

// One plain file name ending in .mp4: no slash, no other extension, nothing before the root of CLIPS_DIR.
const CLIP_NAME = /^[A-Za-z0-9._-]+\.mp4$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export type Clip = ReturnType<typeof Bun.file>;

/**
 * The clip to serve for `name`, or null (the route answers 404). A clip is served only when its name matches
 * CLIP_NAME, some `items[].video` in the current runs.json names it, and the file exists in `clipsDir`.
 * No `clipsDir` means no clips. runs.json is read on every call, like /api/lab.
 */
export async function findClip(name: string, dataDir: string, clipsDir: string | undefined): Promise<Clip | null> {
  if (!clipsDir || !CLIP_NAME.test(name)) return null;

  const runsPath = join(dataDir, "runs.json");
  let runs: unknown;
  try {
    runs = JSON.parse(utf8.decode(await readFile(runsPath)));
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    console.error(`[clips] runs_unavailable: ${runsPath}: ${cause}`);
    return null;
  }
  if (!namesVideo(runs, name)) return null;

  const clip = Bun.file(join(clipsDir, name));
  if (!(await clip.exists())) {
    console.error(`[clips] missing: ${name} is named in runs.json but is not in CLIPS_DIR`);
    return null;
  }
  return clip;
}

function namesVideo(runs: unknown, name: string): boolean {
  return (
    Array.isArray(runs) &&
    runs.some((row) => Array.isArray(row?.items) && row.items.some((item: { video?: unknown } | null) => item?.video === name))
  );
}
