# Demo scenario

Everything in the demo is synthetic. **Northstar Digital Services (DEMO)** and **Harbor Logistics (DEMO)** are fictional organizations. Every person, vendor, AI system, document and number is invented, and records are labelled "(DEMO)" or "(fictional)".

## Load the demo

```bash
npm run db:local -w services/api        # local Postgres (or point DATABASE_URL at your own)
npm run db:migrate -w services/api
npm run build -w services/api
npm run seed:demo -w services/api       # requires DEMO_MODE=true; refuses otherwise
```

The seed starts the API inside its own process and creates everything through the normal HTTP API, signed in as the demo users. That means scores, findings, notifications, workflow runs and audit events all come from the same code paths production uses.

The seed is idempotent:
- Records are matched by natural keys (control codes, titles, names).
- Steps that change state (decisions, approvals, closures) are skipped once they are done.

Running it again changes nothing except recording one more "framework scope saved" audit event.

Sign-in details for new demo users are written to `var/demo-credentials.txt`, which is gitignored and local only. Each new user must change the password at first sign-in. For automated local tests only, `-- --no-force-change` skips that requirement. Existing users' passwords are never changed.

| User | Role(s) | Use it to see |
|---|---|---|
| admin@northstar-demo.example | Org admin | Members, settings, integrations, workflows |
| grc.manager@northstar-demo.example | GRC manager | Compliance, risks, findings, reports, AI drafts |
| ciso@northstar-demo.example | GRC manager + vendor manager + AI governance officer | The independent approver for vendor, AI and evidence decisions |
| analyst@northstar-demo.example | Security analyst | Evidence, control tests, remediation |
| risk.owner@northstar-demo.example | Risk owner | Owned risks; can request but not approve acceptance |
| vendor.manager@northstar-demo.example | Vendor manager | Vendors and assessments |
| ai.officer@northstar-demo.example | AI governance officer | AI inventory, assessments, incidents |
| auditor@northstar-demo.example | Auditor | Read-only access, reports, audit log |
| contributor@northstar-demo.example | Contributor | Limited create rights; no approvals |
| ops.lead@harbor-logistics-demo.example | GRC manager in **another** organization | Tenant isolation |

## What the seed creates

- **10 controls** adopted from the illustrative templates, with owners and implementation statuses. Their framework mappings stay **unreviewed** and illustrative until someone reviews them.
- **8 evidence records** (fictional PDFs with real text):
  - The backup restore test report and the privileged account inventory have **expired**.
  - The MFA export and the vulnerability scan expire within 30 days.
  - The MFA export is still awaiting review.
  - **IR-01 has no evidence at all**, so its check reports *unknown*, never *fail*.
- **Demo identity integration**: first a sync that **fails** visibly (3 bounded attempts, integration and workflow failure alerts), then a successful sync in which one privileged account lacks MFA.
- **5 risks** with different ratings, linked to controls. Two have assessed residual scores. One acceptance was requested by the risk owner and approved by a different person.
- **8 findings and 8 remediation tasks**: two from automated checks, three from the vendor assessment, one from the AI assessment and two manual ones. One is completed, validated and closed.
- **3 vendors**:
  - Cloudbase: assessed, reviewed and *approved with conditions*.
  - Mailstream: an assessment in progress with gaps.
  - Payroll Partners: onboarding.
- **3 AI systems**:
  - Support reply assistant: in pilot, with an approved assessment, a shared risk, a failed security evaluation and a resolved incident.
  - CV screening ranker: under assessment, unresolved.
  - Internal code assistant: proposed.
- **Reports**: executive risk summary (PDF, final), risk register (CSV), the Cloudbase vendor assessment (PDF, final).
- **Harbor Logistics (DEMO)**, with one risk, to show tenant isolation.

## The nine required scenarios (spec §19)

1. **A scheduled control test detects missing or expired evidence.** Sign in as *analyst*, open **Controls → BCP-01 → Test history**: `evidence_currency` *fail*, "All linked evidence has expired". IR-01 shows *unknown* (no evidence), not *fail*. **Workflows → Runs** lists the scheduled-test runs.
2. **A finding is created or updated idempotently.** **Findings**: *Expired evidence for BCP-01* and *Privileged accounts without MFA* each exist once. The detection count and *last detected* show they were re-detected on later runs rather than duplicated.
3. **A remediation task is assigned.** **Remediation**: every open finding has a task with an owner, a priority and a due date. The *training completion* task is completed, and its finding was closed by the GRC manager.
4. **A vendor assessment produces a documented risk score and an evidence-backed finding.** Sign in as *vendor.manager*, open **Vendors → Cloudbase Hosting → assessment**:
   - The inherent and residual scores come with a factor breakdown.
   - The responses cite the attached certificate evidence.
   - Findings were raised for missing MFA (high) and missing supporting evidence (low).
5. **A vendor risk is linked to a relevant control.** **Risks →** the Cloudbase vendor risk: the *Controls* section shows TPR-01 (*mitigates*, partially effective).
6. **An AI system assessment creates or links a shared risk.** Sign in as *ai.officer*, open **AI Governance → Support reply assistant**: the unsatisfactory prompt-injection item created a shared risk in the register, linked to the system and its assessment, with a documented residual score.
7. **A reviewer approves or rejects a proposed action.** The CISO approved:
   - the Cloudbase decision (with conditions)
   - the AI assessment
   - the pilot deployment
   - evidence reviews

   The GRC manager approved the risk owner's acceptance request (**Risks → Acceptance**). In each case the system blocks the requester from approving their own request.
8. **A report includes the source records and correct calculations.** Sign in as *grc.manager* or *auditor*, open **Reports**, and download the *Executive risk summary (DEMO)*. Its counts match the Risks and Findings pages, and the appendix lists the source record IDs. The risk register CSV reconciles row by row.
9. **A restricted user is denied access to another organization's data.** Sign in as *ops.lead@harbor-logistics-demo.example*: no Northstar records appear anywhere, and any Northstar URL returns "not found". The seed checks this in both directions on every run and fails if either request succeeds.

## Notes

- With `AI_ENABLED=true` (the mock provider by default), the seed also creates an AI draft of evidence statements for the security policy, awaiting human review. The demo does not depend on AI.
- The dates are relative to the day the seed first runs, so expired and expiring states stay meaningful.
- Real organizations must never use the demo credentials, organizations or `DEMO_MODE`. The production configuration rejects `DEMO_MODE=true`.
