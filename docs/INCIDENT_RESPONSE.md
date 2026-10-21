# Incident response

For security and availability incidents affecting a SentinelGRC deployment. Adapt the roles and contacts to your organization, and keep this page next to your wider incident policy.

## Severity

| Level | Examples | Response |
|---|---|---|
| SEV-1 | Cross-tenant data exposure, credential or secret leak, data loss, the production database unavailable | Immediately; incident lead plus security; consider regulatory notification |
| SEV-2 | Degraded service, failing backups, a compromised user account, a malicious upload detected | Within hours |
| SEV-3 | A single failing integration or job, a non-sensitive bug | Next business day |

## First hour checklist

1. **Assign** an incident lead and a scribe, open a timeline (UTC), and preserve evidence: do not delete logs or containers.
2. **Contain**, choosing what fits:
   - Revoke sessions: `node dist/cli/revoke-sessions.js --all | --user <email> | --org <slug> --reason "…"` (in the API container). Audited.
   - Suspend a member: in the app, **Settings → Members → Suspend**. This takes effect immediately for existing sessions.
   - Rotate secrets as described in [OPERATIONS.md](OPERATIONS.md#secrets-and-credential-rotation). `AUTH_SECRET` covers download links only; sessions need revocation.
   - Disable AI or email: set `AI_ENABLED=false` or `EMAIL_PROVIDER=none` and restart. The product works fully without them.
   - Disable an integration: set it to *disabled* on the Integrations page. Checks that depend on it report `unknown`.
   - Take the service offline: `docker compose … stop web api worker` (Caddy then returns 502). Use this as a last resort.
3. **Scope** the incident:
   - Audit events: **Audit Log**, filtered by actor, action, entity or time, or `audit_events` read-only via SQL.
   - Correlate request IDs between user reports, JSON logs and audit rows.
   - Check `evidence_access_logs` for who generated download links and downloaded files.
   - Check `authz.denied` and `auth.login_failed` events for probing.
4. **Decide on notification** with legal and privacy contacts: affected organizations, regulators (for example GDPR personal-data breach notification within 72 hours where applicable), and customers. Record the decision and its rationale.

## Specific playbooks

| Situation | Steps |
|---|---|
| **Suspected cross-tenant access** | SEV-1. Capture the request IDs. Compare `organization_id` on the records accessed (audit `entity_id`) against the actor's memberships. Revoke the affected sessions. Add a failing test that reproduces the issue before fixing it. |
| **Leaked secret** (in the repository, logs or screenshots) | Rotate it immediately, then check where it was used. Remove it from the repository's history if it was committed (gitleaks in CI should catch this), and re-scan. |
| **Compromised user account** | Suspend the member, then reset the password with `node dist/cli/reset-password.js --email <email> --reason "…"`. This revokes all of their sessions and forces a change at next sign-in; deliver the one-time password out of band. Review their recent audit events, downloads and approvals. Re-review any decision they made during the window. |
| **Malicious evidence upload** | Archive the evidence (with a rationale). Download it only in an isolated environment for analysis. Review `evidence_access_logs` to see who opened it. Consider configuring the malware-scanner hook. |
| **Data loss or corruption** | Stop writes (stop API and worker). Identify the last good backup, restore it into a separate database, verify it, and cut over ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)). Communicate the data-loss window. |
| **AI provider concern** | Set `AI_ENABLED=false`. The `ai_artifacts` table lists exactly which records (by ID and version) were sent, to which provider and model, and with what redactions. |

## Afterwards

- Write a blameless post-incident review within 5 business days: timeline, root cause, what worked, and actions with owners.
- Add or extend tests and monitoring for the failure, and update this runbook and the [THREAT_MODEL.md](THREAT_MODEL.md).
- Record any risk accepted as a result in SentinelGRC itself, with an expiry date.
