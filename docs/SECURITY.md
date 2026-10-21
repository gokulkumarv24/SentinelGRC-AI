# Security

SentinelGRC holds sensitive governance data: risks, findings, vendor assessments and evidence documents. This page summarizes how access is controlled and how to configure a deployment securely. The threat analysis is in [THREAT_MODEL.md](THREAT_MODEL.md), operational procedures are in [OPERATIONS.md](OPERATIONS.md) and [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

**Reporting a vulnerability:** contact the maintainers privately; do not open a public issue with exploit details.

## Authentication and sessions

- **Passwords:** Argon2id (19 MiB memory, t=2, p=1). Passwords must be at least 12 characters and mix letters with digits or symbols.
- **Failed logins:** login failures return one generic message. After 10 failed attempts the account locks for 15 minutes, and logins are rate-limited per IP.
- **Session cookie:** a random token in an HttpOnly, SameSite=Lax cookie. In production the cookie is `Secure` with the `__Host-` prefix. Only the token's SHA-256 hash is stored.
- **Session lifetime:** sessions have a sliding idle timeout (`SESSION_IDLE_MINUTES`) and an absolute lifetime (`SESSION_ABSOLUTE_HOURS`).
- **Session revocation:** sessions are revoked on logout, on password change (other sessions), when a membership is suspended or removed, and in bulk with `npm run sessions:revoke` (incident response).
- **Expired sessions:** the API clears the cookie when it rejects an expired session.
- **CSRF:** state-changing requests need the `X-CSRF-Token` header to match the session's CSRF token (double submit, verified against the stored hash), and the `Origin` header must be on the allowlist.
- **First admin:** no default administrator or password exists. The first administrator is created with `npm run admin:create`, which prints a one-time password and forces a change at first sign-in. Platform admins create further organizations and invite each one's first admin with a single-use, 72-hour link.

## Authorization

**Default deny.** Every route needs an explicit permission, `@AuthenticatedOnly`, `@PlatformAdmin`, or `@Public` (only login, invitation acceptance, vendor-portal token routes and the `health`/`ready` probes). A route with none of these is rejected.

Permissions come from the roles on the caller's membership in the **active** organization. The web app hides actions a user cannot take, but the API authorizes every request regardless.

| Role | Purpose |
|---|---|
| Organization admin | Organization profile, members, roles, settings, frameworks, integrations. No business decisions by default. |
| GRC manager | Mappings, controls, risk workflows, acceptance decisions, reports. |
| Security analyst | Control tests, evidence review, findings and remediation. |
| Risk owner | Owned risks and remediation; may request but not approve acceptance. |
| Vendor manager | Vendors, questionnaires, assessments and decisions. |
| AI governance officer | AI inventory, assessments, evaluations, incidents, deployment approval. |
| Auditor | Read-only, including audit history and reports; changes nothing. |
| Contributor | Creates and updates permitted records; no approvals or settings. |

The full permission matrix lives in `services/api/src/permissions/catalog.ts`.

**Separation of duties** is enforced in the services, not just the UI. The requester or preparer can never approve their own:
- risk acceptances (high and critical risks always need a different approver);
- vendor decisions;
- AI assessments, deployment approvals, evaluations and model changes;
- mapping reviews and evidence reviews.

Approvals record a rationale and are single-use.

**Tenant isolation.** The organization comes only from the session's active membership. Records in other organizations return 404, so the response never reveals that a record exists. Background jobs run with the organization and actor recorded when they were queued, and a revoked requester's report is not generated.

## Data protection

- **Evidence files:**
  - The type is detected from content (magic bytes) and must match the extension and `ALLOWED_UPLOAD_MIME_TYPES`. Size is capped by `MAX_UPLOAD_SIZE_MB`.
  - Filenames are sanitized, and storage keys are generated on the server.
  - Files live outside any web root (local) or in a private bucket (S3).
  - Downloads use short-lived HMAC links bound to both the user and the organization, are logged, and only a safe subset of types previews inline.
  - A malware-scanner hook exists; until a scanner is configured, files are marked "not scanned".
- **Exports:**
  - Reports are generated in the worker, stored privately with a checksum, downloaded only with permission, and audited.
  - CSV and Excel cells are neutralized against formula injection.
  - Reports state that they are not audit opinions or attestations.
- **AI assistant:**
  - Off unless `AI_ENABLED`, the organization's setting and, for external providers, `AI_DATA_SHARING_APPROVED`.
  - Content is redacted (secrets, emails, phone and card numbers), restricted evidence is never sent externally, and input is capped.
  - Untrusted content is clearly framed, outputs must match a strict schema with valid citations, and drafts never change records (D-016).
- **Audit:**
  - Privileged actions, approvals, denials and downloads are recorded with the actor, request ID and outcome, never secrets or document contents.
  - The audit table is append-only at the database level.

## Secure configuration (production)

Configuration is validated at startup, and production refuses to start when:
- `AUTH_SECRET` or `DATABASE_URL` still contain placeholder or development values;
- `CORS_ORIGINS` is empty or contains `*`;
- `PUBLIC_APP_URL` is not https;
- `DEMO_MODE` is true;
- S3 settings are missing while S3 is selected;
- an external AI provider has no key.

Also:
- Set `TRUST_PROXY=true` only behind the TLS proxy.
- Use a least-privilege database role for the app and a separate read-only role for backups.
- Keep the database and object store on private networks, with bucket public access blocked and versioning on.
- Inject secrets from the platform's secret manager. Never commit `deploy/production.env` (it is Git-ignored).
- Security headers:
  - The API sets Helmet headers, including a `default-src 'none'` CSP.
  - The web app sends a per-request nonce CSP, `X-Frame-Options: DENY` and a strict referrer policy.
  - HSTS is set in production by the API and by Caddy.

## Supply chain

- Dependencies are pinned in `package-lock.json`, and runtime images are pinned to exact versions (Node 24.15, PostgreSQL 18.4).
- CI runs `npm audit` on production dependencies (fails on high and above), a gitleaks secret scan of the full history, and a Trivy image scan (fails on fixable critical).
- Accepted advisories and version pins are recorded in [DECISIONS.md](DECISIONS.md) (D-020).
