# Implementation status

Only results that were actually run and observed are marked verified (spec §0.1 rule 4).
Test database: embedded PostgreSQL 18.4 (local). Neon has not been connected yet (owner to provide connection strings).

| Milestone | Status | Verified evidence (latest run) |
|---|---|---|
| 0 — Repository audit and plan | Done | Audit recorded below; architecture, decisions, design system docs |
| 1 — Application skeleton | Done | API + web start; `/health`, `/ready` OK; migrations apply to empty DB; no Prisma drift; web proxy verified in browser |
| 2 — Identity and tenant security | Done | 24 API tests: login/lockout, session idle + absolute expiry, CSRF + origin, logout, forced password change, invitations, self-role-change block, cross-tenant member/audit isolation, append-only audit trigger |
| 3 — Shared GRC core | Done (API + UI) | 14 more API tests (38 total) + 23 unit tests; UI pages for risks, acceptance, findings, remediation, controls, SoA, evidence, members, settings, audit log, notifications; `tsc`, oxlint, eslint clean |
| 4 — Compliance module | Done (API + UI) | 9 more API tests (47 total) + 17 more unit tests (40 total): framework import/preview/immutable versions, tenant-private frameworks, mapping SoD + version-change re-review, control-check flow (unknown → evidence request; expired → fail → single finding + remediation; re-runs dedup; pass recorded, closes only by a person), manual tests, compliance math, bulk import + CSV injection, template adoption, dashboard tenant isolation. Reference data: NIST CSF 2.0 (6/22/106) and AI RMF 1.0 (19/72) from official NIST sources |
| 5 — Third-party risk | Done (API + UI) | 6 more API tests (53 total) + 3 unit tests (43 total): explainable inherent score, restricted contacts, answer validation by type, conditional follow-ups, completion rules, template freezing, review-before-decision, tier-based approval thresholds, SoD for high-risk decisions, findings from failed/unsupported answers (optional blanks excluded), shared risk linked to vendor + assessment, material-change reassessment, portal isolation (no internal fields, own evidence only, revoked/expired/unknown links, post-submit lock), cross-tenant 404s |
| 6 — AI governance | Done (API + UI) | 8 more API tests (61 total), 43 unit tests: AI inventory with material-change reassessment; NIST AI RMF–structured assessment (19 items, Govern/Map/Measure/Manage) with rationale rules, residual-risk notes, shared risk linked to the AI system and reused from the provider vendor's open risk; independent approver (not assessor/submitter); deployment approval only when every §10.5 precondition holds, by someone other than the requester; evaluations require limitations and independent review; incidents (high/critical → finding; root cause before resolve, lessons before close); model changes flag reassessment and queue the change workflow, with separate review; EU AI Act applicability stored as preliminary with dated obligation schedule; cross-tenant 404s. UI pages type-check and lint clean and route correctly (unauthenticated → login); not yet walked through in a browser |
| 7 — Workflow engine and integrations | Done (API + worker + UI) | 5 more API tests (66 total) + 8 unit tests (51 total). Demo identity sync runs in the worker, not in the HTTP request. Scheduled control tests: one run per slot, no duplicate findings or alerts on re-runs. Failing sync: bounded backoff (3 attempts), failure visible as integration `failing`/stale plus alerts, one alert per run. Manual retry: linked, permission-gated, no double queueing. Reminders are sent once per state. Lapsed risk acceptances expire. Workflow config is versioned and audited, and disabled or event workflows cannot be run manually. Expired leases are recovered without re-running succeeded steps. Cross-tenant 404s and secret-reference validation. Unit tests cover backoff, slot skipping, the email suppression policy including allowlist-bypass addresses, and demo adapter paging and error normalization. In the browser: worker processed 10 scheduled runs on the dev DB; integration added, synced and its 6 records shown; run list and run detail rendered with no console errors |
| 8 — AI assistant and reporting | Not started | — |
| 9 — UX completion and demo | Not started | — |
| 10 — Release hardening | Not started | — |
| 11 — Deployment | Blocked: needs hosting target and owner authorization | — |

## Verification commands (as run)
```
npm run typecheck -w services/api      # clean
npm run lint -w services/api           # oxlint: 0 warnings
npm test -w services/api               # 51 unit tests passed
npm run test:api -w services/api       # 66 API tests passed (3 consecutive full runs)
npm run typecheck -w apps/web          # clean
npx eslint . (apps/web)                # clean
```

## Fixed during verification
- Login form posted credentials as a GET query string when client JavaScript failed to load (dev server blocked assets for 127.0.0.1). Fixed the cause (`allowedDevOrigins`) **and** forced `method="post"` on every form so a JS failure can never put secrets in a URL.
- Authorization-denial audit events were written fire-and-forget, so a fast reader could miss them (intermittent test failure). Denials are now recorded before the 403 is returned.
- Dev-mode error messages could echo Prisma error text; database errors are now never echoed.
- `NotificationsService.notify` handled duplicates by catching the unique-key error. Inside a caller's transaction that error aborts the PostgreSQL transaction, which then rolls back on commit, silently discarding the caller's other writes. A failing integration sync lost its sync-run status this way. Duplicates now use `INSERT … ON CONFLICT DO NOTHING`.
- `nodemailer` was first installed at 7.x, which `npm audit` flagged with several high advisories; upgraded to 10.1.7 (clean).

## Repository audit (2026-10-21)
- Contents before work: `SENTINELGRC_MASTER_SPEC.md`, two architecture PNGs. No existing code.
- Not previously a git repository; initialized on `main`.
- Tooling: git 2.54, Node 24.15, npm 11.12, Python 3.12, uv 0.11, Docker CLI 29.7 (daemon not running).
- Machine: Windows 11, 8 GB RAM, ~11 GB free disk after installs.

## Known limitations / open items
- `exceljs` depends on `uuid@8` (moderate advisory GHSA-w5hq-g745-h8pq). Not exploitable here: exceljs only calls `uuid.v4()` without a buffer; the advisory affects v3/v5/v6 with a caller-supplied buffer. Re-check when exceljs updates.
- `eslint-config-next` pulls `braces` with a high advisory (deeply nested glob patterns → DoS). Development-only tooling; patterns come from our own config.
- S3 storage adapter is implemented but not verified against a live bucket.
- SMTP delivery is implemented but not verified against a live mail server (no credentials configured); the suppression policy is unit-tested.
- The API test run prints a `pg` deprecation warning ("client.query() when the client is already executing a query"). Some code issues concurrent queries on one transaction client (`Promise.all` inside a transaction). This is harmless today but will break on pg 9; to be removed during release hardening (M10).

## Blockers
- Neon database connection strings (dev + test branch) — owner to create account.
- Groq API key (optional; mock provider works without it).
