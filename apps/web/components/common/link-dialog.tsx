"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecordPicker, type PickerOption } from "./record-picker";

/** Pick a record and (optionally) add a note, then link it. */
export function LinkDialog<T>({
  trigger,
  title,
  description,
  endpoint,
  toOption,
  extraQuery,
  noteLabel,
  children,
  onLink,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  endpoint: string;
  toOption: (row: T) => PickerOption;
  extraQuery?: Record<string, string>;
  noteLabel?: string;
  children?: ReactNode;
  onLink: (option: PickerOption, note: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PickerOption | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!value) return;
    setPending(true);
    try {
      await onLink(value, note);
      setOpen(false);
      setValue(null);
      setNote("");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="link-picker">Record</Label>
            <RecordPicker id="link-picker" endpoint={endpoint} toOption={toOption} value={value} onChange={setValue} extraQuery={extraQuery} />
          </div>
          {children}
          {noteLabel && (
            <div className="space-y-1.5">
              <Label htmlFor="link-note">{noteLabel}</Label>
              <Textarea id="link-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!value || pending}>
            {pending ? "Linking…" : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
