import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { CREDENTIALS_FILE } from "./e2e-env.mjs";

export const USERS = {
  admin: "admin@northstar-demo.example",
  grc: "grc.manager@northstar-demo.example",
  ciso: "ciso@northstar-demo.example",
  analyst: "analyst@northstar-demo.example",
  owner: "risk.owner@northstar-demo.example",
  vm: "vendor.manager@northstar-demo.example",
  ai: "ai.officer@northstar-demo.example",
  auditor: "auditor@northstar-demo.example",
  contributor: "contributor@northstar-demo.example",
  harbor: "ops.lead@harbor-logistics-demo.example",
  platform: "platform.admin@sentinelgrc-demo.example",
} as const;
export type UserKey = keyof typeof USERS;

let passwords: Map<string, string> | undefined;
/** Passwords written by the seed (`e2e/prepare.mjs`) for this throwaway E2E database. */
function passwordFor(email: string) {
  passwords ??= new Map(
    readFileSync(CREDENTIALS_FILE, "utf8")
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p[0]?.includes("@") && p[1] && !p[1].startsWith("(")) as Array<[string, string]>,
  );
  const pw = passwords.get(email);
  if (!pw) throw new Error(`No E2E password for ${email}; run npm run test:e2e:prepare -w apps/web`);
  return pw;
}

export async function signIn(page: Page, user: UserKey | { email: string; password: string }, options: { expectDashboard?: boolean } = {}) {
  const email = typeof user === "string" ? USERS[user] : user.email;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(typeof user === "string" ? passwordFor(email) : user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  if (options.expectDashboard !== false) await expect(page.getByRole("heading", { name: "Executive dashboard" })).toBeVisible();
}

/** Calls the API with the page's session (cookie + CSRF header), for setup steps that are not under test. */
export async function api<T = Record<string, unknown>>(page: Page, method: "GET" | "POST" | "PUT" | "PATCH", path: string, data?: unknown): Promise<T> {
  const csrf = (await page.context().cookies()).find((c) => c.name === "sg_csrf")?.value ?? "";
  const res = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin } });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** Fills the rationale in an open confirmation dialog and confirms it. */
export async function confirmWith(page: Page, button: string, rationale?: string) {
  const dialog = page.getByRole("dialog");
  if (rationale) await dialog.getByRole("textbox").last().fill(rationale);
  await dialog.getByRole("button", { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

export const uniq = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;

/** A minimal valid PDF for upload tests. */
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
