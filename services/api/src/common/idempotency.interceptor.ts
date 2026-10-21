import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { IDEMPOTENT_KEY } from './decorators.js';
import { AppError, badRequest } from './errors.js';
import { requireOrgId, requireUserId } from './request-context.js';

const HEADER = 'idempotency-key';
const KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = 24 * 3_600_000;

/**
 * Replays the stored response for a repeated `Idempotency-Key`. Keys are scoped to the organization,
 * the user and the route, so one user can never receive another user's stored response. A key reused
 * with a different request body is rejected; a failed request releases its key so it can be retried.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = this.reflector.get<string | undefined>(IDEMPOTENT_KEY, context.getHandler());
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header(HEADER);
    if (!route || key === undefined) return next.handle();
    return from(this.handle(context, next, route, key, req));
  }

  private async handle(context: ExecutionContext, next: CallHandler, route: string, key: string, req: Request): Promise<unknown> {
    if (!KEY_FORMAT.test(key)) throw badRequest('invalid_idempotency_key', 'Idempotency-Key must be 8–128 letters, digits, "-" or "_"');
    const res = context.switchToHttp().getResponse<Response>();
    const organizationId = requireOrgId();
    const scope = `${route}:${requireUserId()}`;
    const requestHash = createHash('sha256').update(JSON.stringify({ path: req.path, body: req.body as unknown })).digest('hex');
    const now = new Date();

    await this.prisma.idempotencyKey.deleteMany({ where: { organizationId, expiresAt: { lt: now } } });
    try {
      await this.prisma.idempotencyKey.create({ data: { organizationId, scope, key, requestHash, expiresAt: new Date(now.getTime() + TTL_MS) } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { organizationId_scope_key: { organizationId, scope, key } } });
      if (!existing) throw new AppError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is being processed; retry shortly.');
      if (existing.requestHash !== requestHash) throw new AppError(409, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
      if (existing.responseStatus === null) throw new AppError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is being processed; retry shortly.');
      res.status(existing.responseStatus);
      res.setHeader('Idempotent-Replayed', 'true');
      return existing.responseBody;
    }

    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      const status = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ?? (req.method === 'POST' ? 201 : 200);
      await this.prisma.idempotencyKey.update({
        where: { organizationId_scope_key: { organizationId, scope, key } },
        data: { responseStatus: status, responseBody: (body ?? null) as Prisma.InputJsonValue },
      });
      return body;
    } catch (error) {
      // Nothing was committed by a failed request: release the key so the client can retry.
      await this.prisma.idempotencyKey.deleteMany({ where: { organizationId, scope, key } });
      throw error;
    }
  }
}
