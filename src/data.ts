import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type LabData = { runs: unknown; tiers: unknown; meta: unknown; page: unknown };

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

// Reads the pack files as they are: no sort, no reshape, no added field.
// Throws when a file is missing, is not UTF-8 or is not valid JSON; the error message names the file.
export async function readLabData(dataDir: string): Promise<LabData> {
  const [runs, tiers, meta, page] = await Promise.all([
    readJsonFile(join(dataDir, "runs.json")),
    readJsonFile(join(dataDir, "tiers.json")),
    readJsonFile(join(dataDir, "meta.json")),
    readJsonFile(join(dataDir, "page.json")),
  ]);
  return { runs, tiers, meta, page };
}
