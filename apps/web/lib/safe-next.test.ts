import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext (post-login redirect)", () => {
  it("keeps same-site relative paths", () => {
    expect(safeNext("/findings?status=open")).toBe("/findings?status=open");
  });

  it.each([null, "", "https://evil.example", "//evil.example/path", "/\\evil.example", "javascript:alert(1)", "dashboard"])("falls back to the dashboard for %j", (next) => {
    expect(safeNext(next)).toBe("/dashboard");
  });
});
