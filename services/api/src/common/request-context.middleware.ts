import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithContext } from './request-context.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Assigns a request/correlation id and opens the AsyncLocalStorage context for the request. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    runWithContext(
      {
        requestId,
        ip: req.ip,
        userAgent: req.header('user-agent')?.slice(0, 300),
        actorType: 'user',
      },
      next,
    );
  }
}
