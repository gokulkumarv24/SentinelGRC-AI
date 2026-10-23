/**
 * In-app guidance shown by <PageHelp> under every page title, and collected on the Help & Guide page.
 * Plain language for people new to governance, risk and compliance (GRC). Keys are route patterns.
 */
export interface PageGuide {
  /** One sentence: what this page is for. */
  summary: string;
  /** The usual way to use the page, in order. */
  steps: string[];
  /** Short hints that prevent common mistakes. */
  tips?: string[];
  /** Who can do what here (buttons appear only for people with the right role). */
  who?: string;
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  "/dashboard": {
    summary: "Your organization at a glance: risks by rating, overdue work, expiring evidence and recent activity.",
    steps: ["Check the numbers in red first — they are overdue or high risk.", "Click any card or chart to open the records behind it.", "New here? Follow the “Your first steps” card, or open Help & Guide in the sidebar."],
    tips: ["The dashboard only shows what your role is allowed to see."],
  },
  "/help": {
    summary: "How the platform works, where to start for your role, and what the terms mean.",
    steps: ["Pick your role under “Start here” and follow its first steps.", "Use the glossary when a word is unfamiliar.", "Every page also has a “How this page works” panel like this one."],
  },
  "/compliance/frameworks": {
    summary: "The standards and laws you follow (for example ISO 27001, SOC 2, GDPR) and how well your controls cover them.",
    steps: ["Open a framework to see its requirements and coverage.", "Choose which frameworks are in scope under Administration → Framework Settings.", "Import a new framework version with “Import a framework version” (CSV or JSON)."],
    tips: ["Coverage counts only approved mappings between requirements and your controls."],
    who: "Everyone can read. GRC managers and admins can import and configure.",
  },
  "/compliance/frameworks/[id]": {
    summary: "Every requirement of this framework and which of your controls cover it.",
    steps: ["Find a requirement (use the filter box).", "Use “Map control” to link one of your controls to it — another person must approve the link.", "Or press “Suggest mappings with the AI agent” to propose controls for every unmapped requirement at once."],
    tips: ["A mapping says “this control supports this requirement”; it is never a claim that they are identical."],
  },
  "/controls": {
    summary: "The security measures your organization actually runs, such as MFA, backups or access reviews.",
    steps: ["Add one with “New control”, or bring many in with “Import”.", "Open a control to set its owner, implementation status and review date.", "Attach evidence to each control so its automated checks can pass."],
    tips: ["Start from the illustrative templates if you have no list yet."],
    who: "GRC managers create controls; analysts and owners update them.",
  },
  "/controls/[id]": {
    summary: "One control: how it is implemented, its evidence, its automated checks and what frameworks it covers.",
    steps: ["Set the status and implementation notes under Implementation.", "Add or link evidence that proves the control works.", "Turn on an automated test so the platform checks it on a schedule.", "If something is wrong, create a finding from this page."],
  },
  "/controls/import": {
    summary: "Create or update many controls at once from a CSV file.",
    steps: ["Download the template or prepare a CSV with control code, title, description and category.", "Upload it and read the validation report — nothing is saved yet.", "Choose “create new only” or “create and update”, then confirm."],
  },
  "/controls/statement-of-applicability": {
    summary: "Which controls apply to you and why — the document ISO 27001 auditors ask for.",
    steps: ["Mark each control included or excluded.", "Write a short justification for every exclusion.", "Export it as a report from the Reports page when the auditor asks."],
  },
  "/compliance/control-tests": {
    summary: "Results of automatic and manual checks on your controls (pass, fail, unknown or error).",
    steps: ["Filter to “fail” to see what needs attention.", "Open a result to see exactly why it failed.", "Fix the cause (for example upload fresh evidence); the next scheduled run updates the result."],
    tips: ["A failing check creates a finding automatically; repeated failures update the same finding instead of creating duplicates.", "“Unknown” means there was no data to check — not a failure."],
  },
  "/evidence": {
    summary: "Proof that controls work: documents, exports and screenshots, with expiry dates and review status.",
    steps: ["Press “Add evidence”, choose the file and set when it expires.", "Link it to the control it proves (you can do this while uploading).", "A reviewer approves or rejects it. The AI agent pre-reviews each upload to save them time."],
    tips: ["Always set an expiry date so you are reminded before it goes stale.", "Files are stored privately and downloaded through short-lived links."],
    who: "Most roles can upload. GRC managers, analysts, vendor and AI officers can review.",
  },
  "/evidence/[id]": {
    summary: "One piece of evidence: the file, its dates, review status, links and the AI agent's pre-review.",
    steps: ["Read the AI pre-review — it flags expired, unlinked or irrelevant evidence.", "Preview or download the file to check it.", "Approve or reject it with a short note.", "Link it to more controls, risks or vendors if it proves them too."],
  },
  "/compliance/mappings": {
    summary: "Links between framework requirements and your controls, each reviewed by a second person.",
    steps: ["Open the “Review queue” tab to see proposals waiting for you.", "Read the rationale, then approve or reject — tick several to review them together.", "Use “Propose mapping” to add one yourself."],
    tips: ["You cannot approve a mapping you proposed yourself.", "Suggestions from the AI agent say so in their rationale."],
    who: "GRC managers propose and review mappings.",
  },
  "/risks": {
    summary: "Your risk register: what could go wrong, how likely and how bad it would be.",
    steps: ["Press “New risk” and describe it.", "Score likelihood and impact from 1 to 5 — the platform multiplies them (1–25) and gives a rating.", "Assign an owner and link the controls that reduce it.", "The heatmap shows where your risks sit."],
    tips: ["Inherent score = before controls. Residual score = after verified controls; it can never be higher than inherent and needs a reason."],
    who: "GRC managers, analysts, vendor and AI officers create risks. Risk owners update the risks assigned to them.",
  },
  "/risks/[id]": {
    summary: "One risk: its scores, owner, linked controls, findings, history and any acceptance.",
    steps: ["Update the scores when something changes; every change is kept in History.", "Link the controls that reduce it.", "If you decide to live with it, use “Request acceptance” with a reason and an end date."],
    tips: ["Someone other than the requester or owner must approve an acceptance."],
  },
  "/risks/acceptance": {
    summary: "Requests to formally accept a risk for a limited time, and their decisions.",
    steps: ["Read the reason, scope and expiry of each pending request.", "Approve or reject with a rationale.", "Approved acceptances expire automatically and the risk returns to review."],
    who: "GRC managers decide. You cannot decide your own request or a risk you own.",
  },
  "/findings": {
    summary: "Concrete problems to fix — from failed checks, vendor or AI assessments, incidents or added by hand.",
    steps: ["Open a finding; the AI agent has already suggested its category, owner, priority and a fix.", "Press “Apply triage” and “Create suggested remediation task”, or change them first.", "When the fix is done and checked, close the finding with evidence."],
    tips: ["Re-detected problems update the existing finding (see “detections”) instead of creating a new one."],
  },
  "/findings/[id]": {
    summary: "One finding: what is wrong, who owns it, its remediation tasks and the AI agent's triage.",
    steps: ["Review the AI triage and press “Apply triage” to set owner, category, risk link and due date in one go.", "Create the remediation task (pre-filled from the triage).", "Move the status along as work happens; close it with evidence and a rationale."],
  },
  "/remediation": {
    summary: "The tasks that fix findings, with owners, priorities and due dates.",
    steps: ["Filter to your own tasks or to overdue ones.", "Open a task to update progress or mark it complete with evidence.", "A reviewer validates the fix before the finding is closed."],
    tips: ["Owners get reminders before the due date and when it is overdue."],
  },
  "/remediation/[id]": {
    summary: "One remediation task: plan, owner, due date, status and completion evidence.",
    steps: ["Set it to “in progress” when work starts.", "When done, add completion notes and evidence, then mark it completed.", "For vendor fixes, record the vendor's response separately."],
  },
  "/vendors": {
    summary: "Your third parties (suppliers, SaaS, processors) and how risky each one is.",
    steps: ["Press “New vendor” and describe the service, the data it touches and its access.", "The platform calculates the inherent risk; the AI agent checks the profile for gaps.", "Start an assessment from the vendor's page to measure their controls."],
    tips: ["Higher inherent risk means a deeper assessment and more frequent reassessment."],
    who: "Vendor managers create and manage vendors.",
  },
  "/vendors/[id]": {
    summary: "One vendor: profile, inherent and residual risk, assessments, findings, contacts and AI help.",
    steps: ["Check the AI profile check and press “Apply corrections” if it is right.", "Start an assessment (or open the one the AI agent prepared for reassessment).", "Use the drafted follow-up message to chase open items — copy it into your email."],
  },
  "/vendors/assessments": {
    summary: "Every vendor security assessment and where it stands.",
    steps: ["Open an assessment that is “submitted” to review it.", "Drafts are waiting for answers — send the vendor a portal link from inside.", "Approved and closed ones are kept with their scores for audit."],
  },
  "/vendors/assessments/[id]": {
    summary: "One vendor questionnaire: answers, evidence, your review, the score and the decision.",
    steps: ["Send the vendor a one-time portal link, or fill in the answers yourself.", "After submission, press “Fill in suggested review” to use the AI agent's pre-review, check it, then “Save review”.", "When every answer is reviewed, use the AI decision memo and record the decision.", "Gaps become findings automatically; high residual risk creates a shared risk."],
    tips: ["Scores are calculated by fixed rules from reviewed answers — AI never changes them.", "High-risk vendors must be decided by someone other than the assessor."],
  },
  "/vendors/questionnaires": {
    summary: "The question templates used for vendor assessments.",
    steps: ["Open a template to read its questions, weights and expected answers.", "Create a new version to change questions; used versions are frozen."],
  },
  "/ai-governance": {
    summary: "Every AI system your organization builds or uses, with its purpose, data, owners and stage.",
    steps: ["Press “Register AI system” for each AI use (including third-party AI features).", "The AI agent suggests a risk tier and what the assessment should focus on.", "Run an assessment before pilot or production — it is required."],
  },
  "/ai-governance/[id]": {
    summary: "One AI system: registration, intake review, readiness, evaluations, incidents, changes and EU AI Act check.",
    steps: ["Read the AI intake review for gaps in the registration.", "Start and complete an AI assessment; an approver signs it off.", "Record evaluations and incidents as they happen; record every model change."],
    tips: ["Deployment readiness lists everything that must be true before go-live."],
  },
  "/ai-governance/assessments": {
    summary: "AI risk assessments (bias, privacy, security, oversight) and their approval.",
    steps: ["Open a draft to answer its items with evidence.", "Submit it with a proposed risk tier.", "An AI governance officer approves or rejects it."],
  },
  "/ai-governance/assessments/[id]": {
    summary: "One AI assessment: items grouped by NIST AI RMF function, evidence and the decision.",
    steps: ["Answer each item satisfactory / unsatisfactory / not applicable with notes.", "Unsatisfactory items create a shared risk.", "Submit, then someone other than you approves."],
  },
  "/ai-governance/evaluations": {
    summary: "Test results for AI systems (accuracy, bias, security, robustness).",
    steps: ["Record an evaluation from the AI system's page.", "Failed evaluations should lead to a finding or change."],
  },
  "/ai-governance/incidents": {
    summary: "Things an AI system did wrong, tracked until resolved.",
    steps: ["Report an incident from the AI system's page.", "Update the status, root cause and lessons learned here.", "Link a finding when something must be fixed."],
  },
  "/ai-governance/changes": {
    summary: "Model, provider, data and purpose changes waiting for an independent review.",
    steps: ["Read the change and the AI agent's impact assessment (on the system's Changes tab).", "Approve or reject it — you cannot review your own change."],
  },
  "/workflows": {
    summary: "Automatic jobs: reminders, scheduled checks, report schedules and the AI agent's jobs.",
    steps: ["Switch each job on or off.", "Change how often scheduled jobs run.", "Use “Run now” to trigger one immediately."],
    who: "Admins configure jobs; GRC managers and analysts can run them.",
  },
  "/workflows/runs": {
    summary: "Every job run with its result — including failures, which are never hidden.",
    steps: ["Filter to “failed” to find problems.", "Open a run to see each step and the error.", "Press “Retry” once the cause is fixed."],
  },
  "/workflows/runs/[id]": {
    summary: "One job run: trigger, steps, attempts and result.",
    steps: ["Read the failed step's error code.", "Fix the cause (for example integration settings) and retry."],
  },
  "/integrations": {
    summary: "Connections to outside systems (for example your identity provider) that feed automated checks.",
    steps: ["Press “Add integration” and choose the type.", "Enter its settings, then “Test” and “Sync”.", "Watch the sync history; failures alert administrators."],
  },
  "/integrations/[id]": {
    summary: "One integration: settings, sync history and the records it brought in.",
    steps: ["Update settings and save.", "Disable it if it should stop syncing."],
  },
  "/reports": {
    summary: "PDF, CSV and Excel reports — executive summary, risk register, vendor, Statement of Applicability and more.",
    steps: ["Choose a report type and format, then generate it.", "Download it when it shows “ready”; the AI agent adds a management summary.", "Use “Create schedule” to receive it automatically (for example monthly)."],
    tips: ["Every report lists the source records in an appendix so numbers can be checked."],
  },
  "/assistant": {
    summary: "Every AI draft — yours and the AI agent's — with its review status.",
    steps: ["Filter to drafts not yet reviewed.", "Open the record a draft belongs to and accept, apply or reject it there."],
    tips: ["AI drafts never change records by themselves."],
  },
  "/audit-log": {
    summary: "A permanent record of who did what, when and from where. Nobody can edit or delete it.",
    steps: ["Search by action, record or person.", "Open an entry to see the before/after values and request ID."],
  },
  "/settings/members": {
    summary: "The people in your organization and their roles.",
    steps: ["Press “Invite a member”, enter their email and choose roles.", "Give each person only the roles they need.", "Suspend people who leave instead of deleting them, so history stays intact."],
    tips: ["Roles: Organization Admin runs the system; GRC Manager, Analyst, Vendor Manager and AI Governance Officer do the work; Risk Owner handles their own risks; Auditor reads everything; Contributor adds records."],
    who: "Organization admins.",
  },
  "/settings/organization": {
    summary: "Organization profile and rules: time zone, retention periods, separation of duties and AI switch.",
    steps: ["Set your time zone first — reports and reminders use it.", "Decide whether low risks may be self-approved.", "Turn AI features on or off for the whole organization."],
  },
  "/settings/risk-policies": {
    summary: "The scoring rules for risks and vendors (rating bands, acceptance limits).",
    steps: ["Read the current policy.", "Create a new version to change it; old scores keep the version they used."],
  },
  "/settings/frameworks": {
    summary: "Which frameworks are in scope for your organization.",
    steps: ["Tick the frameworks you must comply with.", "Only in-scope frameworks count toward compliance coverage."],
  },
  "/settings/notifications": {
    summary: "Which notifications you receive in the app and by email.",
    steps: ["Turn notification types on or off for yourself.", "“AI agent ready” notifications tell you when the agent prepared something for you."],
  },
  "/platform/organizations": {
    summary: "Platform administration: create customer organizations and invite their first administrator.",
    steps: ["Press “New organization” and fill in its details.", "Copy the one-time invitation link (valid 72 hours) and send it to the first admin."],
  },
  "/agent": {
    summary: "The AI agent works in the background so your team only checks and decides. It never approves, closes or sends anything on its own.",
    steps: ["Ask a question about your data in “Ask the platform”.", "Open “Waiting for review” to see what the agent prepared and apply it on the record.", "Create proposed risks with one click, and read the weekly vendor digest.", "Draft a policy from your controls and save it as a document.", "Switch individual agent jobs on or off at the bottom."],
    tips: ["If the status says “Paused”, the reason is shown (for example AI switched off or today's budget used up)."],
  },
  "/trust/questionnaires": {
    summary: "Security questionnaires your customers send you, answered with the AI agent.",
    steps: ["Press “New questionnaire” and paste the questions (one per line) or load a CSV.", "The agent answers from approved past answers first, then from your controls and evidence.", "Open it, check each answer and approve it; export a CSV when done."],
    tips: ["Every approved answer is saved in the Answer Library and reused next time — the more you approve, the less work each questionnaire takes."],
    who: "GRC managers and analysts. Auditors can read.",
  },
  "/trust/questionnaires/[id]": {
    summary: "One customer questionnaire: every question with its drafted answer and status.",
    steps: ["Filter to “Needs input” and write those answers yourself.", "Read the drafted answers; edit or approve each one (or “Approve all drafted” after reading).", "Export the CSV and send it to the customer."],
    tips: ["“From library” answers were approved before; “AI draft” answers are new and need extra care."],
  },
  "/trust/library": {
    summary: "Every answer a person approved, reused automatically for future questionnaires.",
    steps: ["Search to find an answer.", "Remove answers that are no longer true so they are not reused."],
  },
  "/account/password": {
    summary: "Change your password.",
    steps: ["Enter your current password, then a new one of at least 12 characters.", "You stay signed in on this device; other sessions are signed out."],
  },
};

