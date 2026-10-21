# API

REST API at `/api/v1` (NestJS). The web app calls it from the same origin, and other clients use the same cookie session and CSRF scheme.

## OpenAPI

- In development, interactive docs are at `http://localhost:4000/api/v1/docs` and the JSON at `/api/v1/openapi.json`. Both are disabled in production.
- The committed document is [`docs/openapi.json`](openapi.json). Regenerate it with `npm run openapi` (no server or database needed). CI fails if the committed copy is out of date.

## Authentication

```http
POST /api/v1/auth/login        {"email": "...", "password": "..."}
→ 200, Set-Cookie: sg_session (HttpOnly) and sg_csrf
   (production names: __Host-sg_session, __Host-sg_csrf)
```

- Send both cookies on every request.
- For `POST`, `PUT`, `PATCH` and `DELETE`, also send `X-CSRF-Token: <value of the sg_csrf cookie>` and an `Origin` header that is on `CORS_ORIGINS`.
- `POST /auth/switch-organization` changes the active organization for members of several organizations.
- `GET /users/me` returns the user, the active organization, roles and effective permissions.
- Vendor-portal routes (`/vendor-portal/{token}/…`) take a one-time portal token in the path instead of a session.

## Conventions

**Lists**
- Query parameters: `page` (from 1), `pageSize` (1–100, default 25), `sort` (per-endpoint allowlist), `order` (`asc` or `desc`), `q` (text search) and endpoint-specific filters.
- Responses look like `{ "items": [...], "total": 42, "page": 1, "pageSize": 25 }`.

**Errors**
- Every error looks like `{ "error": { "code", "message", "details"? }, "requestId" }`.
- Codes are stable; messages are for people.
- There are never stack traces, SQL or file paths.

| Status | Typical codes |
|---|---|
| 400 | `invalid_filters`, `unsupported_file_type`, `invalid_idempotency_key` |
| 401 | `unauthenticated` (the session cookie is cleared) |
| 403 | `forbidden`, `password_change_required`, `separation_of_duties` |
| 404 | `not_found`, also returned for records in other organizations |
| 409 | `version_conflict`, `invalid_transition`, `idempotency_key_reused`, `idempotency_in_progress` |
| 410 | `report_expired` |
| 422 | `validation_error`, with `details.fields[] = { path, message }` |
| 429 | `rate_limited`, with `details.retryAfterSeconds` |

**Other conventions**
- **Request IDs:** send `X-Request-Id` or one is generated. It is returned in errors, written to audit events and carried into the background jobs a request starts.
- **Concurrency:** editable records return `version`. Send it back on `PATCH`; a stale version gets `409 version_conflict`.
- **Idempotency:** create/trigger routes accept `Idempotency-Key: <8–128 of A–Z a–z 0–9 - _>`. A retry with the same body returns the original response, with `Idempotent-Replayed: true`. See D-018.
- **Rate limits:** login and vendor-portal routes use the `login` bucket. Costly operations (reports, AI drafts, imports, downloads) use the `expensive` bucket. Everything else uses the default bucket.
- **Long-running work:** reports, scheduled tests and syncs run in the worker. The API returns `202` with a run record you can poll.

## Endpoint groups

| Group | Main routes |
|---|---|
| Health | `GET /health` (liveness), `GET /ready` (database check; blocked at the edge in production) |
| Auth and users | login, logout, `/users/me`, change password, switch organization, invitations |
| Organizations and members | `/organizations` (platform admins create), `/organizations/current` (+ `/onboarding`), members, roles, status, invitations |
| Compliance | frameworks (import preview and import, scope, requirements, coverage), `/control-mappings` (+ review), control templates, compliance summary, Statement of Applicability |
| Controls and tests | `/controls` (CRUD, import, implementation), `/controls/{id}/tests`, test configurations |
| Evidence | `/evidence` (upload, metadata-only records, links, review, archive), `/evidence/{id}/download-url`, `/evidence/download/{token}` |
| Risks | `/risks` (CRUD, heatmap, controls, links, history), acceptance requests and `/risk-acceptances/{id}/decision`, scoring policies |
| Findings and remediation | `/findings` (+ `/transition`), `/remediation-tasks` (+ `/complete`) |
| Third-party risk | `/vendors` (+ contacts, lifecycle), `/questionnaires`, `/assessments` (responses, submit, review, decision, internal notes, portal invitations), `/vendor-portal/{token}` |
| AI governance | `/ai-systems` (+ transition, readiness, approve-deployment, EU AI Act record), `/ai-assessments`, `/ai-evaluations`, `/ai-incidents`, `/ai-model-changes` |
| Automation | `/workflows` (+ run), `/workflow-runs` (+ retry), `/integrations` (+ test, sync, runs, records) |
| Reports | `/reports/types`, `/reports` (request, list, download), `/report-schedules` |
| AI assistant | `/ai/status`, `/ai/drafts` (generate, list, review, use) |
| Notifications, search, audit | `/notifications` (+ preferences), `/search`, `/audit-events` |
| Dashboard | `/dashboard/summary`, `/risk-trends`, `/compliance`, `/recent-events` |

Each route's required permission is enforced server-side (see [SECURITY.md](SECURITY.md)); the OpenAPI document lists the request and response schemas.
