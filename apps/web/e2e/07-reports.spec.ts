import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { signIn } from "./helpers";

test.describe("Reports", () => {
  test("generates a report in the background and downloads it", async ({ page }) => {
    await signIn(page, "grc");
    await page.goto("/reports");
    await page.locator("#type").click();
    await page.getByRole("option", { name: "Risk register export" }).click();
    await page.locator("#format").click();
    await page.getByRole("option", { name: "CSV" }).click();
    const title = `Risk register (E2E ${Date.now().toString(36)})`;
    await page.getByLabel("Title (optional)").fill(title);
    await page.getByRole("button", { name: "Generate" }).click();

    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row.getByText("Ready")).toBeVisible({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("link", { name: "Download" }).click()]);
    const csv = readFileSync(await download.path(), "utf8");
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    expect(csv).toContain(`Report,${title}`);
    expect(csv).toContain("Status,Draft");
    expect(csv).toContain("Compromise of privileged cloud accounts (DEMO)");
    expect(csv).toContain("not an audit opinion");
  });

  test("an auditor can download reports but cannot generate them", async ({ page }) => {
    await signIn(page, "auditor");
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Download" }).first()).toBeVisible();
  });
});