/** Finds the guide for a path, treating UUID segments as [id]. */
export function guideFor(pathname: string): { key: string; guide: PageGuide } | null {
  const key = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/[id]").replace(/\/$/, "") || "/";
  const guide = PAGE_GUIDES[key];
  return guide ? { key, guide } : null;
}

export interface RoleStart {
  role: string;
  name: string;
  purpose: string;
  steps: Array<{ label: string; href: string }>;
}

/** First steps for each role (Help & Guide page and the dashboard welcome card). */
export const ROLE_STARTS: RoleStart[] = [
  {
    role: "org_admin",
    name: "Organization admin",
    purpose: "You set up the organization and the team. The GRC work itself is done by the other roles.",
    steps: [
      { label: "Set the time zone and rules", href: "/settings/organization" },
      { label: "Choose the frameworks in scope", href: "/settings/frameworks" },
      { label: "Invite your team and give each person a role", href: "/settings/members" },
      { label: "Switch on the AI agent jobs you want", href: "/agent" },
    ],
  },
  {
    role: "grc_manager",
    name: "GRC manager",
    purpose: "You run compliance: controls, mappings, evidence review, risks and reports.",
    steps: [
      { label: "Add or import your controls", href: "/controls" },
      { label: "Map them to your frameworks (the AI agent can propose mappings)", href: "/compliance/frameworks" },
      { label: "Review evidence and the review queue", href: "/evidence" },
      { label: "Record your main risks", href: "/risks" },
      { label: "Generate the executive summary report", href: "/reports" },
    ],
  },
  {
    role: "security_analyst",
    name: "Security analyst",
    purpose: "You test controls, review evidence and drive findings to a fix.",
    steps: [
      { label: "Check failing control tests", href: "/compliance/control-tests" },
      { label: "Triage new findings (the AI agent pre-fills them)", href: "/findings" },
      { label: "Work through remediation tasks", href: "/remediation" },
      { label: "Answer customer questionnaires with the AI agent", href: "/trust/questionnaires" },
    ],
  },
  {
    role: "risk_owner",
    name: "Risk owner",
    purpose: "You keep your own risks and their fixes up to date.",
    steps: [
      { label: "Open your risks and update their scores", href: "/risks" },
      { label: "Complete your remediation tasks", href: "/remediation" },
      { label: "Upload the evidence you are asked for", href: "/evidence" },
    ],
  },
  {
    role: "vendor_manager",
    name: "Vendor manager",
    purpose: "You assess and monitor third parties.",
    steps: [
      { label: "Register a vendor (the AI agent checks the profile)", href: "/vendors" },
      { label: "Start an assessment and send the vendor a portal link", href: "/vendors/assessments" },
      { label: "Review submitted answers with the AI pre-review", href: "/vendors/assessments" },
      { label: "Read the weekly vendor digest", href: "/agent" },
    ],
  },
  {
    role: "ai_governance_officer",
    name: "AI governance officer",
    purpose: "You keep an inventory of AI systems and approve their safe use.",
    steps: [
      { label: "Register every AI system in use", href: "/ai-governance" },
      { label: "Run and approve AI assessments", href: "/ai-governance/assessments" },
      { label: "Review model changes", href: "/ai-governance/changes" },
    ],
  },
  {
    role: "auditor",
    name: "Auditor",
    purpose: "You can read everything and download reports, but cannot change anything.",
    steps: [
      { label: "Download reports with their source appendix", href: "/reports" },
      { label: "Check who did what in the audit log", href: "/audit-log" },
      { label: "Look at controls and their evidence", href: "/controls" },
    ],
  },
  {
    role: "contributor",
    name: "Contributor",
    purpose: "You add and update records; approvals are done by others.",
    steps: [
      { label: "Upload evidence for controls you own", href: "/evidence" },
      { label: "Record a risk you have noticed", href: "/risks" },
    ],
  },
];

