import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const session = require('express-session');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const passport = require('passport');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SQLiteStore = require('connect-sqlite3')(session);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const dbPath = process.env.DATABASE_PATH ?? './tickets.db';

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
      store: new SQLiteStore({ db: dbPath, dir: '.' }),
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
