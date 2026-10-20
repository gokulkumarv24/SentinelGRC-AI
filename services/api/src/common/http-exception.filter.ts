import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
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

/** Maps every error to `{ error: { code, message, details? }, requestId }` (spec §13.2). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = maybeContext()?.requestId;
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
    // Database and library errors can contain SQL, table names or values: never echo them, even in development.
    const isDbError = exception instanceof Error && exception.constructor.name.startsWith('PrismaClient');
    const dev = loadEnv().APP_ENV === 'development';
    const message = dev && exception instanceof Error && !isDbError ? exception.message : 'An unexpected error occurred';
    return [500, { error: { code: 'internal_error', message } }];
  }
}
