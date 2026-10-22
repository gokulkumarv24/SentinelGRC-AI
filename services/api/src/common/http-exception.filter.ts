import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from './errors.js';
import { maybeContext } from './request-context.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_error',
  429: 'rate_limited',
};

/** body-parser (express.json/urlencoded) errors carry a 4xx `status` and a `type` such as entity.too.large. */
function bodyParserError(exception: unknown): [number, ErrorBody] | null {
  if (!(exception instanceof Error) || !('type' in exception) || !('status' in exception)) return null;
  const status = Number(exception.status);
  if (!(status >= 400 && status < 500)) return null;
  if (exception.type === 'entity.too.large') return [413, { error: { code: 'payload_too_large', message: 'The request body is too large' } }];
  if (exception.type === 'entity.parse.failed') return [400, { error: { code: 'invalid_json', message: 'The request body is not valid JSON' } }];
  return [status, { error: { code: STATUS_CODES[status] ?? 'bad_request', message: 'The request body could not be read' } }];
}

/** Maps every error to `{ error: { code, message, details? }, requestId }` (spec §13.2). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    // Body-parser errors happen before the request-context middleware, so give them their own id.
    let requestId = maybeContext()?.requestId;
    if (!requestId) {
      requestId = randomUUID();
      if (!res.headersSent) res.setHeader('X-Request-Id', requestId);
    }
    const [status, body] = this.toBody(exception);
    if (status >= 500) {
      // Full detail goes to the server log only — never to the client.
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }
    res.status(status).json({ ...body, requestId } satisfies ErrorBody);
  }

  private toBody(exception: unknown): [number, ErrorBody] {
    if (exception instanceof AppError) {
      return [exception.status, { error: { code: exception.code, message: exception.message, details: exception.details } }];
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return [409, { error: { code: 'conflict', message: 'A record with these values already exists' } }];
      if (exception.code === 'P2025') return [404, { error: { code: 'not_found', message: 'Record not found' } }];
      if (exception.code === 'P2003') return [409, { error: { code: 'invalid_reference', message: 'A referenced record does not exist' } }];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response && 'message' in response
          ? String(Array.isArray(response.message) ? response.message.join('; ') : response.message)
          : exception.message;
      return [status, { error: { code: STATUS_CODES[status] ?? 'error', message } }];
    }
    const parserError = bodyParserError(exception);
    if (parserError) return parserError;
    // Database and library errors can contain SQL, table names or values: never echo them, even in development.
    const isDbError = exception instanceof Error && exception.constructor.name.startsWith('PrismaClient');
    const dev = loadEnv().APP_ENV === 'development';
    const message = dev && exception instanceof Error && !isDbError ? exception.message : 'An unexpected error occurred';
    return [500, { error: { code: 'internal_error', message } }];
  }
}