/** Plain-language meanings of the terms used across the platform. */
export const GLOSSARY: Array<{ term: string; meaning: string }> = [
  { term: "Framework", meaning: "A standard or law you follow, such as ISO 27001, SOC 2 or GDPR. It is made of requirements." },
  { term: "Control", meaning: "Something your organization does to stay secure or compliant, such as “MFA for all admins”." },
  { term: "Mapping", meaning: "A reviewed link saying a control supports a framework requirement." },
  { term: "Evidence", meaning: "Proof that a control works: a report, export, screenshot or record, with an expiry date." },
  { term: "Control test", meaning: "An automatic or manual check of a control. Results: pass, fail, unknown (no data) or error." },
  { term: "Finding", meaning: "A concrete problem that must be fixed, for example “2 admins without MFA”." },
  { term: "Remediation task", meaning: "The work that fixes a finding, with an owner and a due date." },
  { term: "Risk", meaning: "Something that could go wrong. Scored as likelihood × impact (each 1–5, so 1–25)." },
  { term: "Inherent risk", meaning: "How big a risk is before your controls." },
  { term: "Residual risk", meaning: "How big a risk is after your verified controls. Never higher than inherent." },
  { term: "Risk acceptance", meaning: "A formal, time-limited decision to live with a risk, approved by someone else." },
  { term: "Vendor / third party", meaning: "An outside company that provides a service or handles your data." },
  { term: "Assessment", meaning: "A questionnaire that measures a vendor's or AI system's controls." },
  { term: "Statement of Applicability (SoA)", meaning: "The list of controls that apply to you and why — required for ISO 27001." },
  { term: "Separation of duties", meaning: "The person who asks for something cannot also approve it." },
  { term: "AI agent", meaning: "Background jobs that prepare drafts (reviews, triage, answers). People always make the decision." },
  { term: "Draft", meaning: "AI output waiting for a person. It never changes a record by itself." },
  { term: "Audit log", meaning: "The permanent record of every action, who did it and when." },
];
