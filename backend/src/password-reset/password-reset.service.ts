import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import { DB_TOKEN } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';

interface PasswordResetRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
  created_at: string;
}

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database.Database,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
  ) {}

  async requestReset(username: string): Promise<{ success: boolean; error?: string }> {
    const user = this.usersService.findByLoginIdentifier(username);

    // Always return success to prevent user enumeration
    if (!user) return { success: true };

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    this.db
      .prepare(`DELETE FROM password_resets WHERE user_id = ?`)
      .run(user.id);

    this.db
      .prepare(
        `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)`,
      )
      .run(user.id, token, expiresAt);

    await this.emailService.sendPasswordReset(user.username, user.name, token);

    return { success: true };
  }

  validateToken(token: string): { valid: boolean; userId?: number } {
    const row = this.db
      .prepare(
        `SELECT * FROM password_resets WHERE token = ? AND expires_at > datetime('now') LIMIT 1`,
      )
      .get(token) as PasswordResetRow | undefined;

    if (!row) return { valid: false };
    return { valid: true, userId: row.user_id };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Senha deve ter no mínimo 6 caracteres.' };
    }

    const { valid, userId } = this.validateToken(token);
    if (!valid || !userId) {
      return { success: false, error: 'Link inválido ou expirado.' };
    }

    const user = this.usersService.findById(userId);
    if (!user) return { success: false, error: 'Usuário não encontrado.' };

    await this.usersService.updatePassword(userId, newPassword);

    this.db
      .prepare(`DELETE FROM password_resets WHERE token = ?`)
      .run(token);

    // Clean expired tokens
    this.db.prepare(`DELETE FROM password_resets WHERE expires_at < datetime('now')`).run();

    await this.emailService.sendPasswordChanged(user.username, user.name);

    return { success: true };
  }
}
