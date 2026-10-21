import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { LoginForm } from "./login-form";

// A plain stub rather than vi.fn(): a reset vi.fn() reports its async rejections as unhandled even when the form catches them.
let respond: () => Promise<unknown> = () => Promise.resolve();
let calls: unknown[][] = [];
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  api: {
    post: (...args: unknown[]) => {
      calls.push(args);
      return respond();
    },
  },
}));

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  render(<LoginForm />);
  if (email) await user.type(screen.getByLabelText("Email"), email);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm", () => {
  beforeEach(() => {
    calls = [];
    respond = () => Promise.resolve();
  });

  it("validates before calling the API", async () => {
    await submit("", "");
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("shows the API's generic message for wrong credentials", async () => {
    respond = async () => {
      throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
    };
    await submit("someone@example.test", "wrong-password-1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(calls).toEqual([["/auth/login", { email: "someone@example.test", password: "wrong-password-1" }]]);
  });

  it("explains rate limiting without leaking details", async () => {
    respond = async () => {
      throw new ApiError(429, "rate_limited", "Too many requests.");
    };
    await submit("someone@example.test", "x");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Please wait a minute and try again.");
  });
});
