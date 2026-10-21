import { expect, test } from "@playwright/test";
import { confirmWith, signIn } from "./helpers";

test.describe("Control tests and findings", () => {
  test("runs a control test that fails, then reviews the resulting finding", async ({ page }) => {
    await signIn(page, "analyst");
    await page.goto("/controls?q=BCP-01");
    await page.getByRole("link", { name: /BCP-01/ }).first().click();
    await page.getByRole("button", { name: "Run automated tests" }).click();
    await page.getByRole("tab", { name: /Tests/ }).click();
    const history = page.getByRole("table", { name: "Control test history" });
    await expect(history.getByText("All linked evidence has expired").first()).toBeVisible();

    // The re-run updated the existing finding instead of creating a duplicate.
    await history.getByRole("link", { name: "View finding" }).first().click();
    await expect(page.getByRole("heading", { name: "Expired evidence for BCP-01" })).toBeVisible();
    await expect(page.getByText(/Detected \d+ times/)).toBeVisible();

    await page.getByRole("button", { name: "Request validation" }).click();
    await confirmWith(page, "Request validation", "New restore test scheduled; please validate once the report is uploaded (E2E).");
    await expect(page.getByText("in remediation → pending validation")).toBeVisible();
  });
});
