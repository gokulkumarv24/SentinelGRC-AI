import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { ConfirmDialog } from "./confirm-dialog";

function renderDialog(onConfirm: (r: string) => Promise<unknown>) {
  render(<ConfirmDialog trigger={<button>Approve request</button>} title="Approve risk acceptance" requireRationale confirmLabel="Approve" onConfirm={onConfirm} />);
}

describe("ConfirmDialog", () => {
  it("cannot be confirmed until a rationale is written, and sends it trimmed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderDialog(onConfirm);
    await user.click(screen.getByRole("button", { name: "Approve request" }));
    const confirm = screen.getByRole("button", { name: "Approve" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Rationale"), "   ");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Rationale"), "Residual risk is low  ");
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("Residual risk is low");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open and shows the API's message when the action is refused", async () => {
    const user = userEvent.setup();
    renderDialog(() => Promise.reject(new ApiError(403, "separation_of_duties", "Approval must come from someone other than the requester.")));
    await user.click(screen.getByRole("button", { name: "Approve request" }));
    await user.type(screen.getByLabelText("Rationale"), "Looks fine");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Approval must come from someone other than the requester.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
