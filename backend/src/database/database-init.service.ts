import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from './database.module';

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableConnectionError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  const cause =
    error instanceof Error && error.cause
      ? getErrorMessage(error.cause).toLowerCase()
      : '';
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';

  return (
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01'].includes(
      code,
    ) ||
    message.includes('connection terminated') ||
    message.includes('connection timeout') ||
    cause.includes('connection terminated') ||
    cause.includes('connection timeout')
  );
}

@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);
  private readonly maxAttempts = readPositiveInteger(
    process.env.DATABASE_INIT_MAX_ATTEMPTS,
    12,
  );
  private readonly retryDelayMs = readPositiveInteger(
    process.env.DATABASE_INIT_RETRY_DELAY_MS,
    5_000,
  );

  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async onModuleInit() {
    await this.initSchema();
  }

  private async initSchema() {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.createSchema();
        this.logger.log('Database schema initialized');
        return;
      } catch (error) {
        if (
          attempt >= this.maxAttempts ||
          !isRetryableConnectionError(error)
        ) {
          throw error;
        }

        this.logger.warn(
          `Database schema initialization failed (${attempt}/${this.maxAttempts}): ${getErrorMessage(error)}. Retrying in ${this.retryDelayMs}ms`,
        );
        await this.sleep(this.retryDelayMs);
      }
    }
  }

  private async createSchema() {
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
        trello_card_id              TEXT,
        trello_card_url             TEXT,
        trello_card_name            TEXT,
        trello_card_created_at      TIMESTAMPTZ,
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

      CREATE TABLE IF NOT EXISTS internal_cases (
        id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title          TEXT        NOT NULL,
        description    TEXT        NOT NULL,
        category       TEXT,
        priority       TEXT        NOT NULL DEFAULT 'Normal',
        status         TEXT        NOT NULL DEFAULT 'Novo',
        requester_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        requester_name TEXT        NOT NULL,
        assignee_id    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
        assignee_name  TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS internal_case_attachments (
        id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        case_id         INTEGER     NOT NULL REFERENCES internal_cases(id) ON DELETE CASCADE,
        file_name       TEXT        NOT NULL,
        content_type    TEXT        NOT NULL,
        size_bytes      INTEGER     NOT NULL,
        content         BYTEA       NOT NULL,
        uploaded_by_id  INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        uploaded_by_name TEXT       NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
      CREATE INDEX IF NOT EXISTS internal_cases_status_idx ON internal_cases (status);
      CREATE INDEX IF NOT EXISTS internal_cases_created_at_idx ON internal_cases (created_at);
      CREATE INDEX IF NOT EXISTS internal_cases_requester_idx ON internal_cases (requester_id);
      CREATE INDEX IF NOT EXISTS internal_case_attachments_case_idx
        ON internal_case_attachments (case_id);
    `);

    await this.db.query(`
      ALTER TABLE tickets
        ADD COLUMN IF NOT EXISTS trello_card_id TEXT,
        ADD COLUMN IF NOT EXISTS trello_card_url TEXT,
        ADD COLUMN IF NOT EXISTS trello_card_name TEXT,
        ADD COLUMN IF NOT EXISTS trello_card_created_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS tickets_trello_card_id_idx ON tickets (trello_card_id);
    `);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
