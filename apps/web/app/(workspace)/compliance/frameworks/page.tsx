"use client";

import { useQuery } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { IllustrativeBadge, StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { FrameworkRow } from "@/lib/types";


interface Preview {
  valid: boolean;
  issues: Array<{ level: "error" | "warning"; code: string; message: string }>;
  framework: { key: string; name: string; version: string; publisher: string };
  requirements: number;
  affectedMappings: number;
}

function ImportDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const parse = () => {
    try {
      return JSON.parse(text);
    } catch {
      setParseError("The manifest is not valid JSON.");
      return null;
    }
  };
  const check = useApiMutation({ mutationFn: (body: unknown) => api.post<Preview>("/frameworks/import-preview", body), onSuccess: setPreview });
  const run = useApiMutation({
    mutationFn: (body: unknown) => api.post("/frameworks/import", body),
    success: "Framework imported",
    invalidate: [["frameworks"]],
    onSuccess: () => {
      setOpen(false);
      setText("");
      setPreview(null);
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FileUp aria-hidden /> Import framework
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a framework version</DialogTitle>
          <DialogDescription>Paste a manifest in the framework-data format. Only import content you are licensed to store. Versions are immutable; a changed framework is imported as a new version.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="manifest">Manifest JSON</Label>
          <Textarea
            id="manifest"
            rows={10}
            className="font-mono text-xs"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
              setParseError(null);
            }}
          />
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Load manifest file"
            className="text-xs"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
              setPreview(null);
            }}
          />
          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        </div>
        {preview && (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">
              {preview.valid ? "Ready to import" : "Cannot import"}: {preview.framework.name} {preview.framework.version} · {preview.requirements} requirements
            </p>
            {preview.affectedMappings > 0 && <p className="text-xs">{preview.affectedMappings} existing mappings will be flagged for review.</p>}
            <ul className="space-y-1 text-xs">
              {preview.issues.map((i, n) => (
                <li key={n} className={i.level === "error" ? "text-destructive" : "text-warn"}>
                  {i.level === "error" ? "Error" : "Warning"}: {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { const b = parse(); if (b) check.mutate(b); }} disabled={!text || check.isPending}>
            Validate
          </Button>
          <Button onClick={() => { const b = parse(); if (b) run.mutate(b); }} disabled={!preview?.valid || run.isPending}>
            {run.isPending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FrameworksPage() {
  const can = useCan();
  const query = useQuery({ queryKey: ["frameworks"], queryFn: () => api.get<FrameworkRow[]>("/frameworks") });
  return (
    <>
      <PageHeader
        title="Framework registry"
        description="Versioned frameworks with source, retrieval date and license notes. Copyrighted standards store identifiers and internal summaries only."
        crumbs={[{ label: "Compliance" }, { label: "Frameworks" }]}
        actions={
          <>
            {can("framework.manage") && (
              <Button variant="outline" asChild>
                <Link href="/settings/frameworks">Choose frameworks in scope</Link>
              </Button>
            )}
            {can("framework.manage") && <ImportDialog />}
          </>
        }
      />
      <QueryState query={query} empty={(rows) => (rows.length === 0 ? <EmptyState title="No frameworks" description="Run the reference-data sync or import a framework manifest." /> : null)}>
        {(rows) => (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((f) => (
              <Link key={f.id} href={`/compliance/frameworks/${f.id}`} className="block cursor-pointer rounded-lg border bg-card p-4 transition-colors hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{f.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.publisher} · version {f.version}
                    </p>
                  </div>
                  {f.inScope ? <StatusBadge status="active" label="In scope" /> : <StatusBadge status="unreviewed" label="Not in scope" />}
                </div>
                {f.description && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{f.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{f.requirementCount} requirements</span>
                  <span>· {f.scope === "platform" ? "Platform reference" : "Organization-specific"}</span>
                  {f.retrievedAt && (
                    <span>
                      · retrieved <DateText value={f.retrievedAt} />
                    </span>
                  )}
                  {f.isIllustrative && <IllustrativeBadge />}
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </>
  );
}
