import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, types, type PoolConfig } from 'pg';

export const DB_TOKEN = 'DATABASE';

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
}

function buildPoolConfig(config: ConfigService): PoolConfig {
  const connectionString = config.get<string>('DATABASE_URL')?.trim();
  const sslEnabled = parseBoolean(config.get<string>('DATABASE_SSL'));

  if (connectionString) {
    return {
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    };
  }

  const host = config.get<string>('PGHOST')?.trim();
  const database = config.get<string>('PGDATABASE')?.trim();

  if (!host || !database) {
    throw new Error(
      'DATABASE_URL ou o conjunto PGHOST/PGDATABASE precisa estar configurado para usar PostgreSQL.',
    );
  }

  return {
    host,
    port: Number(config.get<string>('PGPORT') ?? 5432),
    user: config.get<string>('PGUSER') ?? 'postgres',
    password: config.get<string>('PGPASSWORD') ?? '',
    database,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  };
}

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: (config: ConfigService) => {
        return new Pool(buildPoolConfig(config));
      },
      inject: [ConfigService],
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_TOKEN) private readonly pool: Pool) {
    types.setTypeParser(20, (value) => Number(value));
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
