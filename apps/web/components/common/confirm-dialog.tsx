"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";

/**
 * Confirmation for consequential actions (spec §14.3). When `requireRationale` is set,
 * the user must write a reason, which is sent to the API and recorded in the audit trail.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  requireRationale,
  rationaleLabel = "Rationale",
  onConfirm,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requireRationale?: boolean;
  rationaleLabel?: string;
  onConfirm: (rationale: string) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(rationale.trim());
      setOpen(false);
      setRationale("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {requireRationale && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-rationale">{rationaleLabel}</Label>
            <Textarea id="confirm-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} rows={4} maxLength={5000} aria-required />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={submit} disabled={pending || (requireRationale && !rationale.trim())}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
