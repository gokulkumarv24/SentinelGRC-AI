import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Regenerates the README screenshots from the fictional demo data. Not part of the normal suite:
//   SCREENSHOTS=1 npx playwright test e2e/readme-screenshots.spec.ts   (after npm run test:e2e:prepare)
test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to regenerate docs/screenshots");
test.use({ viewport: { width: 1440, height: 900 } });

const OUT = "../../docs/screenshots";

async function settle(page: Page) {
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1200); // let charts finish their entry animation
}

test("README screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await expect(page.getByRole("img", { name: "SentinelGRC AI" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/login.png` });

  await signIn(page, "grc");
  await settle(page);
  await page.screenshot({ path: `${OUT}/dashboard.png` });

  for (const [name, path] of [["findings", "/findings"], ["vendors", "/vendors"], ["risks", "/risks"]] as const) {
    await page.goto(path);
    await settle(page);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }

  await page.goto("/evidence");
  await settle(page);
  await page.getByRole("link", { name: /Information Security Policy v4/ }).first().click();
  await settle(page);
  const draft = page.getByRole("button", { name: /Draft with AI|Draft again/ }).first();
  await draft.click();
  await page.getByText(/AI draft —/).first().waitFor();
  // Wait for the "Draft ready" toast to appear and then disappear so it does not cover the page.
  await page.locator("[data-sonner-toast]").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForSelector("[data-sonner-toast]", { state: "detached", timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.getByRole("region", { name: "Evidence summary" }).scrollIntoViewIfNeeded().catch(() => undefined);
  await page.screenshot({ path: `${OUT}/evidence-ai-draft.png` });
});
