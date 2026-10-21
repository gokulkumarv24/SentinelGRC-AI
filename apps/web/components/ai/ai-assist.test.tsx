import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DraftView, type AiArtifact } from "./ai-assist";

let permissions = new Set<string>();
vi.mock("@/hooks/use-me", () => ({ useCan: () => (p: string) => permissions.has(p) }));

const base: AiArtifact = {
  id: "a1",
  artifactType: "evidence_summary",
  status: "draft",
  schemaValid: true,
  decision: "pending",
  provider: "mock",
  model: "deterministic-extractive-v1",
  promptVersion: "evidence_summary:v1",
  output: {
    summary: "The policy requires MFA for administrators.",
    points: [{ text: "Administrators must use MFA.", sourceRefs: [{ sourceId: "S1", locator: "page 2" }] }],
    suggestions: [],
    limitations: ["Redacted before processing: 1 email."],
    confidence: "low",
  },
  errorCode: null,
  validationErrors: null,
  limitations: null,
  sourceRecords: [{ ref: "S1", type: "evidence", label: "Access Policy" }],
  createdAt: new Date().toISOString(),
  reviewedAt: null,
};

function renderDraft(artifact: AiArtifact) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DraftView artifact={artifact} />
    </QueryClientProvider>,
  );
}

describe("DraftView", () => {
  it("always labels the content as an unreviewed AI draft with its sources and limitations", () => {
    permissions = new Set();
    renderDraft(base);
    expect(screen.getByText(/AI draft — not reviewed/)).toBeInTheDocument();
    expect(screen.getByText("Source: Access Policy · page 2")).toBeInTheDocument();
    expect(screen.getByText("Redacted before processing: 1 email.")).toBeInTheDocument();
    expect(screen.getByText(/mock\/deterministic-extractive-v1/)).toBeInTheDocument();
    // Without assistant.review there is nothing to accept.
    expect(screen.queryByRole("button", { name: /Accept draft/ })).not.toBeInTheDocument();
  });

  it("offers review actions only to reviewers", () => {
    permissions = new Set(["assistant.review"]);
    renderDraft(base);
    expect(screen.getByRole("button", { name: /Accept draft/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeInTheDocument();
  });

  it("fails safely: shows why, and that nothing was changed", () => {
    permissions = new Set(["assistant.review"]);
    renderDraft({ ...base, status: "failed", schemaValid: false, output: null, errorCode: "invalid_output", validationErrors: ['Cites unknown source "S9"'] });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be produced (invalid_output)");
    expect(screen.getByText('Cites unknown source "S9"')).toBeInTheDocument();
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Accept draft/ })).not.toBeInTheDocument();
  });
});
