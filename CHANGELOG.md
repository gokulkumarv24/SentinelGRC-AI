# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org). Dates are UTC.

## [1.0.0] — unreleased (release candidate)

### Fixed after the first hosted QA pass (2026-10-22)
- Object storage: uploads to S3-compatible providers that do not support conditional writes (e.g. Backblaze B2) failed, and a failing bucket hung requests through ten retries. Writes are now unconditional, with two retries and a 30-second timeout, and log the provider's error code. A missing stored file returns 404 `file_not_found` instead of 500.
- Evidence previews load through the same-origin API instead of a presigned bucket URL, so the web app's CSP no longer blocks them.
- `TRUST_PROXY=private` trusts every private-network hop, so rate limits and the audit log see the visitor's IP on platforms such as Render.
- Risk owners can change only the risks assigned to them. Residual scores cannot exceed the inherent score and need a rationale.
- Validation: NUL characters, oversized bodies, malformed JSON and non-numeric scores now return 4xx with a request ID instead of 500 or silent coercion. Link fields accept only http(s) URLs.
- Vendor contacts need `vendor.update` to add or remove. Unknown parent records return 404 for control test configs and vendor assessments. List pagination has a stable tiebreaker. The web app sends HSTS in production.

First complete release of SentinelGRC AI, built from the master specification in ten milestones.

### Platform
- Multi-tenant modular monolith: Next.js 16 web app, NestJS API, background worker, PostgreSQL 18 (Prisma 7).
- Cookie sessions with CSRF and origin checks, Argon2id passwords, login lockout and rate limits, and idle plus absolute session expiry.
- Default-deny authorization with eight roles, and separation of duties on every approval.
- Tenant isolation enforced in the service layer and covered by tests in every suite.
- Platform administration: create organizations and hand over a one-time link for each first administrator. New organizations get a setup checklist.
- Append-only audit trail (enforced by database triggers) with request IDs carried into background jobs.

### Governance modules
- **Compliance:** versioned framework imports with provenance (NIST CSF 2.0, NIST AI RMF 1.0, ISO/IEC 27001:2022, ISO/IEC 42001:2023, SOC 2 TSC, GDPR, EU AI Act). Reviewable control mappings, a control register, automated and manual control tests (pass/fail/unknown/error), a Statement of Applicability, and an evidence library with currency tracking.
- **Risk:** register with inherent and residual scoring under versioned policies, heatmap, history, and acceptance workflow with expiry. Findings with deduplicated detection, and remediation tasks.
- **Third-party risk:** vendor lifecycle, versioned questionnaires with conditional questions, explainable scoring, independent decisions, a vendor portal, and findings and risks from gaps.
- **AI governance:** AI inventory, assessments aligned to NIST AI RMF, deployment preconditions with independent approval, evaluations, incidents, model-change review, and preliminary EU AI Act records.
- **Automation:** database-backed workflow engine with schedules, events, bounded retries and visible failures, integration adapters (demo identity provider), and email and in-app notifications.
- **Reports:** twelve traceable report types in PDF, CSV and Excel, with draft/final status, source appendix, checksum-verified downloads, schedules and retention.
- **AI assistant (optional):** grounded, redacted drafts with mandatory human review; mock provider by default, OpenAI-compatible providers behind approval switches.

### Release hardening (milestone 10)
- Container images (API/worker, release, web, backup), a local Compose stack, and a production template with Caddy TLS, an internal network and hardened containers.
- CI: lint, types, unit, integration (migrations from an empty database), schema drift, OpenAPI drift, production build and startup smoke test with security checks, Playwright E2E, dependency audit, secret scan and image scan.
- Encrypted, checksummed backups from one consistent snapshot; restore only into an empty database; restore verification (migrations, triggers, row counts, file checksums).
- JSON logs in production; HTTP `Idempotency-Key` support on create/trigger routes.
- Operator commands for incidents: `sessions:revoke` and `users:reset-password`.
- Least-privilege database roles: a separate migration owner, a data-only application role and a read-only backup role.
- Documentation: architecture, data model, API, security, threat model, framework governance, deployment, operations, backup and restore, incident response, testing, and the demo scenario.

### Fixed during hardening
- Expired sessions caused a sign-in redirect loop; `__Host-` cookies were not cleared on logout in production.
- Report generation runs were marked failed although the report was produced.
- The vendor assessment report showed control effectiveness labelled as residual risk.
- Report actions were hidden at 1366px; accessibility issues (label-in-name, contrast) in the account menu, heatmap and badges.
- Production `deploy/*.env` files were not Git-ignored; the `openapi` script pointed to a missing file.
- Development-only `shadcn` CLI and unused logging packages were shipped as runtime dependencies.

### Known limitations
- No multi-factor authentication or SSO yet. No bundled malware scanner (uploads are marked "not scanned"). Self-service password reset needs email, so recovery uses the operator command.
- Integrations ship with a demo identity adapter only; real connectors use the same adapter interface.
- The `pg` package is pinned to 8.x until Prisma's driver adapter stops issuing concurrent queries on a transaction (D-020).
