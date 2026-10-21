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
