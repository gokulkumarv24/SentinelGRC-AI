"use client";

import { AlertTriangle, Inbox, Lock, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api";

/** Spec §14.3: every page has loading, empty, error (with retry) and permission-denied states. */

export function LoadingState({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: ReactNode; icon?: typeof Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ForbiddenState({ message = "You don't have permission to view this." }: { message?: string }) {
  return <EmptyState icon={Lock} title="Access restricted" description={`${message} Ask an organization administrator if you need access.`} />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) return <ForbiddenState message={error.message} />;
  if (error instanceof ApiError && error.status === 404) return <EmptyState title="Not found" description="This record does not exist or you do not have access to it." />;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <p className="font-medium">Something went wrong</p>
      <p className="max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      {error instanceof ApiError && error.requestId && <p className="font-mono text-xs text-muted-foreground">Request ID: {error.requestId}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          <RotateCw aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

/** Renders the right state for a react-query result, or children when data is ready. */
export function QueryState<T>({
  query,
  children,
  rows,
  empty,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  children: (data: T) => ReactNode;
  rows?: number;
  empty?: (data: T) => ReactNode | null;
}) {
  if (query.isPending) return <LoadingState rows={rows} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data as T;
  const emptyNode = empty?.(data);
  return <>{emptyNode ?? children(data)}</>;
}
