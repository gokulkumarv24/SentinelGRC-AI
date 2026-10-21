import type { Permission } from '../../permissions/catalog.js';

export type Cell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  /** Relative width hint for PDF layout. */
  width?: number;
}

export interface ReportSection {
  heading: string;
  description?: string;
  columns: ReportColumn[];
  rows: Array<Record<string, Cell>>;
  /** Set when the row limit cut the section short; always stated in the output. */
  truncatedAt?: number;
}

export interface ReportMetric {
  label: string;
  value: Cell;
  definition: string;
}

/** Renderer-independent report content. Every number comes from the database at generation time. */
export interface ReportModel {
  scope: string;
  metrics: ReportMetric[];
  sections: ReportSection[];
  definitions: string[];
  exclusions: string[];
  /** Traceability appendix: the records the report's material content was derived from. */
  sources: Array<{ type: string; id: string; label: string }>;
  /** When set, the report can only be issued as Draft, for the stated reason. */
  draftOnlyReason?: string;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  frameworkId?: string;
  vendorId?: string;
  assessmentId?: string;
  aiSystemId?: string;
}

export type FilterKey = keyof ReportFilters;

export interface ReportTypeDef {
  key: string;
  title: string;
  description: string;
  /** Read permissions over the underlying data, checked for the requester and re-checked at generation. */
  requires: Permission[];
  filters: FilterKey[];
  requiredFilters?: FilterKey[];
  /** Period-based reports default to the last 30 days. */
  periodic?: boolean;
}

export const MAX_ROWS = 5000;
