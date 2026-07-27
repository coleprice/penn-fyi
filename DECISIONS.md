# Implementation decisions

This log records choices made for the initial scaffold that were not fully
specified by the project brief. Architectural constraints in `AGENTS.md` remain
authoritative. A future change should append a superseding decision instead of
silently rewriting the reason for an earlier one.

## D-001 — Interpret `penn.fyi` as nationwide

- **Date:** 2026-07-23
- **Status:** accepted

The product and repository name are branding, not a geographic constraint.
Architecture, identifiers, schemas, and tool descriptions must not assume that
all feeds are in Pennsylvania.

## D-002 — Order geographic discovery explicitly

- **Date:** 2026-07-23
- **Status:** accepted

Amtrak is first, followed by New York/New Jersey, Pennsylvania, the San
Francisco Bay Area, Massachusetts, Connecticut, and the DMV. Pennsylvania
research begins with South-Central PA and the Blakeslee–Pocono Summit PA-940
area, continuing south along I-380/US-611 through Mount Pocono toward
Tannersville.

Priority is planning metadata, not a claim that coverage exists. Registry and
freshness results remain the operational source of truth.

## D-003 — Treat PABT as a hub, not an agency

- **Date:** 2026-07-23
- **Status:** accepted

The Port Authority Bus Terminal is modeled as a place served by carrier-owned
services. Carrier feeds and licenses are discovered independently. No
synthetic “Port Authority” agency feed is created.

## D-004 — Keep discovery candidates visibly non-live

- **Date:** 2026-07-23
- **Status:** accepted

Regional priorities may be represented as discovery candidates, but a
candidate must not be reported as an enabled feed until its authoritative
source, rights, schema, validation, and ingestion are complete. Unknown URLs
stay unknown rather than being guessed.

## D-005 — Protect the admin endpoint separately

- **Date:** 2026-07-23
- **Status:** accepted

Although `/mcp` is authless in v1, `/admin/ingest-needed` uses a dedicated
`ADMIN_INGEST_TOKEN`. The admin credential authorizes only that operational
check and must not double as an MCP, provider, Cloudflare, or GitHub credential.

This limits unauthenticated callers' ability to probe feed operations or cause
ingestion work.

## D-006 — Use a synthetic fixture as the offline acceptance boundary

- **Date:** 2026-07-23
- **Status:** accepted

Tests use a tiny committed GTFS dataset with invented names and schedules.
Fixture-based tests are deterministic, need no provider credentials, and can
exercise stop search and registry behavior without redistributing agency data.
Live-feed smoke tests belong in a separately controlled integration path.

## D-007 — Separate operational readiness from scaffold completion

- **Date:** 2026-07-23
- **Status:** accepted

The session is complete when the repository installs, checks, starts locally,
exposes the MCP surface, and passes fixture-backed tests for `list_feeds` and
`find_stops`. It is not thereby production-ready. Live feeds, resource
provisioning, remaining tool logic, client compatibility, monitoring,
licensing verification, and security review are separate launch gates.

## D-008 — Default feed redistribution to denied

- **Date:** 2026-07-23
- **Status:** accepted

An absent, unknown, or false redistribution value has the same result: private.
Only an explicit `redistributable: true` after rights review can support future
public exposure. The v1 scaffold provides no public artifact exposure path,
even for feeds marked redistributable.

## D-009 — Use one Worker and route by hostname/path

- **Date:** 2026-07-23
- **Status:** accepted

The landing assets, MCP handler, health check, and protected admin handler stay
in one Worker. The private artifact hostname can route through that Worker
where useful. Separate deployables require a concrete isolation or scaling need
and a new decision.

## D-010 — Document the actual GitHub dispatch permission

- **Date:** 2026-07-23
- **Status:** accepted

The desired grant was a fine-grained PAT limited to this repository with
`Actions: write`. GitHub currently requires `Contents: write` for
`POST /repos/{owner}/{repo}/dispatches`; `Actions: write` applies to
`workflow_dispatch`. Because the architecture explicitly selects
`repository_dispatch`, the security guide records GitHub's actual minimum
instead of describing a nonfunctional token.

The token remains limited to the `penn-fyi` repository and is kept separate
from maintainer and CI credentials. Switching to `workflow_dispatch` to obtain
the narrower permission requires an explicit architecture change.

## D-011 — Use Amtrak's official static GTFS feed

- **Date:** 2026-07-27
- **Status:** accepted
- **Supersedes:** the Amtraker-only assumption in the initial architecture

Amtrak publishes an official static GTFS archive at
`https://content.amtrak.com/content/gtfs/GTFS.zip`. Static schedules use that
archive through the normal GitHub Actions ETL path rather than a custom
adapter.

The archive bundles Amtrak with partner and Thruway agencies. The registry
therefore filters it to Amtrak's `agency_id` `51` before route, trip, stop, and
service filtering. Raw artifacts remain private and redistribution stays
default-deny pending a current terms review.

Amtraker remains a separate, unofficial realtime candidate. It may be used
behind an isolated adapter after implementation and rights review, but it is
not the source of Amtrak's static schedule data.

## D-012 — Ingest core 511 operators separately

- **Date:** 2026-07-27
- **Status:** accepted

The 511 regional aggregate expands beyond 325 MB and its object-based parse
exceeds the current ETL memory envelope. BART, Muni, Caltrain, and San
Francisco Bay Ferry therefore use 511's official operator-specific archives.
The regional aggregate remains planned until the ETL supports a bounded
streaming transform.

511 responses may append provider-generated bytes after an otherwise valid ZIP
archive. Downloads normalize only the bytes after a structurally valid ZIP
end-of-central-directory record before hashing, parsing, and archiving. Public
surfaces acknowledge that Bay Area data is provided by 511.org.

## D-013 — Make static schedule time explicit

- **Date:** 2026-07-27
- **Status:** accepted

`next_departures` accepts an exact origin stop ID, an optional later
destination stop on the same trip, an optional feed and route, and an explicit
origin-local `service_date` plus GTFS `after_time`/`before_time` window. GTFS
times through `47:59:59` are accepted so after-midnight trips remain attached
to their published service day.

Results convert scheduled times to timezone-offset ISO-8601 timestamps and
state `realtime_included: false` until realtime merging exists. This keeps
future-date schedule answers useful without implying live train status.
Static GTFS `trip_short_name` is retained as `train_number` so Amtrak results
expose recognizable numbers rather than only internal trip IDs.
The conditional-download cache namespace is advanced when a schema change
requires unchanged upstream feeds to be transformed and published again.

Registry `status` continues to describe configuration lifecycle.
`list_feeds.availability` separately reports whether operational schedule data
is actually ready, missing, stale, or not enabled.

## D-014 — Make stop references tolerant at the MCP boundary

- **Date:** 2026-07-27
- **Status:** accepted

`next_departures` keeps `from_stop` as its canonical origin input but accepts
the deprecated `stop` alias so clients with a cached earlier schema continue
to work. Origin and destination stop references accept JSON strings or safe
non-negative integers because some MCP clients serialize numeric-looking GTFS
IDs as numbers. Strings remain the documented safe form because numeric
serialization cannot preserve leading zeroes.

Stop references may be qualified as `feed_id:stop_id`. The service strips a
recognized registry feed prefix before querying D1 and rejects conflicting
origin, destination, and explicit feed identifiers. Unrecognized prefixes
remain part of the GTFS stop ID because colons are valid identifier content.
