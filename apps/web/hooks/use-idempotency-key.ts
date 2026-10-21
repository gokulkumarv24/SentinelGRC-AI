"use client";

import { useCallback, useRef } from "react";
import { newIdempotencyKey } from "@/lib/api";

/**
 * One Idempotency-Key per user action: the same key is sent while the payload is unchanged and the
 * action has not succeeded, so a double-submit or a retried request is executed by the API only once.
 * Changing the payload starts a new action with a new key.
 */
export function useIdempotencyKey() {
  const state = useRef<{ key: string; payload: string } | null>(null);
  const keyFor = useCallback((payload: unknown) => {
    const serialized = JSON.stringify(payload ?? null);
    if (!state.current || state.current.payload !== serialized) state.current = { key: newIdempotencyKey(), payload: serialized };
    return state.current.key;
  }, []);
  const reset = useCallback(() => {
    state.current = null;
  }, []);
  return { keyFor, reset };
}
