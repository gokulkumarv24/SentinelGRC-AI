import { expect, test } from "@playwright/test";
import { api, signIn } from "./helpers";

test.describe("Organization setup and onboarding", () => {
  test("a platform admin creates an organization; its first admin joins and sees the setup checklist", async ({ page, browser }) => {
    await signIn(page, "platform", { expectDashboard: false });
    await expect(page.getByText("No organization selected")).toBeVisible();
    await page.getByRole("link", { name: "Manage organizations" }).click();
    await expect(page.getByRole("heading", { name: "Organizations", level: 1 })).toBeVisible();
    await expect(page.getByText("Northstar Digital Services (DEMO)")).toBeVisible();

    const suffix = Date.now().toString(36);
    const orgName = `Riverside Clinic ${suffix} (E2E)`;
    const adminEmail = `first.admin.${suffix}@riverside-e2e.example`;
    await page.getByRole("button", { name: "New organization" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(orgName);
    await expect(dialog.getByLabel("Short name (URL-safe)")).toHaveValue(`riverside-clinic-${suffix}-e2e`);
    await dialog.getByLabel("First administrator’s email").fill(adminEmail);
    await dialog.getByRole("button", { name: "Create organization" }).click();
    const inviteUrl = await dialog.getByLabel("Invitation link", { exact: true }).inputValue();
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(orgName)).toBeVisible();

    // The first administrator accepts the one-time invitation and chooses their own password.
    const admin = await browser.newPage();
    await admin.goto(inviteUrl);
    const password = "Riverside-Admin-Password-42";
    await admin.getByLabel("Your name").fill("Riley First (E2E)");
    await admin.getByLabel("Password", { exact: true }).fill(password);
    await admin.getByLabel("Confirm password").fill(password);
    await admin.getByRole("button", { name: "Accept invitation" }).click();
    await expect(admin.getByText(`You have joined ${orgName}.`)).toBeVisible();

    await signIn(admin, { email: adminEmail, password });
    const checklist = admin.getByRole("region", { name: `Set up ${orgName}` }).or(admin.getByText(`Set up ${orgName}`));
    await expect(checklist.first()).toBeVisible();
    await expect(admin.getByText("0 of 7 steps done.", { exact: false })).toBeVisible();

    // An org admin completes the steps their role owns (here: frameworks in scope); risks etc. need the roles they invite.
    const frameworks = await api<Array<{ id: string; key: string }>>(admin, "GET", "/frameworks");
    await api(admin, "PUT", "/frameworks/scope", { frameworkIds: frameworks.filter((f) => f.key === "iso-27001").map((f) => f.id) });
    await admin.reload();
    await expect(admin.getByText("1 of 7 steps done.", { exact: false })).toBeVisible();

    await admin.getByRole("button", { name: "Hide setup checklist" }).click();
    await expect(admin.getByText(`Set up ${orgName}`)).toHaveCount(0);
    await admin.reload();
    await expect(admin.getByRole("heading", { name: "Executive dashboard" })).toBeVisible();
    await expect(admin.getByText(`Set up ${orgName}`)).toHaveCount(0);
    await admin.close();
  });
});
