import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { DB_TOKEN } from '../database/database.module';
import { User, PublicUser } from './user.entity';

function normalizeUser(row?: User): User | undefined {
  if (!row) return undefined;

  return {
    ...row,
    id: Number(row.id),
    created_at: new Date(row.created_at).toISOString(),
  };
}

function toPublicUser(row: User): PublicUser {
  const normalized = normalizeUser(row)!;
  return {
    id: normalized.id,
    name: normalized.name,
    username: normalized.username,
    created_at: normalized.created_at,
  };
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async findByUsername(username: string): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [username],
    );
    return normalizeUser(result.rows[0]);
  }

  async findById(id: number): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    return normalizeUser(result.rows[0]);
  }

  async findByLoginIdentifier(identifier: string): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `
        SELECT *
        FROM users
        WHERE lower(username) = lower($1)
           OR lower(username) = lower($1)
        LIMIT 1
      `,
      [identifier],
    );
    return normalizeUser(result.rows[0]);
  }

  async create(
    name: string,
    username: string,
    password: string,
  ): Promise<PublicUser> {
    const hash = await bcrypt.hash(password, 12);
    const result = await this.db.query<User>(
      `
        INSERT INTO users (name, username, password)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [name, username, hash],
    );
    return toPublicUser(result.rows[0]);
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async exists(username: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [username],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updatePassword(userId: number, newPassword: string): Promise<void> {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.db.query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, userId]);
  }

  async getAll(): Promise<Pick<User, 'id' | 'name'>[]> {
    const result = await this.db.query<Pick<User, 'id' | 'name'>>(
      `SELECT id, name FROM users ORDER BY name`,
    );
    return result.rows;
  }
}
