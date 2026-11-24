// SPEC-011 Contract 1: store the pack's meeting.json for this repo, without the two top-level keys `product` and
// `source` (they name the private product and its path; this repo is public). Every other key is kept as it is.
// Usage: bun scripts/store-meeting.ts <pack meeting.json> <out>
import { readFile, writeFile } from "node:fs/promises";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error("usage: bun scripts/store-meeting.ts <pack meeting.json> <out>");

const meeting = JSON.parse(await readFile(from, "utf8"));
if (meeting === null || typeof meeting !== "object" || Array.isArray(meeting)) {
  throw new Error(`${from}: the meeting must be a JSON object`);
}
delete meeting.product;
delete meeting.source;
await writeFile(to, JSON.stringify(meeting, null, 2) + "\n");
console.log(`${to}: ${Object.keys(meeting).length} keys (product and source removed)`);
