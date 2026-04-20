import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export const DB_TOKEN = 'DATABASE';

function resolveDatabasePath(config: ConfigService): string {
  return config.get<string>('DATABASE_PATH') ?? './data/tickets.db';
}

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: (config: ConfigService) => {
        const dbPath = resolveDatabasePath(config);
        mkdirSync(dirname(dbPath), { recursive: true });
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
        return db;
      },
      inject: [ConfigService],
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule implements OnModuleInit {
  constructor() {}

  onModuleInit() {}
}
