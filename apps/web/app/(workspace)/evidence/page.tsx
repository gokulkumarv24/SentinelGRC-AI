"use client";

import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Suspense } from "react";
import { StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { EvidenceUploadDialog } from "@/components/evidence/upload-dialog";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { Evidence, Page } from "@/lib/types";

const columns: Column<Evidence>[] = [
  { id: "title", header: "Evidence", sortKey: "title", cell: (e) => e.title },
  { id: "file", header: "File", cell: (e) => (e.hasFile ? <span className="text-xs">{e.originalFilename} · {formatBytes(e.sizeBytes)}</span> : <span className="text-xs text-muted-foreground">Metadata only</span>), hideOnMobile: true },
  { id: "class", header: "Classification", cell: (e) => <span className="capitalize">{e.classification}</span>, hideOnMobile: true },
  { id: "review", header: "Review", cell: (e) => <StatusBadge status={e.reviewStatus} /> },
  { id: "state", header: "Currency", cell: (e) => <StatusBadge status={e.state} /> },
  { id: "expires", header: "Expires", sortKey: "expiresAt", cell: (e) => <DateText value={e.expiresAt} /> },
  { id: "links", header: "Links", cell: (e) => e._count?.links ?? 0, hideOnMobile: true },
  { id: "created", header: "Added", sortKey: "createdAt", cell: (e) => <DateText value={e.createdAt} />, hideOnMobile: true },
];

function EvidenceLibrary() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["evidence", params], queryFn: () => api.get<Page<Evidence>>("/evidence", params) });
  const action = can("evidence.upload") && <EvidenceUploadDialog trigger={<Button><Upload aria-hidden /> Add evidence</Button>} />;
  return (
    <>
      <PageHeader title="Evidence library" description="Evidence files and records with checksums, validity dates and review status. Files are stored privately and downloaded only through short-lived links." crumbs={[{ label: "Compliance" }, { label: "Evidence" }]} actions={action} />
      <FilterBar
        params={params}
        setParams={setParams}
        searchPlaceholder="Search title, description or filename"
        filters={[
          { key: "state", label: "Currency", options: options(["expired", "expiring", "current", "no_expiry"]) },
          { key: "reviewStatus", label: "Review", options: options(["unreviewed", "pending_review", "approved", "rejected"]) },
          { key: "classification", label: "Classification", options: options(["public", "internal", "confidential", "restricted"]) },
        ]}
      />
      <DataTable caption="Evidence" columns={columns} query={query} params={params} setParams={setParams} rowKey={(e) => e.id} rowHref={(e) => `/evidence/${e.id}`} empty={{ title: "No evidence yet", description: "Upload policies, screenshots, exports and reports that support your controls.", action }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <EvidenceLibrary />
    </Suspense>
  );
}
