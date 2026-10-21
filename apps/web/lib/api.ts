/**
 * Browser API client. Requests go to same-origin /api/v1 (proxied to the API), carry the
 * session cookie automatically, and send the CSRF token on state-changing requests.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Field-level messages from 422 responses, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    const fields = (this.details?.fields ?? []) as Array<{ path: string; message: string }>;
    return Object.fromEntries(fields.map((f) => [f.path, f.message]));
  }
}

const BASE = "/api/v1";

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)(?:__Host-)?sg_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

export function toQueryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    ...init,
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    const apiError = new ApiError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, err?.details, (data as ApiErrorBody | undefined)?.requestId);
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // Full reload on purpose: an expired session must drop all cached tenant data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?expired=1&next=${next}`);
    }
    throw apiError;
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", `${path}${toQueryString(query)}`),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
