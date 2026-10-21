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

## D-016 — AI assistant: drafts only, provider adapter, mock by default
- `LlmProvider` has two implementations. The default `mock` provider makes no model call: it builds extractive, deterministic drafts from the supplied sources. `openai-compatible` (for example Groq) uses JSON mode, a timeout, one retry for transient errors, never follows redirects, and requires https except for localhost.
- Three switches must all allow AI: `AI_ENABLED` (platform), `settings.aiFeaturesEnabled` (organization), and `AI_DATA_SHARING_APPROVED` for any provider that sends data off the host.
- Context is loaded only through tenant-scoped, permission-checked queries.
- Before anything is sent, content is redacted (secrets, emails, phone numbers, card numbers, IBANs, IP addresses), restricted evidence is never sent externally, and input is capped at `AI_MAX_INPUT_CHARS`. Content that looks like instructions to an AI is flagged as a limitation and handled as data only.
- Untrusted content is wrapped in `<untrusted_data>`. The model has no tools, and output must match one strict schema. A citation to a source that wasn't supplied, a suggested control that doesn't exist, or an out-of-range value (for example a severity) marks the draft invalid.
- Every draft is stored with the requester, source record IDs and versions, provider, model, prompt version, token counts, the redaction summary, the validation result, the reviewer's decision and edits, and whether it was used in a record. Reviewing a draft never changes any other record.
- No vector database (spec §11.2): retrieval is permission-filtered database reads plus bounded document text. PDF text comes from `unpdf` (pdf.js 6.4); other binary types are not analysed, and that is stated as a limitation.

## D-017 — Reports
- Twelve report builders produce a renderer-independent model (metrics with definitions, sections, exclusions, source appendix), rendered as PDF (pdfkit), CSV (formula-neutralized, UTF-8 BOM) or Excel (exceljs, values written as text, not formulas).
- Generation runs in the worker via the `report.requested` event. The requester's permissions are re-checked at generation time. Files are stored privately under the evidence storage key rules with a SHA-256 checksum; downloads are authenticated, verified against the checksum, audited and sent with `no-store`.
- The PDF shows Draft or Final, the generation time with the organization's time zone, page numbers and a Draft watermark, and states that the report is not an audit opinion or attestation.
- A vendor assessment report can be Final only once the assessment is decided.
- Generated files are derived data: they are deleted at the end of the organization's report retention period and the run is marked expired.

## D-018 — HTTP idempotency keys
- Create/trigger routes marked `@Idempotent(scope)` accept an optional `Idempotency-Key` header (8–128 of `A–Z a–z 0–9 - _`): reports, workflow runs, integration syncs, control-test runs, AI drafts, invitations, and creating findings, risks and remediation tasks.
- Keys are stored in `idempotency_keys`, scoped per organization, user and route, for 24 hours. Per-user scoping means a stored response can never be served to another user.
- A retry with the same body replays the stored status and body, with the `Idempotent-Replayed: true` header.
- Reusing a key with a different body returns 409 `idempotency_key_reused`. A concurrent duplicate returns 409 `idempotency_in_progress`.
- A failed request releases its key, so a corrected retry works.
- The web client keeps one key per user action while the payload is unchanged (`useIdempotencyKey`).
- Business-level deduplication still applies on top: findings are keyed by source, and workflow runs have their own idempotency keys.

## D-019 — Release and runtime layout
- One API image runs both the API (`node dist/main.js`) and the worker (`node dist/worker.js`).
- A separate **release** image runs `prisma migrate deploy` and then the idempotent reference-data sync, once per deploy, before new API/worker containers start (spec §22.2).
- The web image is the Next.js standalone server. `API_BASE_URL` is compiled into the `/api/v1` rewrite at **build** time, so the web image is built per environment.
- In production, Caddy sends `/api/v1/*` straight to the API and everything else to the web app.
- Production containers run as non-root, with read-only root filesystems, all capabilities dropped and `no-new-privileges`. The web container receives no API secrets.

## D-020 — Logging and dependency pins
- `createLogger` (Nest `ConsoleLogger`) writes one JSON object per line in production and readable text in development, honouring `LOG_LEVEL`. The unused `pino` packages were removed.
- `pg` is pinned to 8.x. Prisma's driver-adapter query interpreter issues some queries concurrently on a transaction's connection, which pg 8 only warns about ("client.query() when the client is already executing a query") and pg 9 will reject. Do not upgrade `pg` to 9 until `@prisma/adapter-pg` serializes those queries.
- `shadcn` is a development-time CLI (dev dependency). `exceljs` depends on a `uuid` version with a moderate advisory that affects only v3/v5/v6 with a caller buffer; `exceljs` calls only `v4`, so this is accepted, and `npm audit --audit-level=high` gates CI.
