import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type LabData = { runs: unknown; tiers: unknown; meta: unknown; page: unknown; techniques: unknown; meeting: unknown | null };

// fatal: invalid UTF-8 is an error, never silently replaced with U+FFFD.
const utf8 = new TextDecoder("utf-8", { fatal: true });

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(utf8.decode(await readFile(path)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${path}: ${message}`, { cause: err });
  }
}

// meeting.json is optional: a missing file (ENOENT only) is null; any other failure throws as the other files do.
async function readOptionalJsonFile(path: string): Promise<unknown | null> {
  try {
    return await readJsonFile(path);
  } catch (err) {
    if ((err as { cause?: { code?: unknown } }).cause?.code === "ENOENT") return null;
    throw err;
  }
}

// SPEC-011 Contract 2, defence in depth: the stored meeting has no `product` and no `source` (Contract 1), and if a file
// ever holds them they are deleted here before serving. This is the one reshape this back does.
function withoutPrivateKeys(meeting: unknown): unknown {
  if (meeting === null || typeof meeting !== "object" || Array.isArray(meeting)) return meeting;
  const { product: _product, source: _source, ...rest } = meeting as Record<string, unknown>;
  return rest;
}

// Reads the pack files as they are: no sort, no reshape, no added field. The one exception: `meeting` loses its
// `product` and `source` keys (SPEC-011 Contract 2).
// Throws when a required file is missing, or any file is not UTF-8 or not valid JSON; the error message names the file.
export async function readLabData(dataDir: string): Promise<LabData> {
  const [runs, tiers, meta, page, techniques, meeting] = await Promise.all([
    readJsonFile(join(dataDir, "runs.json")),
    readJsonFile(join(dataDir, "tiers.json")),
    readJsonFile(join(dataDir, "meta.json")),
    readJsonFile(join(dataDir, "page.json")),
    readJsonFile(join(dataDir, "techniques.json")),
    readOptionalJsonFile(join(dataDir, "meeting.json")),
  ]);
  return { runs, tiers, meta, page, techniques, meeting: withoutPrivateKeys(meeting) };
}
