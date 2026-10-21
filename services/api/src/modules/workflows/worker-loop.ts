import type { INestApplicationContext, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { EmailDeliveryService } from '../notifications/email-delivery.service.js';
import { WorkflowRunner } from './workflow-runner.service.js';

/**
 * The scheduler/job loop. Runs in the dedicated worker process, or inside the API process when
 * RUN_WORKER_IN_API=true (single-instance hosting such as Render's free plan).
 */
export async function runWorkerLoop(app: INestApplicationContext, pollSeconds: number, logger: Logger, signal: AbortSignal): Promise<void> {
  const runner = app.get(WorkflowRunner);
  const email = app.get(EmailDeliveryService);
  const orgs = await runner.ensureDefaults();
  logger.log(`Worker started: ${orgs} organization(s), polling every ${pollSeconds}s.`);
  while (!signal.aborted) {
    try {
      const { scheduled, processed } = await runner.tick();
      const mail = await email.deliverPending();
      if (scheduled || processed || mail.delivered || mail.failed) logger.log({ scheduled, processed, mail }, 'Worker tick');
    } catch (error) {
      // A database outage must not kill the loop; the next tick retries.
      logger.error({ err: error }, 'Worker tick failed');
    }
    await sleep(pollSeconds * 1000, undefined, { signal }).catch(() => undefined);
  }
  logger.log('Worker stopped.');
}
