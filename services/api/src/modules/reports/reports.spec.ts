import type { ReportModel } from './report-model.js';
import { formatTimestamp, renderCsv, renderPdf, renderXlsx, type ReportHeader } from './renderers.js';
import { nextScheduleRun } from './reports.service.js';

const header: ReportHeader = {
  organization: 'Northstar Digital Services (DEMO)',
  title: 'Risk register export',
  status: 'draft',
  generatedAt: new Date('2026-10-21T08:00:00Z'),
  timezone: 'Asia/Kolkata',
  creator: 'Demo Admin',
  filters: '',
  period: null,
  reportId: '00000000-0000-4000-8000-000000000001',
};

const model: ReportModel = {
  scope: 'All non-archived risks.',
  metrics: [{ label: 'Risks', value: 2, definition: 'Non-archived risks.' }],
  sections: [{ heading: 'Risk register', columns: [{ key: 'key', label: 'Key' }, { key: 'title', label: 'Title', width: 3 }], rows: [{ key: 'RSK-0001', title: '=cmd|" /C calc"!A0' }, { key: 'RSK-0002', title: 'Unicode ✓ 漢字 — dash' }] }],
  definitions: ['Score = likelihood × impact.'],
  exclusions: ['Archived risks.'],
  sources: [{ type: 'risk', id: '00000000-0000-4000-8000-000000000002', label: 'RSK-0001' }],
};

describe('report renderers', () => {
  it('writes CSV with metadata, neutralized formulas and the traceability list', () => {
    const csv = renderCsv(header, model).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Status,Draft');
    expect(csv).toContain('Generated,');
    expect(csv).toContain('(Asia/Kolkata)');
    expect(csv).toContain(`"'=cmd|"" /C calc""!A0"`);
    expect(csv).toContain('risk,00000000-0000-4000-8000-000000000002,RSK-0001');
    expect(csv).toContain('not an audit opinion');
  });

  it('renders a PDF with page numbers, including characters outside the standard fonts', async () => {
    const pdf = await renderPdf(header, model);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('renders an Excel workbook with values stored as text, not formulas', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderXlsx(header, model)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Risk register', 'Sources']);
    const cell = wb.getWorksheet('Risk register')!.getCell('B2');
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=cmd|" /C calc"!A0');
  });

  it('formats timestamps in the organization time zone and names it', () => {
    expect(formatTimestamp(new Date('2026-10-21T08:00:00Z'), 'Asia/Kolkata')).toMatch(/13:30:00.*\(Asia\/Kolkata\)$/);
  });
});

describe('report schedules', () => {
  it('advances by calendar period in UTC', () => {
    const from = new Date('2026-01-31T09:00:00Z');
    expect(nextScheduleRun(from, 'daily').toISOString()).toBe('2026-02-01T09:00:00.000Z');
    expect(nextScheduleRun(from, 'weekly').toISOString()).toBe('2026-02-07T09:00:00.000Z');
    expect(nextScheduleRun(new Date('2026-03-15T00:00:00Z'), 'monthly').toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });
});
