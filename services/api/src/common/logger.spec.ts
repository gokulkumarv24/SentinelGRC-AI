import { createLogger } from './logger.js';

function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => (lines.push(String(chunk)), true));
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => (lines.push(String(chunk)), true));
  try {
    fn();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return lines;
}

describe('createLogger', () => {
  it('writes one JSON object per line in production', () => {
    const logger = createLogger({ APP_ENV: 'production', LOG_LEVEL: 'info', APP_NAME: 'SentinelGRC' });
    const [line] = capture(() => logger.log('Worker started', 'Worker'));
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: 'log', message: 'Worker started', context: 'Worker' });
  });

  it('honours LOG_LEVEL', () => {
    const warnOnly = createLogger({ APP_ENV: 'production', LOG_LEVEL: 'warn', APP_NAME: 'SentinelGRC' });
    expect(capture(() => warnOnly.log('noise'))).toEqual([]);
    expect(capture(() => warnOnly.warn('kept'))).toHaveLength(1);
    expect(capture(() => createLogger({ APP_ENV: 'production', LOG_LEVEL: 'silent', APP_NAME: 'x' }).error('quiet'))).toEqual([]);
  });

  it('uses readable text in development', () => {
    const [line] = capture(() => createLogger({ APP_ENV: 'development', LOG_LEVEL: 'debug', APP_NAME: 'SentinelGRC' }).debug('details'));
    expect(() => JSON.parse(line)).toThrow();
    expect(line).toContain('details');
  });
});
