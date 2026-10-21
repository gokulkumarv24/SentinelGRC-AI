"use client";

import { Download, FileUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader, Section } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";

interface PreviewRow {
  row: number;
  controlCode: string;
  action: "create" | "update" | "skip";
  errors: string[];
  warnings: string[];
  mappings: number;
}
interface Preview {
  summary: { rows: number; create: number; update: number; skip: number; errors: number; warnings: number };
  rows: PreviewRow[];
}

const TEMPLATE = "controlCode,title,description,category,reviewFrequencyDays,ownerEmail,requirements\nAC-01,Quarterly access reviews,Access to in-scope systems is reviewed quarterly,Access Control,90,,nist-csf:PR.AA-05; iso-27001:A.5.18\n";

export default function ImportControlsPage() {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<"create_only" | "upsert">("create_only");
  const [preview, setPreview] = useState<Preview | null>(null);
  const check = useApiMutation({ mutationFn: () => api.post<Preview>("/controls/import-preview", { csv, mode }), onSuccess: setPreview });
  const run = useApiMutation({
    mutationFn: () => api.post<{ created: number; updated: number; mappings: number; skipped: number }>("/controls/import", { csv, mode }),
    success: (r) => `Imported: ${r.created} created, ${r.updated} updated, ${r.mappings} mappings proposed`,
    invalidate: [["controls"], ["mappings"]],
    onSuccess: () => setPreview(null),
  });

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Bulk control import"
        description="Upload a CSV, review the validation report, then import. Requirement references create mappings that still need review."
        crumbs={[{ label: "Controls", href: "/controls" }, { label: "Import" }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="controls-template.csv">
                <Download aria-hidden /> Template
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/v1/controls/export.csv">
                <Download aria-hidden /> Export current controls
              </a>
            </Button>
          </>
        }
      />
      <Section title="1. Choose file">
        <div className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setPreview(null);
              if (!f) return;
              if (f.size > 1_000_000) {
                setFileName(null);
                setCsv("");
                return;
              }
              setFileName(f.name);
              setCsv(await f.text());
            }}
          />
          {fileName && <p className="text-xs text-muted-foreground">{fileName} loaded.</p>}
          <RadioGroup value={mode} onValueChange={(v) => { setMode(v as "create_only" | "upsert"); setPreview(null); }} className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem id="m1" value="create_only" />
              <Label htmlFor="m1">Create new only (skip existing codes)</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="m2" value="upsert" />
              <Label htmlFor="m2">Create and update existing</Label>
            </div>
          </RadioGroup>
          <Button onClick={() => check.mutate()} disabled={!csv || check.isPending}>
            <FileUp aria-hidden /> {check.isPending ? "Validating…" : "Validate file"}
          </Button>
        </div>
      </Section>
      {preview && (
        <div className="mt-4">
          <Section title="2. Validation report" description={`${preview.summary.rows} rows · ${preview.summary.create} to create · ${preview.summary.update} to update · ${preview.summary.skip} skipped · ${preview.summary.errors} with errors · ${preview.summary.warnings} warnings`}>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Import validation report</caption>
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Row</th>
                    <th className="py-1.5 pr-3 font-medium">Control</th>
                    <th className="py-1.5 pr-3 font-medium">Action</th>
                    <th className="py-1.5 pr-3 font-medium">Mappings</th>
                    <th className="py-1.5 font-medium">Messages</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.rows.map((r) => (
                    <tr key={r.row} className="align-top">
                      <td className="py-1.5 pr-3 tabular-nums">{r.row}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{r.controlCode || "—"}</td>
                      <td className="py-1.5 pr-3">{r.errors.length ? <span className="text-destructive">error</span> : r.action}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{r.mappings}</td>
                      <td className="py-1.5 text-xs">
                        {r.errors.map((e) => (
                          <p key={e} className="text-destructive">{e}</p>
                        ))}
                        {r.warnings.map((w) => (
                          <p key={w} className="text-warn">{w}</p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => run.mutate()} disabled={preview.summary.errors > 0 || run.isPending}>
                {run.isPending ? "Importing…" : "3. Import"}
              </Button>
              {preview.summary.errors > 0 && <p className="self-center text-sm text-destructive">Fix the rows with errors and validate again.</p>}
            </div>
          </Section>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Columns: controlCode, title, description, category, reviewFrequencyDays, ownerEmail, requirements (framework-key:CODE separated by semicolons). Max 2,000 rows / 1 MB. <Link href="/compliance/frameworks" className="text-primary hover:underline">Framework keys</Link>
      </p>
    </div>
  );
}
