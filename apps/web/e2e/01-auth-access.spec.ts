import { expect, test } from "@playwright/test";
import { api, signIn, USERS } from "./helpers";

test.describe("Sign-in, sign-out and access boundaries", () => {
  test("signs in, signs out, and protects pages afterwards", async ({ page }) => {
    await signIn(page, "analyst");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/findings");
    await expect(page).toHaveURL(/\/login\?next=%2Ffindings/);
  });

  test("rejects a wrong password without revealing which part was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(USERS.analyst);
    await page.getByLabel("Password").fill("Not-the-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("hides actions a role cannot take and the API denies them anyway", async ({ page }) => {
    await signIn(page, "auditor");
    await page.goto("/controls");
    await expect(page.getByRole("heading", { name: "Controls", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "New control" })).toHaveCount(0);
    const csrf = (await page.context().cookies()).find((c) => c.name === "sg_csrf")?.value ?? "";
    const res = await page.request.post("/api/v1/controls", { data: { controlCode: "X-1", title: "x", description: "x", category: "x" }, headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(403);
  });

  test("a user of another organization cannot see this organization's records", async ({ page, browser }) => {
    await signIn(page, "grc");
    const risks = await api<{ items: Array<{ id: string; title: string }> }>(page, "GET", "/risks?pageSize=1");
    const northstarRisk = risks.items[0];

    const other = await browser.newPage();
    await signIn(other, "harbor");
    await other.goto("/risks");
    await expect(other.getByRole("link", { name: /Warehouse badge system outage/ })).toBeVisible();
    await expect(other.getByText(northstarRisk.title)).toHaveCount(0);
    await other.goto(`/risks/${northstarRisk.id}`);
    await expect(other.getByText(/not found/i).first()).toBeVisible();
    await expect(other.getByText(northstarRisk.title)).toHaveCount(0);
    await other.close();
  });
});
