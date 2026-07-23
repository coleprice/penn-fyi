# Contributing

Thanks for helping make transit information more useful to people and their AI
assistants. `penn.fyi` is nationwide, but coverage grows feed by feed. Amtrak
and the priority regions in the README receive maintainer attention first;
high-quality proposals elsewhere are welcome.

## Before opening a change

- Read `AGENTS.md`, `README.md`, `SECURITY.md`, and `DECISIONS.md`.
- Search existing issues and registry entries.
- For a feed proposal, identify the actual operator rather than only a station,
  terminal, or marketing name.
- Never include a credential, private artifact, or data obtained contrary to
  provider terms.

Security reports follow [SECURITY.md](./SECURITY.md), not public issues.

## Proposing a feed

An issue or pull request should include:

- operator and service name;
- geographic coverage and modes;
- authoritative static and realtime documentation URLs;
- whether access requires registration or a key;
- license, attribution, retention, and redistribution terms;
- update cadence and known reliability limitations;
- timezone;
- stable identifiers and any route/geographic filtering proposed; and
- why the feed helps the current priority corridors or nationwide network.

A URL being publicly downloadable is not evidence that redistribution is
allowed. New entries remain `redistributable: false` unless the proposal cites
clear permission and the maintainer accepts it.

For PABT, propose the individual carrier feed and describe how its stops map to
the terminal. For Pocono coverage, distinguish fixed-route public transit from
intercity carriers, shuttles, and demand-response service.

## Development

Use Node.js 22 or newer and npm:

```sh
npm install
npm start
```

Before submitting:

```sh
npm run check
npm run format:check
```

Tests must work without network access or provider credentials. Add or extend
synthetic fixtures for feed parsing, stop search, and schedule behavior. Do not
commit downloaded agency GTFS archives as fixtures.

## Code and protocol expectations

- Keep TypeScript strict and modules narrow.
- Use the standard Streamable HTTP MCP protocol; do not add client-specific
  response shapes.
- Include `data_as_of` in every tool result.
- Emit times as ISO-8601 strings with UTC offsets, and state units/timezones in
  tool descriptions.
- Do not keep request-scoped mutable state at module scope.
- Await promises or pass them to the Cloudflare execution context.
- Generate Cloudflare binding types with `npm run cf-typegen`.
- Keep static ingestion in GitHub Actions, never in the request-serving Worker.
- Record a new implementation choice in `DECISIONS.md`; append a superseding
  entry when reversing an accepted decision.

## Pull requests

Keep each pull request focused. Describe user-visible behavior, feeds or rights
affected, tests run, and any operational migration. Do not combine an
unrelated refactor with a feed addition.

By contributing, you agree that your code contribution is licensed under the
repository's MIT License. Transit data and provider documentation retain their
original rights and are not relicensed by contribution.
