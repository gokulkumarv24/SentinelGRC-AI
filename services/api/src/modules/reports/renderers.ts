import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { safeCell } from '../../common/csv.js';
import type { Cell, ReportModel, ReportSection } from './report-model.js';

export interface ReportHeader {
  organization: string;
  title: string;
  status: 'draft' | 'final';
  generatedAt: Date;
  timezone: string;
  creator: string;
  filters: string;
  period: string | null;
  reportId: string;
}

export const DISCLAIMER =
  'Generated from SentinelGRC records at the time shown. This report is not an audit opinion, certification, legal determination or formal attestation.';

export function formatTimestamp(d: Date, timezone: string): string {
  const text = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'long', hour12: false }).format(d);
  return `${text} (${timezone})`;
}

function headerLines(h: ReportHeader, m: ReportModel): Array<[string, string]> {
  return [
    ['Organization', h.organization],
    ['Report', h.title],
    ['Status', h.status === 'final' ? 'Final' : `Draft${m.draftOnlyReason ? ` — ${m.draftOnlyReason}` : ''}`],
    ['Generated', formatTimestamp(h.generatedAt, h.timezone)],
    ['Created by', h.creator],
    ['Reporting period', h.period ?? 'Point in time (generation time)'],
    ['Filters', h.filters || 'None'],
    ['Data scope', m.scope],
    ['Report ID', h.reportId],
  ];
}

const text = (v: Cell) => (v === null || v === undefined ? '' : String(v));

