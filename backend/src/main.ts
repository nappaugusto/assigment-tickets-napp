import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Pool } from 'pg';
import { DB_TOKEN } from './database/database.module';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const session = require('express-session');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const passport = require('passport');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PgSession = require('connect-pg-simple')(session);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const pool = app.get<Pool>(DB_TOKEN);

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

  app.use(
    session({
      secret: config.get<string>('SESSION_SECRET') ?? 'changeme',
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: (config.get<string>('NODE_ENV') ?? 'development') === 'production',
      },
      rolling: true,
      store: new PgSession({
        pool,
        tableName: 'user_sessions',
        createTableIfMissing: true,
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
