import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { getDatabasePool } from './database/database.module';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const session = require('express-session');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const passport = require('passport');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PgSession = require('connect-pg-simple')(session);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  const weakDefaults = new Set([
    '',
    'changeme',
    'changeme-super-secret-key',
    'change-me',
  ]);

  if (isProduction() && (!secret || weakDefaults.has(secret))) {
    throw new Error(
      'SESSION_SECRET deve ser definido com um valor forte antes de iniciar em produção.',
    );
  }

  return secret || 'dev-only-session-secret-change-me';
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    process.env.APP_BASE_URL,
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const pool = getDatabasePool();
  console.log('[bootstrap] PostgreSQL pool initialized');

  if (isProduction()) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(
    session({
      secret: getSessionSecret(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure:
          process.env.COOKIE_SECURE === 'true' ||
          (isProduction() && process.env.COOKIE_SECURE !== 'false'),
      },
      store: new PgSession({
        pool,
        createTableIfMissing: true,
        pruneSessionInterval: Number(
          process.env.SESSION_PRUNE_INTERVAL_SECONDS ?? 900,
        ),
      }),
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`NestJS backend running on http://127.0.0.1:${port}`);
}
bootstrap();

// Avoid unused import warnings
export type { ExpressRequest, ExpressResponse };
