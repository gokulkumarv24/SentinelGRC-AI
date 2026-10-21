import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap-app.js';
import { loadEnv } from './config/env.js';
import { runWorkerLoop } from './modules/workflows/worker-loop.js';

const env = loadEnv();
const app = await createApp();
await app.listen(env.API_PORT, '0.0.0.0');
new Logger('Bootstrap').log(`API listening on port ${env.API_PORT} (${env.APP_ENV})`);

// Single-instance hosting (e.g. Render free plan) has no separate worker service: run the job loop here.
if (env.RUN_WORKER_IN_API) {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
  void runWorkerLoop(app, env.WORKER_POLL_SECONDS, new Logger('Worker'), controller.signal);
}
