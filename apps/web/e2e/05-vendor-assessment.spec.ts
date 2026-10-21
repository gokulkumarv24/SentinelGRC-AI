import { expect, test } from "@playwright/test";
import { api, confirmWith, signIn, uniq } from "./helpers";

type Question = { id: string; questionKey: string; visible: boolean };

test.describe("Third-party risk", () => {
  test("creates a vendor, starts an assessment and submits it for review", async ({ page }) => {
    await signIn(page, "vm");
    await page.goto("/vendors");
    await page.getByRole("button", { name: "New vendor" }).click();
    const dialog = page.getByRole("dialog");
    const name = uniq("Fictional Print Co (E2E)");
    await dialog.getByLabel(/^Name/).fill(name);
    await dialog.getByLabel("Service provided").fill("Printing and mailing of customer letters");
    await dialog.getByRole("button", { name: "Create vendor" }).click();
    await expect(page).toHaveURL(/\/vendors\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByRole("button", { name: "Start assessment" }).click();
    await page.getByRole("dialog").getByLabel("Questionnaire").click();
    await page.getByRole("option").first().click();
    await confirmWith(page, "Start");
    await expect(page).toHaveURL(/\/vendors\/assessments\/[0-9a-f-]{36}/);
    const assessmentId = page.url().split("/").pop()!;

    // Answering ~20 questions by hand is not what this test is about: answers go in through the same API the form uses.
    const detail = await api<{ questions: Question[] }>(page, "GET", `/assessments/${assessmentId}`);
    const by = (k: string) => detail.questions.find((q) => q.questionKey === k)!.id;
    const today = new Date().toISOString().slice(0, 10);
    await api(page, "POST", `/assessments/${assessmentId}/responses`, {
      responses: [
        { questionId: by("gov.policy"), answer: true },
        { questionId: by("gov.certification"), answer: ["None"] },
        { questionId: by("iam.mfa"), answer: true },
        { questionId: by("iam.reviews"), answer: "Quarterly" },
        { questionId: by("enc.at_rest"), answer: true },
        { questionId: by("enc.in_transit"), answer: true },
        { questionId: by("vuln.pentest_date"), answer: today },
        { questionId: by("vuln.critical_sla"), answer: 7 },
        { questionId: by("ir.plan"), answer: true },
        { questionId: by("ir.notify_hours"), answer: 24 },
        { questionId: by("bc.backup_test"), answer: true },
        { questionId: by("priv.dpa"), answer: true },
        { questionId: by("sub.list"), answer: false },
        { questionId: by("loc.regions"), answer: ["EU/EEA"] },
        { questionId: by("dev.sdlc"), answer: "Code review and dependency scanning" },
        { questionId: by("ai.usage"), answer: false },
      ],
    });
    await page.reload();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await confirmWith(page, "Submit");
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save answers" })).toHaveCount(0);
  });
});
