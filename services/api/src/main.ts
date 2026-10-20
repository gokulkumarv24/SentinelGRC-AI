import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap-app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await createApp();
await app.listen(env.API_PORT, '0.0.0.0');
new Logger('Bootstrap').log(`API listening on port ${env.API_PORT} (${env.APP_ENV})`);