export function renderCsv(h: ReportHeader, m: ReportModel): Buffer {
  const lines: string[] = [];
  const row = (...cells: unknown[]) => lines.push(cells.map(safeCell).join(','));
  for (const [k, v] of headerLines(h, m)) row(k, v);
  row('Notice', DISCLAIMER);
  lines.push('');
  row('Metric', 'Value', 'Definition');
  for (const metric of m.metrics) row(metric.label, metric.value, metric.definition);
  for (const s of m.sections) {
    lines.push('');
    row(`Section: ${s.heading}`);
    if (s.description) row(s.description);
    row(...s.columns.map((c) => c.label));
    for (const r of s.rows) row(...s.columns.map((c) => r[c.key]));
    if (s.truncatedAt) row(`Truncated at ${s.truncatedAt} rows`);
  }
  lines.push('');
  for (const d of m.definitions) row('Definition', d);
  for (const e of m.exclusions) row('Excluded', e);
  if (m.sources.length) {
    lines.push('');
    row('Source type', 'Source ID', 'Label');
    for (const s of m.sources) row(s.type, s.id, s.label);
  }
  // UTF-8 BOM so spreadsheet tools detect the encoding.
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

export async function renderXlsx(h: ReportHeader, m: ReportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SentinelGRC';
  wb.created = h.generatedAt;
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 28 }, { width: 70 }, { width: 70 }];
  for (const [k, v] of headerLines(h, m)) summary.addRow([k, v]).getCell(1).font = { bold: true };
  summary.addRow(['Notice', DISCLAIMER]);
  summary.addRow([]);
  summary.addRow(['Metric', 'Value', 'Definition']).font = { bold: true };
  for (const metric of m.metrics) summary.addRow([metric.label, metric.value, metric.definition]);
  summary.addRow([]);
  for (const d of m.definitions) summary.addRow(['Definition', d]);
  for (const e of m.exclusions) summary.addRow(['Excluded', e]);

  const used = new Set(['Summary', 'Sources']);
  for (const s of m.sections) {
    let name = s.heading.replace(/[[\]:*?/\\]/g, ' ').slice(0, 28).trim() || 'Section';
    for (let i = 2; used.has(name); i++) name = `${name.slice(0, 25)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.columns = s.columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(60, Math.max(12, Math.round((c.width ?? 1) * 18))) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    // Values are written as plain strings/numbers, never as formulas.
    for (const r of s.rows) ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, r[c.key] ?? null])));
    if (s.truncatedAt) ws.addRow([`Truncated at ${s.truncatedAt} rows`]);
  }
  const sources = wb.addWorksheet('Sources');
  sources.columns = [{ header: 'Type', key: 'type', width: 20 }, { header: 'ID', key: 'id', width: 40 }, { header: 'Label', key: 'label', width: 50 }];
  sources.getRow(1).font = { bold: true };
  for (const s of m.sources) sources.addRow(s);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Standard PDF fonts cover Windows-1252 only; anything else is replaced rather than rendered as garbage. */
const OUTSIDE_CP1252 = /[^\n\x20-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/gu;
function pdfSafe(value: string): string {
  return value.replace(OUTSIDE_CP1252, (ch) => (ch === '≥' ? '>=' : ch === '≤' ? '<=' : '?'));
}

export function renderPdf(h: ReportHeader, m: ReportModel): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 40, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: h.title, Author: 'SentinelGRC', Subject: h.organization } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (needed: number) => {
    if (doc.y + needed > bottom()) doc.addPage();
  };
  const t = (s: Cell) => pdfSafe(text(s));

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text(t(h.title), left, doc.y);
  doc.font('Helvetica').fontSize(10).fillColor('#475569').text(t(h.organization));
  doc.moveDown(0.5);
  for (const [k, v] of headerLines(h, m).slice(2)) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`${k}: `, { continued: true }).font('Helvetica').text(t(v));
  }
  doc.moveDown(0.5).fontSize(8).fillColor('#475569').text(DISCLAIMER);
  doc.moveDown();

  if (m.metrics.length) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Key metrics');
    doc.moveDown(0.3);
    drawTable(doc, { heading: '', columns: [{ key: 'label', label: 'Metric', width: 2 }, { key: 'value', label: 'Value', width: 1.5 }, { key: 'definition', label: 'Definition', width: 4 }], rows: m.metrics.map((x) => ({ label: x.label, value: x.value, definition: x.definition })) }, left, width, bottom, t);
    doc.moveDown();
  }
  for (const s of m.sections) {
    ensure(60);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text(t(s.heading), left, doc.y);
    if (s.description) doc.font('Helvetica').fontSize(8).fillColor('#475569').text(t(s.description));
    doc.moveDown(0.3);
    if (!s.rows.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor('#475569').text('No records.');
    else drawTable(doc, s, left, width, bottom, t);
    if (s.truncatedAt) doc.font('Helvetica-Oblique').fontSize(8).text(`Truncated at ${s.truncatedAt} rows; export CSV or Excel for the complete list.`);
    doc.moveDown();
  }
  ensure(60);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text('Definitions and exclusions', left, doc.y);
  doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
  for (const d of m.definitions) doc.text(`• ${t(d)}`);
  for (const e of m.exclusions) doc.text(`• Excluded: ${t(e)}`);
  if (m.sources.length) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).text('Traceability appendix: source records', left, doc.y);
    doc.moveDown(0.3);
    drawTable(doc, { heading: '', columns: [{ key: 'type', label: 'Type', width: 1 }, { key: 'label', label: 'Label', width: 2 }, { key: 'id', label: 'Record ID', width: 2 }], rows: m.sources }, left, width, bottom, t);
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (h.status === 'draft') {
      doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] }).font('Helvetica-Bold').fontSize(110).fillColor('#94a3b8').opacity(0.12)
        .text('DRAFT', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false }).restore();
      doc.opacity(1);
    }
    const y = doc.page.height - 32;
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // footer sits inside the bottom margin
    doc.font('Helvetica').fontSize(7).fillColor('#475569')
      .text(t(`${h.organization} · ${h.title} · ${h.status === 'final' ? 'Final' : 'Draft'} · ${formatTimestamp(h.generatedAt, h.timezone)}`), left, y, { width: width * 0.8, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, y, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }
  doc.end();
  return done;
}

function drawTable(doc: PDFKit.PDFDocument, s: ReportSection, left: number, width: number, bottom: () => number, t: (c: Cell) => string) {
  const total = s.columns.reduce((n, c) => n + (c.width ?? 1), 0);
  const widths = s.columns.map((c) => ((c.width ?? 1) / total) * width);
  const pad = 3;
  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
    const height = Math.max(...cells.map((c, i) => doc.heightOfString(c || ' ', { width: widths[i] - pad * 2 }))) + pad * 2;
    if (doc.y + height > bottom()) {
      doc.addPage();
      if (!bold) drawRow(s.columns.map((c) => t(c.label)), true); // repeat the header on new pages
    }
    const y = doc.y;
    if (bold) doc.rect(left, y, width, height).fill('#e2e8f0');
    doc.fillColor('#0f172a');
    let x = left;
    cells.forEach((c, i) => {
      doc.text(c, x + pad, y + pad, { width: widths[i] - pad * 2 });
      x += widths[i];
    });
    doc.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.3).strokeColor('#cbd5e1').stroke();
    doc.x = left;
    doc.y = y + height;
  };
  drawRow(s.columns.map((c) => t(c.label)), true);
  for (const r of s.rows) drawRow(s.columns.map((c) => t(r[c.key])), false);
}
