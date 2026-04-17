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
        id         BIGSERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        username   TEXT NOT NULL UNIQUE,
        password   TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id                      BIGINT PRIMARY KEY,
        subject                 TEXT,
        status                  TEXT,
        "ownerTeam"             TEXT,
        "slaSolutionDate"       TIMESTAMPTZ,
        "slaSolutionDateIsPaused" BOOLEAN NOT NULL DEFAULT FALSE,
        opened_at               TIMESTAMPTZ,
        closed_at               TIMESTAMPTZ,
        responsavel             TEXT,
        assigned_at             TIMESTAMPTZ,
        assignment_override     TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS password_resets (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kanban_board (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        columns    JSONB NOT NULL DEFAULT '[]'::jsonb,
        positions  JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ticket_notes (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ticket_id  BIGINT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, ticket_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_responsavel
        ON tickets (responsavel);

      CREATE INDEX IF NOT EXISTS idx_tickets_sla_solution_date
        ON tickets ("slaSolutionDate");

      CREATE INDEX IF NOT EXISTS idx_password_resets_token
        ON password_resets (token);
    `);

    await this.ensureTicketColumn('closed_at', 'TIMESTAMPTZ');
    await this.ensureTicketColumn('"ownerTeam"', 'TEXT');
    await this.ensureTicketColumn('"slaSolutionDate"', 'TIMESTAMPTZ');
    await this.ensureTicketColumn('"slaSolutionDateIsPaused"', 'BOOLEAN NOT NULL DEFAULT FALSE');

    this.logger.log('Database schema initialized');
  }

  private async ensureTicketColumn(name: string, typeSql: string) {
    const normalizedName = name.replace(/"/g, '');
    const result = await this.db.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tickets'
          AND column_name = $1
      `,
      [normalizedName],
    );

    if (result.rowCount === 0) {
      await this.db.query(`ALTER TABLE tickets ADD COLUMN ${name} ${typeSql}`);
    }
  }
}
