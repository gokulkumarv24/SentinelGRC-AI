import { expect, test, type Page } from "@playwright/test";
import { api, PDF, signIn, uniq } from "./helpers";

/** Waits for the background AI agent (worker process) to finish, reloading until `check` passes. */
async function eventually(page: Page, check: () => Promise<void>, timeout = 90_000) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout, intervals: [2_000, 3_000, 5_000] });
}

test.describe("New-user guidance", () => {
  test("every page explains itself on the first visit and the guide can be closed and reopened", async ({ page }) => {
    await signIn(page, "grc");
    await expect(page.getByRole("region", { name: /your first steps/i })).toBeVisible();

    await page.goto("/risks");
    const guide = page.getByRole("region", { name: "How this page works" });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("likelihood and impact");
    await guide.getByRole("button", { name: "Got it" }).click();
    await expect(guide).toBeHidden();
    await page.reload();
    await expect(guide).toBeHidden(); // remembered
    await page.getByRole("button", { name: "How this page works" }).click();
    await expect(guide).toBeVisible();
  });

  test("Help & Guide starts with the person's own role and explains the terms", async ({ page }) => {
    await signIn(page, "vm");
    await page.getByRole("link", { name: "Help & Guide", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Help & Guide", level: 1 })).toBeVisible();
    const mine = page.getByRole("article", { name: "Vendor manager" });
    await expect(mine.getByText("Your role")).toBeVisible();
    await expect(page.getByText("Residual risk", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The AI agent" })).toBeVisible();
  });
});

test.describe("AI agent", () => {
  test("pre-reviews uploaded evidence in the background", async ({ page }) => {
    await signIn(page, "grc");
    const title = uniq("Firewall rule review (E2E)");
    const csrf = (await page.context().cookies()).find((c) => c.name === "sg_csrf")?.value ?? "";
    const res = await page.request.post("/api/v1/evidence", { multipart: { title, file: { name: "fw.pdf", mimeType: "application/pdf", buffer: PDF } }, headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/evidence/${id}`);
    const panel = page.getByRole("region", { name: "Pre-review for the reviewer" });
    await eventually(page, async () => {
      await expect(panel.getByText("Prepared by the AI agent")).toBeVisible({ timeout: 3_000 });
    });
    await expect(panel.getByText("Needs attention").or(panel.getByText("needs_attention")).first()).toBeVisible();
  });

  test("triages a new finding and pre-fills the remediation task", async ({ page }) => {
    await signIn(page, "grc");
    const title = uniq("Admin accounts without MFA (E2E)");
    const finding = await api<{ id: string }>(page, "POST", "/findings", { title, description: "Two administrator accounts have no multi-factor authentication.", severity: "high", noDueDateReason: "Set by triage" });
    await page.goto(`/findings/${finding.id}`);
    const panel = page.getByRole("region", { name: "Triage (prepared by the AI agent)" });
    await eventually(page, async () => {
      await expect(panel.getByRole("button", { name: "Apply triage" })).toBeVisible({ timeout: 3_000 });
    });
    await panel.getByRole("button", { name: "Apply triage" }).click();
    await expect(page.getByText("Finding updated")).toBeVisible();

    await panel.getByRole("button", { name: "Create suggested remediation task" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Title")).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Remediation task created", { exact: true })).toBeVisible();
  });

  test("answers a customer questionnaire; people approve the answers", async ({ page }) => {
    await signIn(page, "grc");
    await page.goto("/trust/questionnaires");
    await page.getByRole("button", { name: "New questionnaire" }).click();
    const dialog = page.getByRole("dialog");
    const customer = uniq("Acme (fictional, E2E)");
    await dialog.getByLabel("Customer").fill(customer);
    await dialog.getByLabel("Title").fill("Security review");
    await dialog.getByLabel("Questions").fill("Access | Do you enforce multi-factor authentication for administrators?\nDo you run a staff whistleblowing hotline?");
    await dialog.getByRole("button", { name: "Create and answer with AI" }).click();
    await expect(page.getByRole("heading", { name: customer })).toBeVisible();

    // The agent answers in the background; the page refreshes itself.
    await expect(page.getByRole("status").filter({ hasText: "The AI agent is answering" })).toBeHidden({ timeout: 90_000 });
    const needsInput = page.getByRole("tab", { name: /Needs input/ });
    await needsInput.click();
    await page.getByRole("button", { name: /Write answer|Edit/ }).first().click();
    await page.getByRole("radio", { name: "No", exact: true }).click();
    await page.getByLabel("Answer", { exact: true }).fill("No. Concerns are raised with the HR director directly (E2E).");
    await page.getByRole("button", { name: "Save and approve" }).click();
    await expect(page.getByText("Answer updated")).toBeVisible();
    await page.getByRole("tab", { name: /Approved/ }).click();
    await expect(page.getByText("raised with the HR director")).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /export\.csv$/);

    // Approved answers go to the library for reuse.
    await page.goto("/trust/library");
    await expect(page.getByText("raised with the HR director").first()).toBeVisible();
  });

  test("answers questions from the organization's own records and lists its jobs", async ({ page }) => {
    await signIn(page, "grc");
    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: "AI agent", level: 1 })).toBeVisible();
    await expect(page.getByText("Working", { exact: true })).toBeVisible();
    await page.getByLabel("Question", { exact: true }).fill("Which risks and vendors need attention?");
    await page.getByRole("button", { name: "Ask" }).click();
    const answer = page.getByRole("article", { name: "AI draft" }).first();
    await expect(answer).toContainText(/Active risks/);
    const jobs = page.getByRole("region", { name: "Agent jobs" });
    await expect(jobs.getByText("finding triage")).toBeVisible();
    await expect(jobs.getByRole("switch").first()).toBeVisible();
  });
});
