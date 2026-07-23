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
