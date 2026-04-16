import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';

export const DB_TOKEN = 'DATABASE';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: (config: ConfigService) => {
        const dbPath = config.get<string>('DATABASE_PATH') ?? './tickets.db';
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
