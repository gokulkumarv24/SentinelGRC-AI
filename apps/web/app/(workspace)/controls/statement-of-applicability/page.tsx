"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatusBadge } from "@/components/common/badges";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, QueryState } from "@/components/common/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";

interface SoaRow {
  controlId: string;
  controlCode: string;
  title: string;
  included: boolean;
  justification: string | null;
  implementationStatus: string;
  isoReferences: Array<{ code: string; reviewStatus: string }>;
}

/** ISO/IEC 27001 Statement of Applicability working view. Supports the management system; it is not a certification. */
export default function SoaPage() {
  const query = useQuery({ queryKey: ["controls", "soa"], queryFn: () => api.get<SoaRow[]>("/controls/statement-of-applicability") });
  return (
    <>
      <PageHeader
        title="Statement of Applicability"
        description="Each control's inclusion, justification for exclusion, implementation status and mapped ISO/IEC 27001 references. Review with your ISMS owner; this view does not establish certification."
        crumbs={[{ label: "Controls", href: "/controls" }, { label: "Statement of Applicability" }]}
      />
      <QueryState query={query} empty={(rows) => (rows.length === 0 ? <EmptyState title="No controls" description="Add controls to build the Statement of Applicability." /> : null)}>
        {(rows) => (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <caption className="sr-only">Statement of Applicability</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Control</TableHead>
                  <TableHead>Included</TableHead>
                  <TableHead>Justification</TableHead>
                  <TableHead>Implementation</TableHead>
                  <TableHead>ISO/IEC 27001 references</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.controlId}>
                    <TableCell>
                      <Link href={`/controls/${r.controlId}`} className="text-primary hover:underline">
                        <span className="font-mono text-xs">{r.controlCode}</span> · {r.title}
                      </Link>
                    </TableCell>
                    <TableCell>{r.included ? <StatusBadge status="approved" label="Included" /> : <StatusBadge status="not_applicable" label="Excluded" />}</TableCell>
                    <TableCell className="max-w-sm text-xs whitespace-normal">{r.justification ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.implementationStatus} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.isoReferences.length === 0
                        ? "—"
                        : r.isoReferences.map((ref) => (
                            <span key={ref.code} className="mr-2 inline-flex items-center gap-1">
                              <span className="font-mono">{ref.code}</span>
                              {ref.reviewStatus !== "approved" && <span className="text-muted-foreground">({ref.reviewStatus})</span>}
                            </span>
                          ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
    </>
  );
}
