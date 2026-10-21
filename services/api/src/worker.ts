import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CoreModule, DomainModule } from './app.module.js';
import { createLogger } from './common/logger.js';
import { loadEnv } from './config/env.js';
import { runWorkerLoop } from './modules/workflows/worker-loop.js';

/** The worker shares business services with the API but exposes no HTTP routes (spec §3.2). */
@Module({ imports: [CoreModule, DomainModule] })
class WorkerModule {}

const env = loadEnv();
Logger.overrideLogger(createLogger(env));
const logger = new Logger('Worker');
if (!env.WORKER_ENABLED) {
  logger.log('WORKER_ENABLED is false; exiting without processing jobs.');
  process.exit(0);
}

const app = await NestFactory.createApplicationContext(WorkerModule, {
  logger: createLogger(env),
});
app.enableShutdownHooks();
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.log(`${signal} received; finishing the current batch before exit.`);
    controller.abort();
  });
}

await runWorkerLoop(app, env.WORKER_POLL_SECONDS, logger, controller.signal);
await app.close();
