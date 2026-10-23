# AI agent

The AI agent is a set of background jobs that prepare work so people only check and decide. It runs on the worker (or inside the API with `RUN_WORKER_IN_API=true`), uses the same AI tasks as the on-demand assistant, and stores everything as **drafts** labelled "Prepared by the AI agent".

It never approves, rejects, decides, closes, changes scores or sends anything outside the platform. The few records it creates on its own are routine and reviewable: a draft vendor reassessment, and mapping proposals in the review queue.

## Jobs

Each job is a workflow definition, so an administrator can switch it on or off on **AI Agent** or **Workflows**. Every run appears under **Runs and Failures**.

| Job | Trigger | What it prepares | Where people use it |
|---|---|---|---|
| Evidence pre-review | Evidence uploaded | Verdict (sufficient / needs attention / insufficient) with reasons. Vendor documents also get an analysis: SOC 2, ISO, pentest or contract type, exceptions, missing contract clauses | Evidence page |
| Vendor questionnaire pre-review | Questionnaire submitted | Suggested review status and note per answer, plus follow-up questions | Assessment page: **Fill in suggested review**, **Copy follow-up questions** |
| Vendor decision memo | Every answer reviewed | Recommended decision, conditions and review interval from the deterministic score | Assessment page: **Use recommended decision**, **Copy memo** |
| Vendor profile check | Vendor created | Corrections to criticality, data classification or access level; missing information; questionnaire focus | Vendor page: **Apply corrections** |
| Prepare vendor reassessments | Daily | Draft assessment (same questionnaire and assessor) for vendors due within 14 days | Assessments list |
| Weekly vendor digest | Weekly | Ranked list of vendors needing attention | AI Agent page; notification to vendor managers |
| Finding triage | Finding created | Category, severity, owner, priority, due date, related risk, remediation plan | Finding page: **Apply triage**, **Create suggested remediation task** |
| Evidence chaser | Daily | What to collect and a request to the owner, for evidence expiring within 14 days | Evidence page; notification to the owner |
| Report narrative | Report generated | Management summary using only the report's numbers | Reports page |
| Risk spotting | Weekly | Proposed new risks or re-scores from recent findings, AI incidents and high-risk vendors | AI Agent page: **Create risk** |
| AI system intake | AI system registered | Suggested risk tier, registration gaps, assessment focus | AI system page |
| AI change impact | Model change recorded | Whether reassessment is needed and what to re-test | AI system page, Changes tab |
| Answer customer questionnaires | Questionnaire created | Answers from the approved-answer library first, then from controls and evidence | Customer Questionnaires |
| Framework mapping suggestions | On request (framework page) | Up to three control mappings per unmapped requirement, into the review queue | Mappings: bulk approve or reject |

On-demand features use the same engine: **Ask the platform** and **Draft a policy** on the AI Agent page. An accepted policy can be saved to the evidence library as a document.

## Safety

- **Drafts only.** Every output is validated against its sources. Structured suggestions must be one of the allowed values (for example an existing member or risk ID); anything else is rejected.
- **Same protections as the assistant.** Redaction before sending, restricted evidence never sent to an external provider, prompt-injection text treated as data, and every draft recorded in the audit log (`ai.agent_generated`).
- **Pauses by itself** when AI is off (`AI_ENABLED`), switched off for the organization, data sharing is not approved, or the daily budget is used up. The reason is shown on the AI Agent page and recorded on the run. It is never an error.
- **No duplicate work.** It skips a record that already has a recent draft, and processes bounded batches per run.

## Cost and limits

- `AI_AGENT_DAILY_TOKEN_BUDGET` (default 150,000) caps the agent's tokens per rolling 24 hours, platform-wide. On Groq's free tier, one draft costs about 3,000–6,000 tokens, so the default covers roughly 25–50 agent drafts a day.
- `AI_FALLBACK_*` adds a second OpenAI-compatible provider, used when the first is rate limited or unavailable.
- **Without any AI key** (`AI_PROVIDER=mock`), the agent still works using deterministic rules (keyword, date, criteria and ownership checks). It is less fluent, but useful and free, and nothing leaves the server.

## Customer questionnaires and the answer library

1. Paste or upload the questions (one per line, `Section | Question`, or a CSV with a `question` column).
2. The agent reuses approved answers whose wording is similar enough (word overlap of 60% or more), then drafts the rest in batches of 10. Questions it cannot answer from your data are marked **needs input**.
3. A person edits and approves each answer, or uses **Approve all drafted** after reading them. Approved answers are added to the library, so the next questionnaire takes less work.
4. Export a CSV for the customer.
