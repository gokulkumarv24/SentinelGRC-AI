# Threat model

Scope: SentinelGRC as deployed with [DEPLOYMENT.md](DEPLOYMENT.md): Caddy (TLS) → web and API containers, a worker, PostgreSQL, private object storage, and optional email and AI providers. Reviewed for the 1.0 release; revisit it whenever a new integration, data flow or role is added.

## Assets

| Asset | Why it matters |
|---|---|
| Evidence files and metadata | Policies, configurations and audit artefacts; often confidential or restricted |
| Risk, finding and vendor records | Reveal security weaknesses of the organization and its suppliers |
| Approvals and the audit trail | Accountability: who accepted which risk, and when |
| Reports | Bulk exports of the above |
| Credentials and secrets | Sessions, `AUTH_SECRET`, database, S3 and AI keys, vendor-portal tokens |
| Tenant boundary | One deployment serves several organizations |

## Actors

- Authenticated members, with different roles and possibly several organizations.
- Platform administrators.
- External vendors using one-time portal links.
- Unauthenticated internet users.
- Compromised or malicious third parties: integrations, AI providers, uploaded documents.
- Operators with infrastructure access.

## Trust boundaries

1. Browser ↔ Caddy (TLS) ↔ web / API.
2. API ↔ PostgreSQL, and API ↔ object storage (private network).
3. Worker ↔ integrations and email.
4. API ↔ LLM provider.
5. Vendor portal: a token-only boundary, with no session.
6. Operator ↔ hosts, backups and secrets.

## Threats, mitigations and residual risk

| # | Threat | Mitigations (where enforced / tested) | Residual risk |
|---|---|---|---|
| 1 | **Cross-tenant access** by guessing IDs or abusing filters | The organization comes only from the session's active membership. Every query is tenant-scoped, and foreign IDs return 404. Polymorphic links are validated in the service layer. Covered by the cross-tenant tests in every API suite, the E2E isolation test, and the demo seed's isolation check. | A new endpoint that bypasses the service layer. Mitigated by the default-deny guard and code review. |
| 2 | **Privilege escalation**: granting oneself roles, self-approval | Default-deny permission guard. `role.assign` is required to grant privileged roles. No self-grant is possible, and at least one active admin is kept. Separation of duties applies to every approval type (access-control and module tests). | A misconfigured custom role. Roles are fixed in code for 1.0. |
| 3 | **Malicious evidence** (polyglots, HTML/SVG XSS, macros, malware) | Content-based type detection and an allowlist, sanitized names, and server keys. Only a safe preview subset is shown, in a sandbox; everything else downloads. Strict CSP. Scanner hook. | No malware scanner ships by default (files show "not scanned"); configure one for untrusted uploads. |
| 4 | **Prompt injection** via evidence or vendor answers | Untrusted content is clearly framed and the model has no tools. Outputs must match a strict schema with valid citations and allowed values. Injection phrasing is flagged. Drafts need human review and never change records (assistant tests). | A misleading but schema-valid draft. Reviewers see the sources and limitations. |
| 5 | **Credential theft and session hijacking** | Argon2id, lockout, rate limits. HttpOnly, `__Host-`, Secure cookies, CSRF and origin checks. Idle and absolute expiry. Revocation on password change and suspension, plus `sessions:revoke`. | A phished password: there is no MFA in 1.0, so use an SSO/IdP in front or add MFA (roadmap). |
| 6 | **Unauthorized report export** | `report.generate` plus read permission on every underlying domain, re-checked in the worker. Downloads need `report.download`, are audited, use `no-store`, and are verified against the checksum. | An authorized insider exporting data. Audited. |
| 7 | **SSRF via integrations or URLs** | No feature fetches user-supplied URLs; evidence `sourceUri` is stored, never fetched. The AI and S3 endpoints come only from server configuration; AI requests must use https, redirects are refused, and requests time out. | A future URL-fetching connector must add an egress allowlist. |
| 8 | **Broken access control on downloads** | HMAC tokens bound to user, organization, evidence and expiry, plus a live permission check. Report downloads are permission-checked per type. | Short-lived links forwarded to others. They are bound to the user's session. |
| 9 | **Background-job tenant confusion** | Jobs carry `organizationId` and the initiating actor. The runner sets the request context per job. Results are written only within that organization (workflow tests). | — |
| 10 | **Race conditions in approvals** | Single-use decisions in transactions, optimistic `version` checks, and unique constraints. Idempotency keys stop duplicate create/trigger requests. | — |
| 11 | **Audit-log tampering** | Database triggers make `audit_events`, `risk_history` and `finding_events` append-only. There is no delete API. Backups are encrypted and checksummed, and restore verification checks the triggers. | A database superuser can still alter history. Restrict that role and ship logs to an external store if required. |
| 12 | **Sensitive data sent to LLM providers** | Three switches (platform, organization, data-sharing approval). Redaction. Restricted evidence is never sent. An input cap. A mock provider by default. Provider, model and prompt version are recorded per draft. | Redaction is pattern-based; review the provider's data-processing terms before approving. |
| 13 | **Malicious or compromised integration responses** | Adapters normalize and validate records, with timeouts, bounded retries and page limits. Failures show as `unknown`, never `pass`, and are alerted. Secrets are referenced by name only. | A plausible but false data feed. Results show their source and sync time. |
| 14 | **Vendor-portal abuse** | Single-use, expiring, hashed tokens scoped to one assessment. The portal sees no internal fields (scores, reviewer notes). Uploads are inspected like any evidence. Rate limited. | A leaked link before expiry. Invitations can be revoked. |
| 15 | **Operator or infrastructure compromise** | Non-root, read-only containers with capabilities dropped. No database ports exposed. Secrets come from a secret manager. Encrypted, checksummed backups stored off-host. | A host-level compromise exposes runtime secrets. Rotate them per INCIDENT_RESPONSE.md. |

## Out of scope / known gaps (1.0)

- Multi-factor authentication and SSO. Recommended before handling regulated data.
- A bundled malware scanner.
- Per-organization encryption keys. Data is encrypted at rest only by the database, disk or bucket provider.
- Automated retention deletion. Retention reviews flag records; deletion is a deliberate manual act (D-013).
