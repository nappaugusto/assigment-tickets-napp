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
        email      TEXT,
        password   TEXT        NOT NULL,
        role       TEXT        NOT NULL DEFAULT 'user',
        google_id  TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS internal_teams (
        id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name        TEXT        NOT NULL UNIQUE,
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS internal_team_members (
        team_id    INTEGER     NOT NULL REFERENCES internal_teams(id) ON DELETE CASCADE,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_admin   BOOLEAN     NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(team_id, user_id)
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

      CREATE TABLE IF NOT EXISTS ticket_ai_triages (
        id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ticket_id   INTEGER     NOT NULL,
        provider    TEXT        NOT NULL DEFAULT 'claude',
        model       TEXT        NOT NULL,
        status      TEXT        NOT NULL DEFAULT 'pending',
        triage      JSONB,
        input_summary JSONB,
        error       TEXT,
        decision    TEXT,
        follow_up_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS ai_triage_memories (
        id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        fingerprint        TEXT        NOT NULL UNIQUE,
        status             TEXT        NOT NULL DEFAULT 'candidate',
        source_triage_id   INTEGER     REFERENCES ticket_ai_triages(id) ON DELETE SET NULL,
        source_ticket_id   INTEGER,
        keywords           TEXT[]      NOT NULL DEFAULT '{}',
        likely_area        TEXT        NOT NULL DEFAULT '',
        technical_pattern  TEXT        NOT NULL DEFAULT '',
        code_paths         JSONB       NOT NULL DEFAULT '[]'::jsonb,
        diagnostic_queries JSONB       NOT NULL DEFAULT '[]'::jsonb,
        confidence         TEXT        NOT NULL DEFAULT 'media',
        use_count          INTEGER     NOT NULL DEFAULT 0,
        last_used_at       TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key        TEXT        NOT NULL,
        value      JSONB       NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, key)
      );

      CREATE TABLE IF NOT EXISTS api_channels (
        id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT        NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, name)
      );

      CREATE TABLE IF NOT EXISTS api_requests (
        id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        channel_id   INTEGER     NOT NULL REFERENCES api_channels(id) ON DELETE CASCADE,
        user_id      INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT        NOT NULL,
        description  TEXT,
        method       TEXT        NOT NULL DEFAULT 'GET',
        url          TEXT        NOT NULL,
        auth_type    TEXT        NOT NULL DEFAULT 'none',
        auth_config  JSONB       NOT NULL DEFAULT '{}'::jsonb,
        query_params TEXT        NOT NULL DEFAULT '',
        headers      JSONB       NOT NULL DEFAULT '{}'::jsonb,
        variables    JSONB       NOT NULL DEFAULT '{}'::jsonb,
        body         TEXT        NOT NULL DEFAULT '',
        last_response JSONB,
        last_run_at   TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS internal_cases (
        id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title          TEXT        NOT NULL,
        description    TEXT        NOT NULL,
        category       TEXT,
        priority       TEXT        NOT NULL DEFAULT 'Normal',
        status         TEXT        NOT NULL DEFAULT 'Novo',
        due_at         TIMESTAMPTZ,
        resolved_at    TIMESTAMPTZ,
        requester_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        requester_name TEXT        NOT NULL,
        team_id        INTEGER     REFERENCES internal_teams(id) ON DELETE SET NULL,
        team_name      TEXT,
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

      CREATE TABLE IF NOT EXISTS internal_case_comments (
        id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        case_id         INTEGER     NOT NULL REFERENCES internal_cases(id) ON DELETE CASCADE,
        author_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        author_name     TEXT        NOT NULL,
        content         TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS internal_case_sla_policies (
        priority        TEXT        PRIMARY KEY,
        duration_hours  INTEGER     NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
        ON users (lower(username));
      CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status);
      CREATE INDEX IF NOT EXISTS tickets_opened_at_idx ON tickets (opened_at);
      CREATE INDEX IF NOT EXISTS ticket_ai_triages_ticket_id_idx ON ticket_ai_triages (ticket_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_triage_memories_keywords_idx
        ON ai_triage_memories USING GIN (keywords);
      CREATE INDEX IF NOT EXISTS ai_triage_memories_status_idx
        ON ai_triage_memories (status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS tickets_responsavel_idx ON tickets (responsavel);
      CREATE INDEX IF NOT EXISTS tickets_updated_at_idx ON tickets (updated_at);
      CREATE INDEX IF NOT EXISTS password_resets_expires_at_idx ON password_resets (expires_at);
      CREATE INDEX IF NOT EXISTS ticket_notes_user_nonempty_idx
        ON ticket_notes (user_id, ticket_id)
        WHERE content <> '';
      CREATE INDEX IF NOT EXISTS user_preferences_user_key_idx
        ON user_preferences (user_id, key);
      CREATE INDEX IF NOT EXISTS api_channels_user_idx
        ON api_channels (user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS api_requests_user_idx
        ON api_requests (user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS api_requests_channel_idx
        ON api_requests (channel_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS internal_cases_status_idx ON internal_cases (status);
      CREATE INDEX IF NOT EXISTS internal_cases_created_at_idx ON internal_cases (created_at);
      CREATE INDEX IF NOT EXISTS internal_cases_requester_idx ON internal_cases (requester_id);
      CREATE INDEX IF NOT EXISTS internal_case_attachments_case_idx
        ON internal_case_attachments (case_id);
      CREATE INDEX IF NOT EXISTS internal_case_comments_case_idx
        ON internal_case_comments (case_id);
    `);

    await this.db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email TEXT,
        ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
        ADD COLUMN IF NOT EXISTS google_id TEXT;

      ALTER TABLE internal_cases
        ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES internal_teams(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS team_name TEXT,
        ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

      ALTER TABLE tickets
        ADD COLUMN IF NOT EXISTS trello_card_id TEXT,
        ADD COLUMN IF NOT EXISTS trello_card_url TEXT,
        ADD COLUMN IF NOT EXISTS trello_card_name TEXT,
        ADD COLUMN IF NOT EXISTS trello_card_created_at TIMESTAMPTZ;

      ALTER TABLE ticket_ai_triages
        ADD COLUMN IF NOT EXISTS follow_up_messages JSONB NOT NULL DEFAULT '[]'::jsonb;

      ALTER TABLE api_requests
        ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS last_response JSONB,
        ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
        ON users (lower(email))
        WHERE email IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique
        ON users (google_id)
        WHERE google_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS internal_cases_team_idx ON internal_cases (team_id);
      CREATE INDEX IF NOT EXISTS internal_cases_due_at_idx ON internal_cases (due_at);
      CREATE INDEX IF NOT EXISTS tickets_trello_card_id_idx ON tickets (trello_card_id);
    `);

    await this.db.query(`
      INSERT INTO internal_case_sla_policies (priority, duration_hours)
      VALUES
        ('Urgente', 8),
        ('Alta', 24),
        ('Normal', 48),
        ('Baixa', 120)
      ON CONFLICT(priority) DO NOTHING;

      UPDATE internal_cases c
         SET due_at = c.created_at + make_interval(hours => p.duration_hours)
        FROM internal_case_sla_policies p
       WHERE c.due_at IS NULL
         AND c.priority = p.priority;
    `);

    await this.db.query(`
      UPDATE users
         SET role = 'admin'
       WHERE id = (SELECT min(id) FROM users)
         AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
    `);

    await this.db.query(`
      WITH target_users AS (
        SELECT id
          FROM users
      ),
      channels AS (
        INSERT INTO api_channels (user_id, name, description, updated_at)
        SELECT id, 'AIqfome', 'APIs do canal AIqfome', now()
          FROM target_users
        ON CONFLICT(user_id, name) DO UPDATE SET
          description = COALESCE(api_channels.description, excluded.description),
          updated_at = api_channels.updated_at
        RETURNING id, user_id
      ),
      existing_requests AS (
        SELECT r.id
          FROM api_requests r
          JOIN channels c ON c.id = r.channel_id
         WHERE r.name = 'Order -> List Orders'
      ),
      updated_requests AS (
        UPDATE api_requests r
           SET headers = '{"Accept":"application/json","User-Agent":"napp","Aiq-User-Agent":"napp"}'::jsonb,
               auth_type = 'bearer',
               auth_config = '{"token":"{{token}}"}'::jsonb,
               variables = CASE
                 WHEN r.variables ? 'token' THEN r.variables
                 ELSE r.variables || '{"token":""}'::jsonb
               END,
               updated_at = now()
         WHERE r.id IN (SELECT id FROM existing_requests)
         RETURNING r.id
      )
      INSERT INTO api_requests (
        channel_id, user_id, name, description, method, url, auth_type,
        auth_config, query_params, headers, variables, body, updated_at
      )
      SELECT
        c.id,
        c.user_id,
        'Order -> List Orders',
        'Lista pedidos pela API aiqfome V0 (Alfredo). Endpoint GET /alfredo/orders/search.',
        'GET',
        'https://purple-box.aiqfome.com/alfredo/orders/search',
        'bearer',
        '{"token":"{{token}}"}'::jsonb,
        '',
        '{"Accept":"application/json","User-Agent":"napp","Aiq-User-Agent":"napp"}'::jsonb,
        '{"token":""}'::jsonb,
        '',
        now()
      FROM channels c
      WHERE NOT EXISTS (
        SELECT 1
          FROM api_requests r
         WHERE r.channel_id = c.id
           AND r.name = 'Order -> List Orders'
      );
    `);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
