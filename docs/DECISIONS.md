# Decisions

Material technical decisions and tradeoffs (spec §0.1 rule 11, §25). Newest last.

## D-001 — Backend framework: NestJS instead of FastAPI
- **Date:** 2026-10-21 · **Decided by:** project owner
- **Context:** The master spec (§3.2) specifies Python/FastAPI. The owner chose NestJS (TypeScript).
- **Decision:** Build `services/api` with NestJS. Spec requirements map as follows:

| Spec requirement | NestJS equivalent |
|---|---|
| FastAPI routers, dependencies | Nest controllers, guards, interceptors |
| Pydantic schemas | DTOs validated with Zod (shared types with web) |
| SQLAlchemy 2.x | Prisma ORM |
| Alembic migrations | Prisma Migrate (hand-edited SQL for CHECK constraints, partial indexes) |
| pytest + HTTPX | Jest + Supertest |
| FastAPI OpenAPI | @nestjs/swagger |
| APScheduler worker | Separate Nest worker process using @nestjs/schedule |
| Argon2id | `argon2` package |
| PDF / CSV | pdfkit, safe CSV writer, exceljs |

- **Consequence:** One language (TypeScript) across web and API. Every other spec rule is unchanged.

## D-002 — Execution pacing
Build milestones continuously; stop only for blockers, approval gates, destructive or paid actions (spec §0.2 and §28 take precedence over the blueprint's "wait for review").

## D-003 — Database hosting: Neon (hosted PostgreSQL)
- **Context:** Dev machine has 8 GB RAM and ~13 GB free disk; owner asked for an online database.
- **Decision:** Neon free tier. Use one branch for development and a separate branch for automated tests so test runs never touch dev data.
- **Tradeoff:** Network latency and a cold start after ~5 min idle; 0.5 GB storage limit is ample for demo data. Docker Compose still ships a local Postgres service for offline work and the single-host deployment option (spec §3.3).

## D-004 — AI provider: OpenAI-compatible adapter, Groq free tier, mock default
- **Decision:** `LLMProvider` interface with a deterministic `mock` provider (default) and an `openai-compatible` provider configured for Groq. The same provider works with OpenRouter or other compatible endpoints by changing `AI_BASE_URL`.
- **Safeguards:** Real calls require `AI_ENABLED=true` and `AI_DATA_SHARING_APPROVED=true`. Free-tier providers may log prompts, so only fictional demo data should be sent.

## D-005 — Resolving contradictions inside the spec
The spec file contains the master specification (§0–§29) followed by an earlier pasted blueprint. The master specification wins; features that appear only in the blueprint are still built.
1. Residual risk = separately assessed residual likelihood × impact (§6.1); no percentage discount.
2. Users join organizations through memberships (multi-org) rather than `users.organization_id`.
3. No separate `questionnaires` table; `vendor_assessments` carries `due_date`.
4. Exports: PDF, CSV and Excel, plus scheduled reports.
5. Docs: union of §4, §22.3 (`INCIDENT_RESPONSE.md`) and the blueprint (`BUILD_PLAN.md`, `framework-mappings.md`).
6. `framework-data/manifests/<framework>/` plus `framework-data/mappings/`.
7. The repository root is the existing workspace folder, not a nested `sentinelgrc-ai/`.

## D-006 — Toolchain follows the official scaffolds
NestJS 12's CLI now generates ES modules, **Vitest** and **oxlint** (not Jest/ESLint); Next.js 16 ships ESLint 9 and Turbopack. We keep those defaults rather than retrofitting older tools. The spec's "pytest + HTTPX" maps to Vitest + Supertest against the real HTTP stack and a real PostgreSQL.

## D-007 — Embedded PostgreSQL for local development and tests
Docker Desktop is not running on the development machine and RAM is limited. `npm run db:local -w services/api` starts a real PostgreSQL 18 server (`embedded-postgres`) under `var/pgdata` on 127.0.0.1:54329 with UTF-8 encoding and SCRAM auth. Tests always use `TEST_DATABASE_URL`, and the test setup drops and re-migrates that database from empty on each run. Neon and Docker Postgres remain supported through `DATABASE_URL`.

## D-008 — Sessions, CSRF and the web/API boundary
- Opaque random session tokens in an HttpOnly `SameSite=Lax` cookie (`__Host-` prefixed in production); only SHA-256 hashes stored; 30-minute sliding idle timeout, 12-hour absolute lifetime, revocation on logout/password change.
- CSRF: double-submit token (readable `sg_csrf` cookie echoed in `X-CSRF-Token`, verified against the hash stored on the session) plus an Origin allowlist check.
- The browser only talks to the web origin; Next.js rewrites `/api/v1/*` to the API, so cookies are first-party and CORS is not needed in normal operation.
- Active organization is stored on the session and re-validated against the membership on every request.

## D-009 — Next.js rendering and CSP
`cacheComponents` is off: every page is per-user and authenticated, so static shells add nothing. Scripts use a per-request nonce with `strict-dynamic`. Styles allow `'unsafe-inline'` because Radix UI and Recharts set inline `style` attributes, which nonces cannot cover; style injection is a lower-risk vector than script injection.

## D-010 — Pagination, errors and keys
- One pagination style: `page` / `pageSize` (≤ 100) with explicit sort allowlists.
- Errors: `{ error: { code, message, details? }, requestId }`; other tenants' records return 404 (same as missing) to avoid leaking existence.
- Human-readable keys (`RSK-0001`, `FND-0001`) are generated under a transaction-scoped advisory lock per organization.

## D-011 — Polymorphic links validated in the service layer
Evidence links, risk links and AI source references point at several entity types, which foreign keys cannot express. Every such reference goes through `EntityResolver`, which requires the target to exist **in the caller's organization** (spec §5.1). Tests cover cross-tenant link attempts.

## D-012 — Database-backed job queue instead of Redis
Workflow runs are rows in `workflow_runs`; the worker (`services/api/src/worker.ts`, `npm run start:worker`) claims them with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` and a 10-minute lease. This gives durable, multi-worker-safe processing with no extra infrastructure; Redis/BullMQ can replace it if volume ever justifies it (spec §12.3 "durable queue if workloads justify it").
- Schedules: each due slot is queued once, using the slot time as the idempotency key; missed slots are skipped, not replayed as a backlog. Schedules are stored in UTC.
- Events are queued in the same transaction as the change that raised them (transactional outbox).
- Retries: up to 3 attempts with exponential backoff (30 s doubling, capped at 30 min). Errors are classed as retryable or permanent; a run whose lease expires is re-queued.
- Steps: each step is recorded, and a step that succeeded is skipped when its run is retried, so one integration that synced is not synced again because another failed. Manual retries create a new linked run, and the original keeps its history.
- Handlers are idempotent (findings dedupe on their open key, notifications on a per-recipient dedupe key inserted with `ON CONFLICT DO NOTHING`).

## D-013 — Retention never deletes automatically
Deletion cannot be undone, and legal holds need human judgement. The `evidence_retention_review` workflow therefore only lists archived evidence that is past the organization's retention period and notifies administrators. Deletion stays a deliberate manual action (spec §12.3 "never retry an irreversible action blindly", §16.3).

## D-014 — Integrations: adapters, secret references, full-refresh sync
Connectors implement one `IntegrationAdapter` contract (provider and version, scopes, health check, paginated cursor collection, per-page timeout, normalized errors). Rows store only non-secret settings plus an optional reference to an `INTEGRATION_*` environment variable. Other names are rejected, so a reference can never expose other secrets.
- A successful sync replaces the stored records in one transaction.
- A failed sync keeps the previous records but marks the integration `failing`. Rules that depend on it then report **unknown** rather than trusting stale data.
- The only connector implemented is the deterministic **demo identity provider** (synthetic privileged accounts, labelled as demo data). No real cloud, IdP or ticketing connector is claimed (spec §13.1).

## D-015 — Email delivery
Email goes through an outbox, delivered by the worker over SMTP (nodemailer ≥ 10.1.7; 7.x had open advisories). Messages are suppressed when no provider is configured. They are also suppressed when the recipient's domain is not on `EMAIL_ALLOWED_RECIPIENT_DOMAINS`, and in demo mode without an allowlist, so the demo never mails real people. Addresses must be plain ASCII so comments, quoting or IDN tricks cannot slip past the allowlist. Delivery is attempted up to 5 times with backoff, and the status is mirrored to the notification.
