import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from './database.module';

@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async onModuleInit() {
    await this.initSchema();
  }

  private async initSchema() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name       TEXT        NOT NULL,
        username   TEXT        NOT NULL UNIQUE,
        password   TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id                          INTEGER PRIMARY KEY,
        subject                     TEXT,
        status                      TEXT,
        "ownerTeam"                 TEXT,
        "slaSolutionDate"           TEXT,
        "slaSolutionDateIsPaused"   BOOLEAN NOT NULL DEFAULT false,
        opened_at                   TEXT,
        closed_at                   TEXT,
        last_update                 TEXT,
        responsavel                 TEXT,
        assigned_at                 TIMESTAMPTZ,
        assignment_override         TEXT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ticket_exit_events (
        ticket_id         INTEGER PRIMARY KEY,
        sla_solution_date TEXT,
        exited_at         TIMESTAMPTZ NOT NULL,
        exited_month      TEXT        NOT NULL,
        exited_label      TEXT        NOT NULL,
        resolved_on_time  INTEGER     NOT NULL DEFAULT 0,
        resolved_late     INTEGER     NOT NULL DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS password_resets (
        id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT        NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS kanban_board (
        id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id    INTEGER     NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        columns    JSONB       NOT NULL DEFAULT '[]'::jsonb,
        positions  JSONB       NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ticket_notes (
        id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ticket_id  INTEGER     NOT NULL,
        content    TEXT        NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, ticket_id)
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key        TEXT        NOT NULL,
        value      JSONB       NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, key)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
        ON users (lower(username));
      CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status);
      CREATE INDEX IF NOT EXISTS tickets_opened_at_idx ON tickets (opened_at);
      CREATE INDEX IF NOT EXISTS tickets_responsavel_idx ON tickets (responsavel);
      CREATE INDEX IF NOT EXISTS tickets_updated_at_idx ON tickets (updated_at);
      CREATE INDEX IF NOT EXISTS password_resets_expires_at_idx ON password_resets (expires_at);
      CREATE INDEX IF NOT EXISTS ticket_notes_user_nonempty_idx
        ON ticket_notes (user_id, ticket_id)
        WHERE content <> '';
      CREATE INDEX IF NOT EXISTS user_preferences_user_key_idx
        ON user_preferences (user_id, key);
    `);

    this.logger.log('Database schema initialized');
  }
}
