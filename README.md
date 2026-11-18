# harness-lab-back

Bun + Hono API that serves the Harness Lab data (`data/runs.json`, `data/tiers.json`, `data/meta.json`,
`data/page.json`) as one JSON document.

## Routes

- `GET /api/lab` → `{ "runs": [...], "tiers": [...], "meta": {...}, "page": {...} }`, the four data files verbatim,
  read from disk on every request. `500 { "error": "data_unavailable" }` when any of them is missing or is not valid JSON.
- `GET /api/health` → `{ "ok": true }`
- `GET /clips/:file` (and `HEAD`) → the `.mp4` from `CLIPS_DIR` (outside git), `206` on `Range`, only when `runs.json`
  names it in `items[].video`; otherwise, or with `CLIPS_DIR` unset, `404 { "error": "not_found" }`.
- anything else → `404 { "error": "not_found" }`

## Run

```bash
bun install
bun run dev        # watch mode, http://127.0.0.1:4101
bun run start      # no watch
```

Settings come from the environment; every key and its default is in `.env.example`.

## Test

```bash
bun test
bun run typecheck
```

## Build

```bash
bun run build        # dist/harness-lab-back, Linux x86_64 (the server)
bun run build:local  # dist/harness-lab-back-local, this machine
```

The binary does not carry `data/`: ship the folder beside it, or point `DATA_DIR` at it.
On the server: `PORT=4101 HOST=127.0.0.1 DATA_DIR=./data ./harness-lab-back`.
