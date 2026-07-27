# AGENTS.md

## Project

`penn-fyi` is an open-source, nationwide transit-awareness MCP server. Amtrak is
the first priority. Near-term regional priorities are New York/New Jersey,
Pennsylvania (especially the Pocono PA-940/I-380/US-611 corridor), the San
Francisco Bay Area, Massachusetts, Connecticut, and the DC–Maryland–Virginia
region.

## Architecture contract

- One stateless Cloudflare Worker.
- Streamable HTTP MCP is served at `/mcp` with `createMcpHandler()` from
  `agents/mcp`.
- No Durable Objects in v1.
- D1 holds filtered static GTFS schedule data.
- KV holds feed freshness and short-lived GTFS-Realtime cache entries.
- R2 holds raw feed artifacts for provenance with a 30-day lifecycle configured
  outside this repository.
- Static ingestion runs in GitHub Actions, never inside the Worker.
- GTFS-Realtime is fetched on demand and cached for 20–30 seconds.
- Amtrak static schedules use Amtrak's official GTFS archive and the shared
  GitHub Actions ingestion path, filtered to Amtrak's own agency ID.
- The community Amtraker API is an isolated, replaceable realtime candidate;
  it must not be treated as an official source or an operational adapter until
  implemented and reviewed.
- `penn.fyi` is the public landing/feed directory, `mcp.penn.fyi/mcp` is the MCP
  endpoint, and `gtfs.penn.fyi` is private behind Cloudflare Access by default.

Do not redesign these decisions without an explicit maintainer request. Record
implementation choices not fixed here in `DECISIONS.md`.

## Public-repository rules

- Never commit credentials, tokens, account IDs, or real resource IDs.
- Secret names may appear in `feeds.json`; secret values may not.
- Use GitHub Actions secrets and `wrangler secret put`.
- Keep `/admin/ingest-needed` protected by the dedicated
  `ADMIN_INGEST_TOKEN`, even while `/mcp` remains authless in v1.
- Treat `gtfs.penn.fyi` as a private Cloudflare Access application. CI and the
  Worker use narrowly scoped service tokens; browsers and anonymous callers do
  not receive raw artifacts.
- Preserve provider license and redistribution metadata. A feed is private
  unless `redistributable` is explicitly `true`.
- The Port Authority Bus Terminal is a hub, not a feed-owning agency. Model
  service through its carriers.
- A priority region or discovery candidate is not a live feed. Do not guess
  upstream URLs or mark a feed enabled before source, rights, and validation
  are confirmed.

## Code conventions

- TypeScript strict mode; npm only.
- Prefer narrow modules and explicit schemas over unsafe type assertions.
- Every tool response includes `data_as_of` and timezone-aware ISO-8601 values
  where times appear.
- Tool descriptions are written for LLM consumers and state units, timezones,
  and staleness behavior.
- Do not store request-scoped mutable state at module scope.
- Await promises or pass them to `ctx.waitUntil()`.
- Generate Worker binding types with `npm run cf-typegen`; do not hand-maintain
  an `Env` interface.

## Commands

```sh
npm install
npm start
npm test
npm run typecheck
npm run check
npm run cf-typegen
```

Use the MCP Inspector against `http://localhost:8787/mcp`.

## Repository boundary

This directory is its own Git repository nested under
`cole-brain/repos/workbench/`. It is not a submodule and must never be staged in
the parent `cole-brain` repository.

If you have access to `cole-brain`, also consult
`workspaces/_default/penn-fyi/AGENTS.md` if that companion is created later.
