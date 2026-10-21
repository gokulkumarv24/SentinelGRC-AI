import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { backoffMs } from '../workflows/workflow-runner.service.js';

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
/** Plain ASCII addresses only: no comments, quoting or IDN tricks that could bypass the domain allowlist. */
const SIMPLE_ADDRESS = /^[a-z0-9._%+-]{1,64}@([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

export type EmailDecision = { send: true } | { send: false; reason: string };

/** Whether an outbox email may be sent. Demo mode never mails anyone outside an explicit allowlist (spec §18). */
export function emailDecision(env: Pick<Env, 'EMAIL_PROVIDER' | 'DEMO_MODE' | 'EMAIL_ALLOWED_RECIPIENT_DOMAINS'>, recipient: string): EmailDecision {
  if (env.EMAIL_PROVIDER === 'none') return { send: false, reason: 'email_not_configured' };
  const address = recipient.trim();
  if (!SIMPLE_ADDRESS.test(address)) return { send: false, reason: 'unsupported_address' };
  const domain = address.split('@')[1];
  const allowed = env.EMAIL_ALLOWED_RECIPIENT_DOMAINS.map((d) => d.toLowerCase());
  if (allowed.length && !allowed.includes(domain)) return { send: false, reason: 'recipient_domain_not_allowed' };
  if (env.DEMO_MODE && !allowed.length) return { send: false, reason: 'demo_mode_without_allowlist' };
  return { send: true };
}

/** Delivers queued outbox emails with retry, backoff and per-message dedupe (spec §12.3, §18). */
@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private transporter?: Transporter;

  constructor(private readonly prisma: PrismaService) {}

  async deliverPending(now = new Date(), limit = 20) {
    const env = loadEnv();
    const lease = new Date(now.getTime() + LEASE_MS);
    const batch = await this.prisma.$queryRaw<Array<{ id: string; recipient: string; subject: string; body: string; dedupe_key: string; attempt_count: number }>>`
      UPDATE outbox_events SET next_attempt_at = ${lease}
      WHERE id IN (
        SELECT id FROM outbox_events WHERE status = 'pending' AND channel = 'email' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT ${limit})
      RETURNING id, recipient, subject, body, dedupe_key, attempt_count`;
    const counts = { delivered: 0, suppressed: 0, failed: 0, retrying: 0 };
    for (const msg of batch) {
      const decision = emailDecision(env, msg.recipient);
      if (!decision.send) {
        await this.finish(msg.id, msg.dedupe_key, 'suppressed', decision.reason);
        counts.suppressed++;
        continue;
      }
      try {
        await this.transport(env).sendMail({ from: env.EMAIL_FROM, to: msg.recipient, subject: msg.subject, text: msg.body, disableFileAccess: true, disableUrlAccess: true });
        await this.finish(msg.id, msg.dedupe_key, 'delivered', null, now);
        counts.delivered++;
      } catch (error) {
        const attempts = msg.attempt_count + 1;
        this.logger.warn({ outboxId: msg.id, attempts, code: (error as { code?: string }).code }, 'Email delivery failed');
        if (attempts >= MAX_ATTEMPTS) {
          await this.finish(msg.id, msg.dedupe_key, 'failed', 'delivery_failed', undefined, attempts);
          counts.failed++;
        } else {
          await this.prisma.outboxEvent.update({ where: { id: msg.id }, data: { attemptCount: attempts, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: 'delivery_failed' } });
          counts.retrying++;
        }
      }
    }
    return counts;
  }

  private async finish(id: string, dedupeKey: string, status: 'delivered' | 'suppressed' | 'failed', error: string | null, deliveredAt?: Date, attempts?: number) {
    await this.prisma.tx(async (tx) => {
      await tx.outboxEvent.update({ where: { id }, data: { status, lastError: error, deliveredAt: deliveredAt ?? null, ...(attempts ? { attemptCount: attempts } : {}) } });
      const notificationId = dedupeKey.startsWith('notification:') ? dedupeKey.slice('notification:'.length) : null;
      if (notificationId) await tx.notification.updateMany({ where: { id: notificationId }, data: { emailStatus: status } });
    });
  }

  private transport(env: Env): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      requireTLS: env.SMTP_PORT !== 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }
}
