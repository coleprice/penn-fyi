# penn.fyi

Nationwide transit awareness for AI assistants, exposed as a standard
[Model Context Protocol](https://modelcontextprotocol.io/) server and built on
Cloudflare.

> [!IMPORTANT]
> This repository is an early production implementation. The Cloudflare
> resources, public domains, static GTFS ingestion, and the `list_feeds` and
> `find_stops` and static `next_departures` MCP paths are live. The remaining
> realtime tools, monitoring, rate limits, and automated lazy ingestion are
> not yet complete.

## Scope and priorities

`penn.fyi` is nationwide. The name does not limit coverage to Pennsylvania.
Feeds are added incrementally in this order:

1. **Amtrak** — the first priority and the nationwide backbone. Static
   schedules use Amtrak's official GTFS archive. The community Amtraker API is
   retained only as an isolated candidate for realtime data.
2. **New York City and New Jersey** — MTA services, NJ Transit, and carriers
   serving the Port Authority Bus Terminal. The registry includes the MTA
   subway's open, no-key static feed, all eight route-group GTFS-Realtime
   endpoints, and its separate alerts endpoint.
3. **Pennsylvania** — rail and bus coverage, with special attention to
   South-Central Pennsylvania and Northeast Pennsylvania. The first NEPA
   discovery corridor is Blakeslee–Pocono Summit along PA-940, then south via
   I-380/US-611 through Mount Pocono toward Tannersville.
4. **San Francisco Bay Area** — official 511 feeds, initially split into BART,
   Muni, Caltrain, and San Francisco Bay Ferry for bounded ingestion.
5. **Massachusetts** — MBTA and other useful statewide or regional services.
6. **Connecticut** — CTrail and Connecticut bus systems.
7. **DMV** — Northern Virginia, Washington, DC, Maryland, and the broader
   Beltway region.

Priority means “research and integrate first,” not “currently available.”
`list_feeds` is the authority for implemented feed status and freshness.

The **Port Authority Bus Terminal (PABT)** is a physical hub operated by the
Port Authority of New York and New Jersey, not a feed-owning bus agency.
`penn.fyi` models PABT service through the individual carriers that serve it;
it does not invent a “Port Authority” feed.

## What this scaffold contains

- A stateless TypeScript Cloudflare Worker with Streamable HTTP MCP at `/mcp`
- The complete v1 tool surface:
  - `next_departures`
  - `trip_status`
  - `transfer_window`
  - `find_stops`
  - `service_alerts`
  - `list_feeds`
- A declarative feed registry in `feeds.json`
- D1 migrations and an offline GTFS ETL skeleton
- A small, synthetic, committed GTFS fixture for deterministic tests
- GitHub Actions entry points for dispatch-driven and safety-net ingestion
- Secret scanning in the local Git hook and `npm run check`

`list_feeds`, `find_stops`, and static-schedule `next_departures` are
implemented. Realtime merging, trip status, transfer risk, and service alerts
remain deliberate, typed placeholders.

## Production architecture

The decided design has one deployable Worker and one offline ingestion path:

```text
MCP client ──Streamable HTTP──> mcp.penn.fyi/mcp
                                   │
                                   ├── D1: filtered static GTFS
                                   ├── KV: freshness + 20–30s realtime cache
                                   ├── upstream GTFS-Realtime feeds
                                   └── realtime adapters (including Amtraker)

GitHub Actions ──download/filter──┬──batches/atomic swap──> D1
       ▲                         └──raw provenance───────> R2
       └── repository_dispatch from stale/missing Worker query
```

- **D1** holds only the filtered, near-term schedule tables used by tools. Each
  ingest builds a fresh table set and swaps it atomically; rows never accrete
  forever.
- **KV** holds per-feed freshness/ETag/query metadata and short-lived
  GTFS-Realtime results.
- **R2** holds raw upstream artifacts for provenance. Configure a 30-day
  lifecycle policy in Cloudflare; that policy is not created by this repo.
- **GitHub Actions** performs all static GTFS ingestion, including Amtrak's
  official feed. The Worker never downloads and transforms static feeds.
- **GTFS-Realtime** will be fetched on demand and cached for 20–30 seconds.
  There will be no polling loops.
- **Lazy backfill** will dispatch an `ingest` event when a requested feed is
  missing or stale, while serving any safe stale result.
- A daily safety-net job asks the protected `/admin/ingest-needed` endpoint for
  recently queried feeds that are missing or stale. Conditional upstream
  requests then stop the workflow before D1, KV, or R2 writes when every feed
  is unchanged.

Public surfaces are `penn.fyi` for the landing page and directory, and
`mcp.penn.fyi/mcp` for MCP. `gtfs.penn.fyi` is private by default behind
Cloudflare Access and is intended only for CI and Worker service-token clients.

The implementation includes the bindings, static ETL, admin freshness gate, D1
stop search, and dated static schedule queries. The optional Amtraker realtime
adapter, on-demand GTFS-Realtime path, and Worker-to-GitHub lazy dispatch are
production-design contracts that are not implemented yet.

## Feed lifecycle

`feeds.json` is the source of truth. Static and realtime endpoints are declared
separately; realtime endpoint groups may contain multiple URLs when one agency
splits its network by route family. A feed normally moves through:

1. **Discovery** — identify the actual operator, authoritative URLs, format,
   geographic usefulness, authentication, and update cadence.
2. **Rights review** — record license, attribution, and redistribution terms.
3. **Registration** — add metadata and secret _names_, never secret values.
4. **Validation** — download in CI, retain the raw artifact in private R2, parse
   and filter, test referential integrity, and reject bad snapshots.
5. **Publication to D1** — load fresh tables and atomically swap them into use.
6. **Operation** — record freshness in KV, cache realtime briefly, and trigger
   lazy refresh for a queried stale feed.
7. **Retirement** — disable a broken or withdrawn feed without losing its
   license and provenance record.

Redistribution is **default-deny**. A feed is private unless its registry entry
explicitly says `redistributable: true`. Do not infer permission from a public
download URL. There is intentionally no public artifact-serving path in v1.

## Local development

Requirements: Node.js 22 or newer and npm.

```sh
git clone https://github.com/coleprice/penn-fyi.git
cd penn-fyi
npm install
npx wrangler d1 migrations apply penn-fyi --local
npx wrangler d1 execute penn-fyi --local --file fixtures/d1/minimal.sql
npm start
```

Wrangler serves the Worker at `http://localhost:8787`; the MCP endpoint is:

```text
http://localhost:8787/mcp
```

For local-only values, copy `.env.example` to `.dev.vars` and fill only what a
specific integration needs. `.dev.vars` is ignored. The fixture tests require
no network and no credentials.

The two D1 commands initialize a fresh local Wrangler database with the
committed synthetic fixture. Run them once per fresh local state; the seed is
not intended to be applied repeatedly to the same database.

### MCP Inspector

Start the Worker, then in another terminal run:

```sh
npx @modelcontextprotocol/inspector
```

In the Inspector, select **Streamable HTTP** and connect to
`http://localhost:8787/mcp`. Verify tool discovery, call `list_feeds`, try
`find_stops` with names from the synthetic fixture, and call
`next_departures` with exact stop IDs plus a `service_date`. `from_stop` is the
canonical origin field; the deprecated `stop` alias remains accepted for
clients holding an older schema. Numeric JSON stop IDs are accepted, although
strings preserve leading zeroes. A stop may also be qualified as
`feed_id:stop_id`, such as `bay-area-511-bart:901401`. Inspector behavior
confirms the protocol surface; it does not prove that live upstream feeds are
ready.

## Tests and checks

```sh
npm test
npm run typecheck
npm run format:check
npm run secrets:scan
npm run check
```

The committed fixture is synthetic and intentionally tiny. Tests exercise
deterministic registry, GTFS transformation, `list_feeds`, `find_stops`, and
static schedule result formatting without network access; the stop-search
acceptance test reads the committed fixture through an in-memory store. Do not
replace fixture tests with live agency calls: upstream availability,
credentials, and schedule changes would make the suite nondeterministic.

`npm run check` also performs a Wrangler dry run. It is the closest local
preflight, but it is not a production deployment test.

## Production-readiness gap

Before describing this service as production-ready, maintainers must:

- verify every enabled registry URL, license, attribution, and credential;
- provision the named D1, KV, R2, Worker, routes, DNS, and Access applications;
- replace all placeholder Cloudflare resource IDs;
- configure Access service-token policies for private artifact access;
- add narrowly scoped secrets described in [SECURITY.md](./SECURITY.md);
- run the initial static ingests and validate atomic rollback behavior;
- implement the optional Amtraker realtime adapter, on-demand GTFS-Realtime
  cache, and lazy repository dispatch;
- finish and integration-test the three remaining stubbed transit tools;
- verify representative MCP clients against the deployed endpoint;
- add alerting, dashboards, quotas/rate limits, restore procedures, and an
  incident runbook; and
- perform a security and feed-license review.

See [DECISIONS.md](./DECISIONS.md) for implementation choices made while
creating the scaffold and [CONTRIBUTING.md](./CONTRIBUTING.md) before proposing
a feed.

## License

The code is available under the [MIT License](./LICENSE). Transit data remains
subject to each provider's own terms; the MIT License does not relicense it.
