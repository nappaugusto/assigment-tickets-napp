import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolveDatabasePath } from './database/database-path.util';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const session = require('express-session');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const passport = require('passport');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqliteStore = require('better-sqlite3-session-store')(session);

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

  const dbPath = resolveDatabasePath(process.env);
  mkdirSync(dirname(dbPath), { recursive: true });
  console.log(`[bootstrap] SQLite database path: ${dbPath}`);
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    console.log(
      `[bootstrap] Railway volume mount path detected: ${process.env.RAILWAY_VOLUME_MOUNT_PATH}`,
    );
  }

  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? 'changeme',
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
      },
      store: new BetterSqliteStore({ client: new Database(dbPath) }),
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
