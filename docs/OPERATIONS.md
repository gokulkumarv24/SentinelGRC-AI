# Operations

Runbook for a deployment set up with [DEPLOYMENT.md](DEPLOYMENT.md). The commands assume `cd deploy` and the alias:

```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file production.env'
```

## Health

| Check | Endpoint / command | Meaning |
|---|---|---|
| Liveness | `GET /api/v1/health` → `{"status":"ok"}` | The process is up. Public, and used by container health checks. |
| Readiness | `GET /api/v1/ready` → `{"status":"ready","checks":{"database":"ok"}}` | The database is reachable. Internal only: Caddy returns 404 for it from outside. |
| Worker | `dc logs worker` shows `Worker started` and periodic `Worker tick` | The scheduler is processing jobs. |
| Jobs | **Workflows → Runs** in the app; the dashboard's *Recent workflow failures* panel | Failed runs with error codes and correlation IDs, plus a retry button. |
| Integrations | **Integrations** page: status, last success and failure times, `stale` flag | Checks that depend on a failing integration report `unknown`, never `pass`. |

Health responses never include versions, hostnames, connection strings or stack traces.

## Logs

- The API and worker write one JSON object per line in production (`level`, `timestamp`, `context`, `message`), filtered by `LOG_LEVEL`. Caddy logs JSON too.
- The production Compose file rotates logs (`json-file`, 5 × 20 MB). Ship them to your log platform if you need longer retention.
- Each HTTP response carries a request ID (`X-Request-Id`). The same ID appears in error bodies, audit events and the `correlationId` of background jobs started by that request, so it connects a user report to the log lines.
- Logs never contain passwords, session tokens, CSRF tokens, API keys or evidence contents. Keep it that way in new code: log identifiers and summaries only.

## Monitoring and alerts (recommended)

| Signal | Source | Suggested alert |
|---|---|---|
| Container restarts or unhealthy | Docker or your platform | Any restart loop |
| Error rate | Caddy JSON logs (status ≥ 500) | Above 1% for 5 minutes |
| Failed jobs | `workflow.run_failed` audit events / in-app `workflow.failed` notifications | Any failure of `scheduled_control_tests`, `integration_sync` or `scheduled_reports` |
| Stale integrations | `integration.sync_failed`, the Integrations page | Failing for more than 2 scheduled cycles |
| Authentication abuse | `auth.login_failed` and `authz.denied` audit events | Spikes per IP or account |
| Storage | Bucket size, or the `storage` volume and host disk | Over 80% |
| Database | Connections, storage, slow queries (provider metrics) | Over 80% capacity |
| Backups | The backup job's exit code and age of the newest backup | Missing for more than 26 hours |

## Upgrades

1. Read `CHANGELOG.md` and the migration notes for the new version.
2. Take a backup: `dc run --rm backup`.
3. Release: `dc run --rm release` (migrations + reference sync; exits non-zero on failure).
4. Roll out: set `SENTINELGRC_VERSION`, then `dc up -d api worker web`.
5. Run the post-deployment checks in DEPLOYMENT.md, and record the version, time, migration and operator.

## Secrets and credential rotation

| Secret | How to rotate | Effect |
|---|---|---|
| `AUTH_SECRET` | Set a new 48-byte value and restart the API | Invalidates outstanding evidence download links only. It does **not** sign sessions. |
| User sessions | `dc run --rm api node dist/cli/revoke-sessions.js (--all \| --user <email> \| --org <slug>) --reason "…"` | Users must sign in again. The action is audited. |
| A user's password (forgotten or compromised) | `dc run --rm api node dist/cli/reset-password.js --email <email> --reason "…"` | Prints a one-time password, forces a change, clears lockout, revokes sessions. Audited. |
| Database passwords | Create the new password and update `DATABASE_URL`, `MIGRATION_DATABASE_URL` and `BACKUP_DATABASE_URL`, then restart | Rotate the app, owner and backup roles independently |
| S3 keys | Issue a new key, update the variables named by `S3_*_REF`, restart, then revoke the old key | — |
| AI / SMTP keys | Update the variable and restart | — |
| Backup age key | Generate a new key pair and update `BACKUP_AGE_RECIPIENT` | Keep old private keys until every backup encrypted with them has expired |

Store secrets in the platform's secret manager. Never paste them into tickets, chat or screenshots.

## Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| The API exits at startup with `Invalid configuration` | A missing variable, or a placeholder value in production | The message names each variable and the reason (never its value). Fix `production.env`. |
| `401 unauthenticated` straight after signing in | Cookies blocked because `PUBLIC_APP_URL` or `CORS_ORIGINS` doesn't match the browser origin, or a TLS/proxy mismatch | Use one https origin. `TRUST_PROXY=true` behind Caddy. |
| `403 origin_not_allowed` on save | `CORS_ORIGINS` is missing the exact origin | Add it (scheme + host + port), with no trailing slash |
| The web app works but every API call returns 502 or 404 | The web image was built with the wrong `API_BASE_URL`, or the `api` service is down | `API_BASE_URL` is compiled into the web build: rebuild the web image. Check `dc ps api`. |
| Reports stay `queued` | The worker isn't running, or `WORKER_ENABLED` is false | `dc up -d worker`, then check the logs |
| Control tests report `unknown` | No evidence linked, or the integration is stale or failing | Link evidence, or fix the integration (see its last error) and sync again |
| Evidence upload rejected | Content type not allowed, a mismatched extension, or over `MAX_UPLOAD_SIZE_MB` | The error code says which. Adjust settings only if the type is genuinely needed. |
| `release` fails | A migration error, or the owner role is missing privileges | The old version is still serving. Read the release logs, fix forward, and never edit `_prisma_migrations` on the live database. |
| A pg warning about `client.query()` while executing | Known upstream issue in Prisma's driver adapter (D-020) | Harmless on pg 8. Do not upgrade `pg` to 9 yet. |

## Troubleshooting a local setup

| Problem | Fix |
|---|---|
| `npm run dev:db` fails with "port in use" | An embedded Postgres is already running on 54329. Reuse it or stop the old process. |
| Next dev server on :3000 won't start | A previous `next dev` may still be running; stop the leftover `node … start-server.js` process |
| `ENOSPC` / disk full | Clear `apps/web/.next` (it rebuilds) and old `var/backups`. On Windows, check the page file and the Docker disk image. |
| E2E tests can't sign in | Run `npm run test:e2e:prepare -w apps/web` (fresh database and credentials) before `test:e2e:run` |
| `TEST_DATABASE_URL` errors | API tests refuse to run against the dev database. Point it at a dedicated test database. |
