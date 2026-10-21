import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("Dashboard and page states", () => {
  test("loads the dashboard from current records", async ({ page }) => {
    await signIn(page, "grc");
    await expect(page.getByText("Active risks")).toBeVisible();
    await expect(page.getByText("Open findings")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compliance by framework" })).toBeVisible();
    await expect(page.getByText("ISO/IEC 27001 2022")).toBeVisible();
  });

  test("shows a loading state while data is on its way", async ({ page }) => {
    await signIn(page, "grc");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/v1/risks?**", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/risks");
    await expect(page.getByRole("status").first()).toBeVisible();
    release();
    await expect(page.getByRole("link", { name: /Compromise of privileged cloud accounts/ }).first()).toBeVisible();
  });

  test("shows an error state with a request ID and recovers on retry", async ({ page }) => {
    await signIn(page, "grc");
    let fail = true;
    await page.route("**/api/v1/findings?**", (route) =>
      fail
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal_error", message: "Unexpected error" }, requestId: "e2e-request-123" }) })
        : route.continue(),
    );
    await page.goto("/findings");
    const alert = page.getByRole("alert").filter({ hasText: "Something went wrong" });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText("e2e-request-123");
    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("link", { name: /Privileged accounts without MFA/ }).first()).toBeVisible();
  });

  test("shows an empty state when there is nothing yet", async ({ page }) => {
    await signIn(page, "harbor");
    await page.goto("/vendors");
    await expect(page.getByText("No vendors yet")).toBeVisible();
  });
});
