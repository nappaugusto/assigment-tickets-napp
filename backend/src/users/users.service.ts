import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
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

  async findByEmail(email: string): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1) LIMIT 1`,
      [email],
    );
    return result.rows[0];
  }

  async findByGoogleId(googleId: string): Promise<User | undefined> {
    const result = await this.db.query<User>(
      `SELECT * FROM users WHERE google_id = $1 LIMIT 1`,
      [googleId],
    );
    return result.rows[0];
  }

  async create(
    name: string,
    username: string,
    password: string,
  ): Promise<PublicUser> {
    const hash = await bcrypt.hash(password, 12);
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users`,
    );
    const role = Number(countResult.rows[0]?.count ?? 0) === 0 ? 'admin' : 'user';
    const result = await this.db.query<PublicUser>(
      `INSERT INTO users (name, username, email, password, role)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING id, name, username, email, role, google_id, created_at`,
      [name, username, hash, role],
    );
    return result.rows[0];
  }

  async upsertGoogleUser(profile: {
    googleId: string;
    email: string;
    name: string;
  }): Promise<User> {
    const existingByGoogle = await this.findByGoogleId(profile.googleId);
    if (existingByGoogle) return existingByGoogle;

    const existingByEmail = await this.findByEmail(profile.email);
    if (existingByEmail) {
      const result = await this.db.query<User>(
        `UPDATE users
            SET google_id = $1,
                email = COALESCE(email, $2)
          WHERE id = $3
          RETURNING *`,
        [profile.googleId, profile.email, existingByEmail.id],
      );
      return result.rows[0];
    }

    const randomPassword = await bcrypt.hash(
      crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      12,
    );
    const result = await this.db.query<User>(
      `INSERT INTO users (name, username, email, password, google_id, role)
       VALUES ($1, $2, $2, $3, $4, 'user')
       RETURNING *`,
      [profile.name, profile.email, randomPassword, profile.googleId],
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

  async getAllPublic(): Promise<
    Pick<User, 'id' | 'name' | 'username' | 'email' | 'role'>[]
  > {
    const result = await this.db.query<
      Pick<User, 'id' | 'name' | 'username' | 'email' | 'role'>
    >(`SELECT id, name, username, email, role FROM users ORDER BY name`);
    return result.rows;
  }
}
