import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from './database.module';

@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  onModuleInit() {
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT    NOT NULL,
        username  TEXT    NOT NULL UNIQUE,
        password  TEXT    NOT NULL,
        created_at TEXT   DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id                      INTEGER PRIMARY KEY,
        subject                 TEXT,
        status                  TEXT,
        ownerTeam               TEXT,
        slaSolutionDate         TEXT,
        slaSolutionDateIsPaused INTEGER DEFAULT 0,
        opened_at               TEXT,
        responsavel             TEXT,
        assigned_at             TEXT,
        assignment_override     TEXT,
        created_at              TEXT DEFAULT (datetime('now')),
        updated_at              TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS password_resets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT    NOT NULL UNIQUE,
        expires_at TEXT    NOT NULL,
        created_at TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS kanban_board (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        columns    TEXT NOT NULL DEFAULT '[]',
        positions  TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ticket_notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ticket_id  INTEGER NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, ticket_id)
      );
    `);
    this.logger.log('Database schema initialized');
  }
}
