# Deployment

This guide covers a single Linux host running Docker Compose behind Caddy (automatic TLS), with managed PostgreSQL and S3-compatible object storage. The same images run on any container platform.

**Never deploy automatically without explicit approval, valid credentials and a confirmed target environment.**

## Topology

```
Internet ──TLS──> Caddy ──/api/v1/*──> api (NestJS)  ─┐
                      └──everything else──> web (Next.js)
                                    worker (same image as api) ─┤──> PostgreSQL (private)
                                                                └──> object storage (private bucket)
backup (on a schedule) ──> encrypted archives on a separate host or bucket
```

All files are in `deploy/`:
- `docker-compose.prod.yml`: services, internal network, hardening and limits.
- `Caddyfile`: TLS, routing, HSTS, internal paths blocked.
- `production.env.example`: every setting, with `CHANGE_ME` markers that the API refuses to start with.

Images (`services/api/Dockerfile`, `apps/web/Dockerfile`, `ops/backup/Dockerfile`):

| Image | Target | Runs |
|---|---|---|
| `sentinelgrc-api` | `runtime` | API (`node dist/main.js`) and worker (`node dist/worker.js`) |
| `sentinelgrc-release` | `release` | `prisma migrate deploy` + reference-data sync, **once per release** |
| `sentinelgrc-web` | `runtime` | Next.js standalone server. `API_BASE_URL` is baked in at build time. |
| `sentinelgrc-backup` | — | `backup.sh` / `restore.sh` (PostgreSQL 18 client + age) |

## Prerequisites

- A Linux host with Docker Engine and Compose v2, ports 80/443 open, and a DNS record for your domain.
- PostgreSQL 18 on a private network. A managed service is preferred; `--profile bundled-db` runs one on the host.
- A private S3-compatible bucket with public access blocked, versioning on, lifecycle rules for old versions, and server-side encryption.
- A container registry, plus an [age](https://age-encryption.org) key pair for backups. Keep the private key **off** the application host.
- Optional: an SMTP provider with SPF, DKIM and DMARC configured for the sender domain, and an error-monitoring DSN.

## 1. Database roles (least privilege)

Run as a database administrator, with your own passwords:

```sql
CREATE ROLE sentinel_owner LOGIN PASSWORD '…';           -- owns the schema; used only by the release step
CREATE ROLE sentinel_app LOGIN PASSWORD '…';             -- API and worker: data access only, no DDL
CREATE ROLE sentinel_backup LOGIN PASSWORD '…';          -- backups: read-only
CREATE DATABASE sentinelgrc OWNER sentinel_owner;
\c sentinelgrc
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sentinel_app, sentinel_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE sentinel_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sentinel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sentinel_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sentinel_app;
GRANT pg_read_all_data TO sentinel_backup;
```

The audit, risk-history and finding-event tables are append-only by trigger, whatever the role.

## 2. Build and publish images

CI builds the images on every change. To publish a release:

```bash
VERSION=1.0.0 REGISTRY=ghcr.io/<owner>
docker build -f services/api/Dockerfile --target runtime -t $REGISTRY/sentinelgrc-api:$VERSION .
docker build -f services/api/Dockerfile --target release -t $REGISTRY/sentinelgrc-release:$VERSION .
docker build -f apps/web/Dockerfile --build-arg API_BASE_URL=http://api:4000 -t $REGISTRY/sentinelgrc-web:$VERSION .
docker build -t $REGISTRY/sentinelgrc-backup:$VERSION ops/backup
docker push --all-tags …   # or push each tag
```

Tag images immutably with a version; never deploy `latest`.

## 3. Configure

```bash
cp deploy/production.env.example deploy/production.env && chmod 600 deploy/production.env
```

- Replace every `CHANGE_ME`. Prefer injecting secrets from your platform's secret manager over writing them to the file.
- `deploy/production.env` is Git-ignored.

## 4. Release (migrations), then start

```bash
cd deploy
docker compose -f docker-compose.prod.yml --env-file production.env run --rm backup      # pre-release backup
docker compose -f docker-compose.prod.yml --env-file production.env run --rm release     # migrate + reference sync
docker compose -f docker-compose.prod.yml --env-file production.env up -d api worker web caddy
```

- Run migrations **once** per release, before new API and worker containers start. Replicas never migrate on startup.
- Migrations follow expand/contract: a release only adds columns and tables that the previous version tolerates, and removals come in a later release. That keeps rolling back the application images safe.

## 5. First administrator

```bash
docker compose -f docker-compose.prod.yml --env-file production.env run --rm api \
  node dist/cli/create-admin.js --email you@company.com --name "Your Name" \
  --org-name "Your Company" --org-slug your-company --platform-admin
```

The command prints a one-time password, which must be changed at first sign-in. No default admin exists. The demo seed is unavailable in production (`DEMO_MODE` must be false).

## 6. Backups

Schedule `docker compose … run --rm backup` daily (host cron or a systemd timer), with `BACKUP_HOST_DIR` on separate storage that is synced off-host. Test a restore before go-live; see [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Pre-deployment checklist

- [ ] The release commit passed CI: lint, types, unit, integration, E2E, audit, secret scan and image scan.
- [ ] The migration diff has been reviewed, is expand-only (or a contract step was announced), and has been tested from the previous release's schema.
- [ ] `production.env` is complete, with no `CHANGE_ME` left: `APP_ENV=production`, `DEMO_MODE=false`, https `PUBLIC_APP_URL`, explicit `CORS_ORIGINS`, `TRUST_PROXY=true`.
- [ ] Secrets are unique, come from the secret manager, and do not appear in the repository, tickets or screenshots.
- [ ] The database and bucket are private. The app role is data-only. The bucket blocks public access and is versioned.
- [ ] A fresh, encrypted backup exists, and the latest restore drill passed.
- [ ] Rollback plan noted: the previous image tags, and whether this release's migrations are backward-compatible.

## Post-deployment verification

- [ ] `https://<domain>/api/v1/health` returns `{"status":"ok"}`. `/api/v1/ready` and `/api/v1/docs` return 404 from outside.
- [ ] Sign in, open the dashboard, upload and download a test evidence file, and generate a small report (this proves the worker runs).
- [ ] `docker compose logs worker` shows `Worker started` and JSON log lines, with no errors.
- [ ] TLS is valid, and HSTS and security headers are present (`curl -sI https://<domain>/login`).
- [ ] Record the deployment: version, time (UTC), latest migration (`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`) and operator.

## Rollback

- **Application:** set `SENTINELGRC_VERSION` to the previous tag and run `up -d api worker web`. This is safe when the release's migrations were expand-only.
- **A migration that must be undone:** restore the pre-release backup into a **new** database (see [BACKUP_RESTORE.md](BACKUP_RESTORE.md)), verify it, point `DATABASE_URL` at it, and redeploy the previous version. Never edit `_prisma_migrations` by hand on the live database.
- **A failed migration (release exited non-zero):** the API containers were not restarted, so the old version keeps serving. Fix forward in a new release, or use `prisma migrate resolve` after confirming the database state in a restored copy.
