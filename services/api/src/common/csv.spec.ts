import { parseCsv, parseCsvObjects, safeCell, toCsv } from './csv.js';

describe('CSV safety', () => {
  it.each(['=HYPERLINK("http://evil")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])('neutralizes formula-like cell %j', (value) => {
    expect(safeCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('quotes cells containing commas, quotes and newlines', () => {
    expect(safeCell('a,b')).toBe('"a,b"');
    expect(safeCell('say "hi"')).toBe('"say ""hi"""');
    expect(safeCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('round-trips through the parser', () => {
    const csv = toCsv(['code', 'title'], [['AC-1', 'Access, reviews'], ['AC-2', 'He said "ok"']]);
    expect(parseCsvObjects(csv)).toEqual([
      { code: 'AC-1', title: 'Access, reviews' },
      { code: 'AC-2', title: 'He said "ok"' },
    ]);
  });

  it('parses quoted newlines and skips blank lines', () => {
    expect(parseCsv('a,b\r\n"x\ny",z\n\n')).toEqual([['a', 'b'], ['x\ny', 'z']]);
  });

  it('enforces a row limit', () => {
    expect(() => parseCsv('a\n'.repeat(20), 10)).toThrow();
  });
});
