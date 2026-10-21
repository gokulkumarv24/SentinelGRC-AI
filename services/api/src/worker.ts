import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { setTimeout as sleep } from 'node:timers/promises';
import { CoreModule, DomainModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { EmailDeliveryService } from './modules/notifications/email-delivery.service.js';
import { WorkflowRunner } from './modules/workflows/workflow-runner.service.js';

/** The worker shares business services with the API but exposes no HTTP routes (spec §3.2). */
@Module({ imports: [CoreModule, DomainModule] })
class WorkerModule {}

const env = loadEnv();
const logger = new Logger('Worker');
if (!env.WORKER_ENABLED) {
  logger.log('WORKER_ENABLED is false; exiting without processing jobs.');
  process.exit(0);
}

const app = await NestFactory.createApplicationContext(WorkerModule, {
  logger: env.APP_ENV === 'production' ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
});
app.enableShutdownHooks();
const runner = app.get(WorkflowRunner);
const email = app.get(EmailDeliveryService);

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.log(`${signal} received; finishing the current batch before exit.`);
    controller.abort();
  });
}

const orgs = await runner.ensureDefaults();
logger.log(`Worker started: ${orgs} organization(s), polling every ${env.WORKER_POLL_SECONDS}s.`);

while (!controller.signal.aborted) {
  try {
    const { scheduled, processed } = await runner.tick();
    const mail = await email.deliverPending();
    if (scheduled || processed || mail.delivered || mail.failed) logger.log({ scheduled, processed, mail }, 'Worker tick');
  } catch (error) {
    // A database outage must not kill the loop; the next tick retries.
    logger.error({ err: error }, 'Worker tick failed');
  }
  await sleep(env.WORKER_POLL_SECONDS * 1000, undefined, { signal: controller.signal }).catch(() => undefined);
}

await app.close();
logger.log('Worker stopped.');
