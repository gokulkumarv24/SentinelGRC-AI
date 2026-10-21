import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIdempotencyKey } from "./use-idempotency-key";

describe("useIdempotencyKey", () => {
  it("reuses one key per unchanged action and starts a new one when the payload changes or the action succeeds", () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.keyFor({ reportType: "risk_register", format: "csv" });
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(result.current.keyFor({ reportType: "risk_register", format: "csv" })).toBe(first);
    const changed = result.current.keyFor({ reportType: "risk_register", format: "pdf" });
    expect(changed).not.toBe(first);
    result.current.reset();
    expect(result.current.keyFor({ reportType: "risk_register", format: "pdf" })).not.toBe(changed);
  });
});
