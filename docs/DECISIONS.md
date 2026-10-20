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
