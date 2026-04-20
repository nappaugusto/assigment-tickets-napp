import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as bcrypt from 'bcrypt';
import { DB_TOKEN } from '../database/database.module';
import { User, PublicUser } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  findByUsername(username: string): User | undefined {
    return this.db
      .prepare(
        `SELECT * FROM users WHERE lower(username) = lower(?) LIMIT 1`,
      )
      .get(username) as User | undefined;
  }

  findById(id: number): User | undefined {
    return this.db
      .prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`)
      .get(id) as User | undefined;
  }

  findByLoginIdentifier(identifier: string): User | undefined {
    return this.db
      .prepare(
        `SELECT * FROM users
         WHERE lower(username) = lower(?)
            OR lower(username) = lower(?)
         LIMIT 1`,
      )
      .get(identifier, identifier) as User | undefined;
  }

  async create(
    name: string,
    username: string,
    password: string,
  ): Promise<PublicUser> {
    const hash = await bcrypt.hash(password, 12);
    const result = this.db
      .prepare(
        `INSERT INTO users (name, username, password) VALUES (?, ?, ?)`,
      )
      .run(name, username, hash);
    return { id: result.lastInsertRowid as number, name, username, created_at: new Date().toISOString() };
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  exists(username: string): boolean {
    const row = this.db
      .prepare(`SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1`)
      .get(username);
    return !!row;
  }

  async updatePassword(userId: number, newPassword: string): Promise<void> {
    const hash = await bcrypt.hash(newPassword, 12);
    this.db
      .prepare(`UPDATE users SET password = ? WHERE id = ?`)
      .run(hash, userId);
  }

  getAll(): Pick<User, 'id' | 'name'>[] {
    return this.db
      .prepare(`SELECT id, name FROM users ORDER BY name`)
      .all() as Pick<User, 'id' | 'name'>[];
  }
}
