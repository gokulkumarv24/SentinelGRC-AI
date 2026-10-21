import { expect, test } from "@playwright/test";
import { api, confirmWith, signIn, uniq } from "./helpers";

test.describe("AI governance and approvals", () => {
  test("registers an AI system, completes its assessment, and an independent approver approves it", async ({ page, browser }) => {
    await signIn(page, "ai");
    await page.goto("/ai-governance");
    await page.getByRole("button", { name: "Register AI system" }).click();
    const dialog = page.getByRole("dialog");
    const name = uniq("Invoice classifier (E2E, fictional)");
    await dialog.getByLabel(/^Name/).fill(name);
    await dialog.getByLabel(/^Description/).fill("Routes supplier invoices to the right cost centre.");
    await dialog.getByLabel("Business purpose").fill("Reduce manual invoice routing");
    await dialog.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/ai-governance\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page).toHaveURL(/\/ai-governance\/assessments\/[0-9a-f-]{36}/);
    const assessmentUrl = page.url();
    const assessmentId = assessmentUrl.split("/").pop()!;
    const detail = await api<{ items: Array<{ id: string }> }>(page, "GET", `/ai-assessments/${assessmentId}`);
    await api(page, "POST", `/ai-assessments/${assessmentId}/items`, { items: detail.items.map((i) => ({ itemId: i.id, response: "Documented and reviewed (E2E)", result: "satisfactory" })) });
    await page.reload();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await confirmWith(page, "Submit", "Low-impact internal routing with human review of exceptions (E2E).");
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    // The submitter cannot approve their own assessment.
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

    const approver = await browser.newPage();
    await signIn(approver, "ciso");
    await approver.goto(assessmentUrl);
    await approver.getByRole("button", { name: "Approve", exact: true }).click();
    await confirmWith(approver, "Approve", "Mitigations adequate for internal use (E2E).");
    await expect(approver.getByText("Approved", { exact: true }).first()).toBeVisible();
    await approver.close();
  });

  test("a risk owner requests acceptance and only a different authorized person can approve it", async ({ page, browser }) => {
    await signIn(page, "owner");
    await page.goto("/risks");
    await page.getByRole("link", { name: /Ineffective incident response/ }).first().click();
    await expect(page).toHaveURL(/\/risks\/[0-9a-f-]{36}/);
    const riskUrl = page.url();
    await page.getByRole("button", { name: "Request acceptance" }).click();
    const expiry = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Acceptance expires on").fill(expiry);
    await confirmWith(page, "Submit request", "Tabletop exercise is booked for next quarter; interim on-call runbook in place (E2E).");
    await expect(page.getByText(/Requested by/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

    const approver = await browser.newPage();
    await signIn(approver, "grc");
    await approver.goto(riskUrl);
    await approver.getByRole("button", { name: "Approve", exact: true }).click();
    await confirmWith(approver, "Approve", "Interim runbook verified; re-review at expiry (E2E).");
    await expect(approver.getByText(/Accepted until/)).toBeVisible();
    await approver.close();
  });
});
