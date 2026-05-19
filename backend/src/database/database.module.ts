import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolConfig } from 'pg';

export const DB_TOKEN = 'DATABASE';

let pool: Pool | null = null;

function readBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

function createPoolConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const ssl =
    readBoolean(env.DATABASE_SSL) || readBoolean(env.POSTGRES_SSL)
      ? { rejectUnauthorized: !readBoolean(env.DATABASE_SSL_ALLOW_SELF_SIGNED) }
      : undefined;

  const baseConfig: PoolConfig = {
    max: Number(env.DATABASE_POOL_MAX ?? 10),
    min: Number(env.DATABASE_POOL_MIN ?? 0),
    idleTimeoutMillis: Number(env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(
      env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5_000,
    ),
    ssl,
  };

  if (env.DATABASE_URL?.trim()) {
    return {
      ...baseConfig,
      connectionString: env.DATABASE_URL.trim(),
    };
  }

  return {
    ...baseConfig,
    host: env.POSTGRES_HOST ?? 'localhost',
    port: Number(env.POSTGRES_PORT ?? 5432),
    database: env.POSTGRES_DB ?? 'assignment_tickets',
    user: env.POSTGRES_USER ?? 'assignment_tickets',
    password: env.POSTGRES_PASSWORD ?? 'assignment_tickets',
  };
}

export function getDatabasePool(): Pool {
  if (!pool) {
    pool = new Pool(createPoolConfig(process.env));
  }
  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: () => getDatabasePool(),
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }
}
