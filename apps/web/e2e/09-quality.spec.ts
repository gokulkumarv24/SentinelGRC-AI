import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { signIn } from "./helpers";

const PAGES = ["/dashboard", "/controls", "/evidence", "/risks", "/findings", "/remediation", "/vendors", "/ai-governance", "/reports", "/workflows/runs", "/audit-log", "/settings/members"];
const axePath = createRequire(__filename).resolve("axe-core/axe.min.js");

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  // Wait for data, not "network idle" (streamed responses and prefetches make that unreliable).
  await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(500);
}

test.describe("Accessibility, responsive layout and search", () => {
  test("main pages have no serious or critical WCAG 2 A/AA violations", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, "grc");
    const problems: string[] = [];
    for (const path of PAGES) {
      await open(page, path);
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
        const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
        return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      });
      problems.push(...violations.map((v) => `${path}: ${v}`));
    }
    expect(problems).toEqual([]);
  });

  for (const viewport of [{ name: "a phone", width: 390, height: 844 }, { name: "a 1440px desktop", width: 1440, height: 900 }]) {
    test(`pages fit ${viewport.name} without horizontal page scrolling`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, "grc");
      const overflowing: string[] = [];
      for (const path of PAGES) {
        await open(page, path);
        const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
        if (scroll > width + 1) overflowing.push(`${path}: ${scroll}px wide in a ${width}px viewport`);
      }
      expect(overflowing).toEqual([]);
    });
  }

  test("global search finds this organization's records and nothing from others", async ({ page, browser }) => {
    await signIn(page, "grc");
    await page.getByRole("button", { name: /Search…/ }).click();
    await page.getByPlaceholder("Search records…").fill("Cloudbase");
    await expect(page.getByRole("option", { name: /Cloudbase Hosting \(fictional\)/ }).first()).toBeVisible();

    const other = await browser.newPage();
    await signIn(other, "harbor");
    await other.getByRole("button", { name: /Search…/ }).click();
    await other.getByPlaceholder("Search records…").fill("Cloudbase");
    await expect(other.getByText(/No (matching )?(records|results)/i)).toBeVisible();
    await expect(other.getByRole("option", { name: /Cloudbase/ })).toHaveCount(0);
    await other.close();
  });
});
