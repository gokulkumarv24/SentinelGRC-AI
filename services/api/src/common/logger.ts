import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import type { Env } from '../config/env.js';

const ORDER: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
const THRESHOLD: Record<Env['LOG_LEVEL'], number> = { silent: -1, fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

/**
 * One logger for the API and the worker (spec §24): structured JSON lines in production,
 * readable coloured text in development, both honouring LOG_LEVEL.
 * Callers log identifiers and summaries only — never secrets, tokens or document contents.
 */
export function createLogger(env: Pick<Env, 'APP_ENV' | 'LOG_LEVEL' | 'APP_NAME'>): ConsoleLogger {
  const production = env.APP_ENV === 'production';
  return new ConsoleLogger(env.APP_NAME, {
    json: production,
    colors: !production,
    timestamp: !production,
    logLevels: ORDER.slice(0, THRESHOLD[env.LOG_LEVEL] + 1),
  });
}
