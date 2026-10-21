"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDirectory } from "@/hooks/use-me";

/** Owner / assignee picker limited to active members of the organization. */
export function UserSelect({ id, value, onChange, placeholder = "Unassigned", allowEmpty = true, disabled }: { id?: string; value: string | null | undefined; onChange: (value: string | null) => void; placeholder?: string; allowEmpty?: boolean; disabled?: boolean }) {
  const { data, isPending } = useDirectory();
  return (
    <Select value={value ?? "__none"} onValueChange={(v) => onChange(v === "__none" ? null : v)} disabled={disabled || isPending}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value="__none">{placeholder}</SelectItem>}
        {data?.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.displayName} <span className="text-muted-foreground">({u.email})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
