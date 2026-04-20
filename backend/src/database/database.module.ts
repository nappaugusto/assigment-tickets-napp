import { Global, Module, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolveDatabasePath } from './database-path.util';

export const DB_TOKEN = 'DATABASE';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: () => {
        const dbPath = resolveDatabasePath(process.env);
        mkdirSync(dirname(dbPath), { recursive: true });
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');
        return db;
      },
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule implements OnModuleInit {
  constructor() {}

  onModuleInit() {}
}
