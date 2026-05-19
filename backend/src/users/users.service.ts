import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { DB_TOKEN } from '../database/database.module';
import { User, PublicUser } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async findByUsername(username: string): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [username],
    );
    return result.rows[0];
  }

  async findById(id: number): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0];
  }

  async findByLoginIdentifier(identifier: string): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `SELECT * FROM users
         WHERE lower(username) = lower($1)
            OR lower(username) = lower($2)
         LIMIT 1`,
      [identifier, identifier],
    );
    return result.rows[0];
  }

  async create(
    name: string,
    username: string,
    password: string,
  ): Promise<PublicUser> {
    const hash = await bcrypt.hash(password, 12);
    const result = await this.db.query<PublicUser>(
      `INSERT INTO users (name, username, password)
       VALUES ($1, $2, $3)
       RETURNING id, name, username, created_at`,
      [name, username, hash],
    );
    return result.rows[0];
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  async exists(username: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1`,
      [username],
    );
    return result.rows.length > 0;
  }

  async updatePassword(userId: number, newPassword: string): Promise<void> {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.db.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      hash,
      userId,
    ]);
  }

  async getAll(): Promise<Pick<User, 'id' | 'name'>[]> {
    const result = await this.db.query<Pick<User, 'id' | 'name'>>(
      `SELECT id, name FROM users ORDER BY name`,
    );
    return result.rows;
  }
}
