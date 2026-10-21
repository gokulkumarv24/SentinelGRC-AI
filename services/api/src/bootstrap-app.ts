import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { createLogger } from './common/logger.js';
import { loadEnv } from './config/env.js';

export const API_PREFIX = 'api/v1';

/** Builds the HTTP application. Shared by main.ts and the API test suite so tests exercise real middleware. */
export async function createApp(options: { logger?: boolean } = {}): Promise<INestApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: options.logger === false ? false : createLogger(env),
    bodyParser: false,
  });
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' });
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: env.APP_ENV === 'production',
    }),
  );
  app.enableCors({
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  if (env.APP_ENV !== 'production') {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, () => openApiDocument(app), {
      jsonDocumentUrl: `${API_PREFIX}/openapi.json`,
    });
  }
  return app;
}

/** The OpenAPI document served in development and exported by `npm run openapi`. */
export function openApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('SentinelGRC AI API')
    .setDescription('Governance, risk, compliance, third-party risk and AI governance API. Cookie session + X-CSRF-Token.')
    .setVersion('1.0.0')
    .addCookieAuth('sg_session')
    .build();
  return SwaggerModule.createDocument(app, config);
}
