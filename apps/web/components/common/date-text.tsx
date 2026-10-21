"use client";

import { format, formatDistanceToNowStrict, isPast } from "date-fns";
import { cn } from "@/lib/utils";

/** Stored in UTC, shown in the viewer's local time with the exact UTC value on hover (spec §3.4). */
export function DateText({ value, withTime = false, relative = false, className }: { value: string | Date | null | undefined; withTime?: boolean; relative?: boolean; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const date = typeof value === "string" ? new Date(value) : value;
  const text = relative ? formatDistanceToNowStrict(date, { addSuffix: true }) : format(date, withTime ? "d MMM yyyy, HH:mm" : "d MMM yyyy");
  return (
    <time dateTime={date.toISOString()} title={`${date.toISOString().replace("T", " ").slice(0, 19)} UTC`} className={className}>
      {text}
    </time>
  );
}

/** Due-date display that flags overdue items with text, not only colour. */
export function DueDate({ value, done }: { value: string | null | undefined; done?: boolean }) {
  if (!value) return <span className="text-muted-foreground">No due date</span>;
  const overdue = !done && isPast(new Date(value));
  return (
    <span className={cn(overdue && "font-medium text-sev-critical")}>
      <DateText value={value} />
      {overdue && <span className="ml-1 text-xs">(overdue)</span>}
    </span>
  );
}
