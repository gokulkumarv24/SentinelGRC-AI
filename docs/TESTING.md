# Testing

Tests prioritize business rules and security boundaries over coverage percentages (spec §20). Every suite runs in CI (`.github/workflows/ci.yml`).

| Suite | Command | Count | What it covers |
|---|---|---|---|
| API unit | `npm test -w services/api` (`test:cov` adds coverage) | 69 tests | Risk and vendor scoring, questionnaire logic, compliance metrics, workflow scheduling, CSV formula neutralization, report renderers (PDF/CSV/Excel), AI redaction, grounding checks and the provider adapter (against a local fake server), JSON logger |
| API integration | `npm run test:api` | 77 tests in 9 files | The real HTTP stack against PostgreSQL, migrated **from an empty database** at the start of each run |
| Web component | `npm test -w apps/web` | 17 tests | Sign-in form and post-login redirect guard, confirmation dialogs, AI draft view, idempotency-key hook |
| End-to-end | `npm run test:e2e` | 20 tests in 9 files | Production builds of web, API and worker, against a dedicated database seeded with the demo data |

## API integration files

| File | Tests | Focus |
|---|---|---|
| `auth` | 13 | Login, lockout, sessions (idle and absolute expiry, cookie clearing), CSRF and origin, password change, invitations |
| `access-control` | 12 | Role grants, self-escalation, last admin, suspension, audit scoping, platform admin, validation errors, onboarding counts per tenant |
| `shared-core` | 14 | Risks, findings, remediation, evidence (upload inspection, downloads, links), notifications, search |
| `compliance` | 9 | Framework import and versioning, mapping review, control tests (pass/fail/unknown), SoA, CSV import |
| `vendors` | 6 | Assessment lifecycle, scoring, independent decisions, findings and risks, vendor portal isolation, vendor report scores |
| `ai-governance` | 8 | AI assessments, shared risks, deployment preconditions, incidents, changes, evaluations, EU AI Act record |
| `workflows` | 5 | Scheduler, retries with backoff, visible failure, manual retry, integration adapters |
| `reports-assistant` | 6 | Report generation and download, permissions, expiry, schedules; AI drafts (redaction, injection handling, review, kill switch) |
| `idempotency` | 4 | Replay, conflicting reuse, release on failure, no cross-user or cross-tenant sharing |

**Tenant isolation:** every file creates at least two organizations and asserts that the other organization's records answer 404 (spec §20.3). Isolation is also covered end to end and checked on every demo seed run.

## End-to-end suite (`apps/web/e2e`)

`npm run test:e2e -w apps/web` runs `e2e/prepare.mjs` first, then Playwright.

**What `prepare` does:**
1. Creates (or resets) a database named `sentinelgrc_e2e`, derived from `TEST_DATABASE_URL` or set with `E2E_DATABASE_URL`. It refuses any database whose name lacks "e2e" or "test".
2. Runs the real migrations.
3. Builds the API and web app (into `.next-e2e`, so it doesn't clash with a dev server).
4. Seeds the demo data with known local passwords (`var/e2e-credentials.txt`).

**How the suite runs:** Playwright starts the API on :4100, the worker, and `next start` on :3100. Locally it drives the installed Chrome; in CI it uses Playwright's Chromium. Tests run in order on one worker because they share the seeded organization. For faster iteration use `test:e2e:prepare -- --skip-build` and then `test:e2e:run`.

**Covered:**
- Sign-in and sign-out, generic errors, hidden-and-denied actions, cross-tenant 404.
- Dashboard, and the loading, error (with request ID and retry) and empty states.
- Creating and editing a control, uploading and linking evidence.
- Running a control test and reviewing the finding.
- Creating a vendor and submitting its assessment.
- Registering an AI system, completing its assessment and having an independent approver approve it.
- Risk acceptance (request and approval).
- Report export and download, and an auditor's read-only access.
- Platform organization setup, invitation acceptance and the onboarding checklist.
- Accessibility: an axe WCAG 2 A/AA scan of 12 pages, with no serious or critical violations allowed.
- Phone-width layout: no horizontal scrolling at 390px.
- Global search scoped to the tenant.

## Other checks

| Check | How |
|---|---|
| Lint and format | `npm run lint` (oxlint for the API, ESLint for the web app); `npm run format -w services/api` |
| Types | `npm run typecheck` |
| Migration drift | `npm run db:check-drift -w services/api` (schema vs migrations, in CI after the integration tests) |
| OpenAPI up to date | CI regenerates `docs/openapi.json` and fails on any difference |
| Startup and basic API security | CI starts the built API and checks `/health` and `/ready`, security headers, no `X-Powered-By`, `401` without a session, and that readiness exposes no internals |
| Dependencies | `npm audit --omit=dev --audit-level=high` |
| Secrets | gitleaks over the full history |
| Images | Trivy on the API and web images (fails on fixable critical vulnerabilities) |
| Restore | `npm run restore:verify` (see BACKUP_RESTORE.md). Healthy, missing-file, tampered-file and wrong-count cases were verified manually. |

## Writing tests

- Add a cross-tenant assertion to every new endpoint test.
- Test refusals as well as successes: forbidden roles, separation of duties, invalid transitions.
- Use fictional data only.
- API tests run against `TEST_DATABASE_URL` and refuse the development database.
- Don't add retries to hide flakiness. Investigate, then fix the test or the code.
