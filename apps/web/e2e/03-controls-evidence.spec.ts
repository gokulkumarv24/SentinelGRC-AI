import { expect, test } from "@playwright/test";
import { PDF, signIn, uniq } from "./helpers";

test.describe("Controls and evidence", () => {
  test("creates a control and edits its implementation", async ({ page }) => {
    await signIn(page, "grc");
    await page.goto("/controls");
    await page.getByRole("button", { name: "New control" }).click();
    const dialog = page.getByRole("dialog");
    const code = `E2E-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await dialog.getByLabel("Control code").fill(code);
    await dialog.getByLabel("Category").fill("Endpoint security");
    await dialog.getByLabel("Title").fill("Endpoint disk encryption (E2E)");
    await dialog.getByLabel("Description").fill("All company laptops use full-disk encryption.");
    await dialog.getByRole("button", { name: /create|save/i }).click();
    await expect(page).toHaveURL(/\/controls\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: "Endpoint disk encryption (E2E)" })).toBeVisible();

    await page.getByLabel("Implementation status").click();
    await page.getByRole("option", { name: "Implemented", exact: true }).click();
    await page.getByLabel("Implementation notes").fill("Enforced through device management (E2E).");
    await page.getByRole("button", { name: "Save implementation" }).click();
    await expect(page.getByText(/saved|updated/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Implementation notes")).toHaveValue("Enforced through device management (E2E).");
  });

  test("uploads evidence from a control and links it automatically", async ({ page }) => {
    await signIn(page, "analyst");
    await page.goto("/controls?q=IR-01");
    await page.getByRole("link", { name: /IR-01/ }).first().click();
    await page.getByRole("tab", { name: /Evidence/ }).click();
    await page.getByRole("button", { name: "Upload" }).click();
    const dialog = page.getByRole("dialog");
    const title = uniq("Incident response plan v2 (E2E)");
    await dialog.getByLabel("Title").fill(title);
    await dialog.locator("#evidence-file").setInputFiles({ name: "ir-plan.pdf", mimeType: "application/pdf", buffer: PDF });
    await dialog.getByRole("button", { name: "Save evidence" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name: title })).toBeVisible();

    await page.getByRole("link", { name: title }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("IR-01 Incident response plan").first()).toBeVisible();
    await expect(page.getByText("application/pdf").first()).toBeVisible();
  });
});
