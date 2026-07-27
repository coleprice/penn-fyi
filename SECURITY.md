# Security policy

## Supported versions

Until the first tagged release, only the current `main` branch receives
security fixes. This scaffold has not received a production security audit.

## Reporting a vulnerability

Do not open a public issue containing an exploit, credential, private feed URL,
or non-public transit artifact. Use GitHub's private vulnerability reporting
for `github.com/coleprice/penn-fyi`. If that feature is not enabled, open a
minimal public issue asking the maintainer to establish a private channel,
without including sensitive details.

Include the affected revision, impact, reproduction steps, and suggested
mitigation. Never test against an agency or carrier in a way that violates its
terms or disrupts service.

## Data-access posture

- `/mcp` is intentionally authless in v1 so standard MCP clients can interoperate.
  It should run behind the maintainer's intended network/auth boundary until
  public abuse controls have been reviewed.
- `/admin/ingest-needed` requires `ADMIN_INGEST_TOKEN`. Send it only over HTTPS
  in the endpoint's documented authorization header. Never put it in a query
  string or logs.
- `gtfs.penn.fyi` is private by default behind Cloudflare Access. GitHub Actions
  and the Worker authenticate with a dedicated Access service token.
- Raw and processed artifacts remain private unless the corresponding
  `feeds.json` entry explicitly has `redistributable: true`. Public
  accessibility does not imply redistribution permission.
- Logs must not contain authorization headers, feed API keys, full environment
  dumps, or private artifact URLs.

## Credential inventory and minimum scope

No credential value belongs in Git, `feeds.json`, workflow YAML, issues, test
fixtures, build output, or documentation. Use `.dev.vars` locally, GitHub
Actions repository secrets in CI, and Cloudflare Worker secrets at runtime.

### Worker runtime secrets

Set these with `npx wrangler secret put NAME`:

| Secret                    | Purpose                                                           | Required scope                                                                                                              |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_INGEST_TOKEN`      | Authenticates the safety-net request to `/admin/ingest-needed`    | A unique random value accepted only by this Worker and only for that endpoint                                               |
| `GITHUB_DISPATCH_TOKEN`   | Sends the lazy-backfill `repository_dispatch` event               | Fine-grained GitHub PAT; repository access limited to `penn-fyi`; **Contents: write**, plus GitHub's implicit metadata read |
| `NJT_API_KEY`             | Calls credentialed NJ Transit upstreams                           | Read-only access to the specific NJ Transit APIs in use; no account-management scope                                        |
| `TRANSIT_511_API_KEY`     | Calls credentialed Bay Area 511 upstreams                         | Read-only access to the specific transit APIs in use; no account-management scope                                           |
| `CF_ACCESS_CLIENT_ID`     | Identifies the Worker's machine client to private `gtfs.penn.fyi` | One Cloudflare Access service token allowed only to the `gtfs.penn.fyi` application                                         |
| `CF_ACCESS_CLIENT_SECRET` | Authenticates that machine client                                 | Same single-application Access policy; rotate as one credential with the client ID                                          |

Add provider keys only when a registered feed needs them. The registry may
refer to `env:SECRET_NAME`; it must never contain the value.

### GitHub Actions repository secrets

| Secret                                                        | Purpose                                          | Required scope                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                                       | Selects the deployment account                   | Identifier only; not a credential                                                                                                                               |
| `CLOUDFLARE_API_TOKEN`                                        | Runs the repository's Wrangler ingest operations | Target account only; `D1: Edit`, `Workers KV Storage: Write`, and `Workers R2 Storage: Write`; no Worker script, route, DNS, or unrelated permission            |
| `CLOUDFLARE_DEPLOY_API_TOKEN`                                 | Future Worker deployment workflow                | Target account and `penn.fyi` zone only; `Workers Scripts: Write` and `Workers Routes: Write`; add asset-resource permissions only if the deployment needs them |
| `CF_ACCESS_CLIENT_ID`                                         | Lets CI reach private `gtfs.penn.fyi`            | The same single-application Access service token, or a separate CI-only token with that identical application boundary                                          |
| `CF_ACCESS_CLIENT_SECRET`                                     | Authenticates CI to private artifacts            | Same boundary as the client ID                                                                                                                                  |
| `ADMIN_INGEST_TOKEN`                                          | Lets the scheduled job query the admin endpoint  | Only this Worker's `/admin/ingest-needed` endpoint                                                                                                              |
| Provider keys such as `NJT_API_KEY` and `TRANSIT_511_API_KEY` | Downloads protected upstream data                | Read-only access to only the provider APIs being ingested                                                                                                       |

Cloudflare products do not all expose per-object conditions in every account or
API-token UI. If a permission can only be account-wide, isolate `penn-fyi` in a
dedicated Cloudflare account or use separate ingest and deploy tokens; do not
silently broaden the token to unrelated resources. DNS, billing, user
management, Access administration, and global API-key permissions are not
required by routine CI.

The GitHub dispatch PAT is a Worker secret, not an Actions secret. It exists so
the deployed Worker can dispatch only this repository. Do not use a classic PAT
or a maintainer's general-purpose token.

GitHub's current
[`repository_dispatch` endpoint documentation](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
requires `Contents: write` for a fine-grained token. `Actions: write` alone
applies to `workflow_dispatch` and cannot call this endpoint. This is broader
than the desired Actions-only grant, so keep the token repository-scoped,
short-lived where practical, and rotate it independently. A future switch to
`workflow_dispatch` could use `Actions: write` instead, but would change the
decided event contract.

Cloudflare's token builder scopes the listed product permissions to an account
(and Workers Routes to a zone), not necessarily to one D1 database, KV
namespace, R2 bucket, or script. Select only the account and `penn.fyi` zone
that contain this project. If that account also contains unrelated resources,
isolate `penn-fyi` in a dedicated account or split ingest and deploy tokens; do
not silently broaden permissions. See Cloudflare's
[current API-token permission list](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

## Secret handling

1. Copy `.env.example` to the ignored `.dev.vars` for local work.
2. Generate unique values per environment. Do not reuse personal credentials.
3. Store CI values under repository **Settings → Secrets and variables →
   Actions**.
4. Store Worker values with `wrangler secret put`; do not put them under
   `vars` in `wrangler.jsonc`.
5. Run `npm run secrets:scan` before every push. The repository's configured
   pre-commit hook runs the same check after `npm install`.
6. Rotate a credential immediately if it appears in a commit, log, artifact,
   issue, or chat. Treat deletion as insufficient because Git history and
   caches persist.

## Deployment review

Before a production deploy, verify:

- placeholder resource IDs are gone and each binding resolves to the intended
  resource;
- `/admin/*` rejects absent, malformed, and incorrect credentials;
- Access denies artifact requests without a valid service token;
- CORS, cache headers, error bodies, and logs do not disclose credentials or
  private upstream URLs;
- no feed becomes public without an explicit `redistributable: true` decision;
- dependency, secret-scan, typecheck, test, and Wrangler dry-run checks pass;
- the dispatch token cannot access another repository; and
- the Cloudflare token cannot modify unrelated resources.
