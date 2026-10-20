import { Injectable, Logger } from '@nestjs/common';
import { maybeContext } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';

export interface AuditInput {
  action: string; // e.g. risk.created, finding.transitioned, auth.login_failed
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  rationale?: string | null;
  outcome?: 'success' | 'denied' | 'failure';
  /** Overrides for events outside a tenant request (login, platform actions). */
  organizationId?: string | null;
  actorUserId?: string | null;
}

/** Keys never written to audit summaries, even if a caller passes them (spec §16.1). */
const REDACTED_KEYS = /pass(word)?|secret|token|api[_-]?key|hash|cookie|authorization|answer|content/i;
const MAX_STRING = 500;

function summarize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return depth > 2 ? `[${value.length} items]` : value.slice(0, 20).map((v) => summarize(v, depth + 1));
  if (typeof value === 'object') {
    if (depth > 2) return '[object]';
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACTED_KEYS.test(k) ? '[redacted]' : summarize(v, depth + 1)]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes an audit event. Pass `tx` so the event commits atomically with the change it describes. */
  async record(input: AuditInput, tx?: Tx): Promise<void> {
    const ctx = maybeContext();
    const data: Prisma.AuditEventUncheckedCreateInput = {
      organizationId: input.organizationId !== undefined ? input.organizationId : (ctx?.membership?.organizationId ?? ctx?.vendorPortal?.organizationId ?? null),
      actorUserId: input.actorUserId !== undefined ? input.actorUserId : (ctx?.user?.id ?? null),
      actorType: ctx?.actorType ?? 'system',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      requestId: ctx?.requestId,
      sourceIp: ctx?.ip,
      userAgent: ctx?.userAgent,
      beforeSummary: (summarize(input.before) ?? undefined) as Prisma.InputJsonValue | undefined,
      afterSummary: (summarize(input.after) ?? undefined) as Prisma.InputJsonValue | undefined,
      rationale: input.rationale ?? null,
      outcome: input.outcome ?? 'success',
    };
    await (tx ?? this.prisma).auditEvent.create({ data });
  }

  /** Fire-and-forget variant for denial logging where the request is already failing. */
  recordQuietly(input: AuditInput): void {
    this.record(input).catch((err: unknown) => this.logger.warn({ err }, 'Failed to write audit event'));
  }
}
