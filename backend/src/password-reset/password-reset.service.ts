import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
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
    @Inject(DB_TOKEN) private readonly db: Pool,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
  ) {}

  async requestReset(username: string): Promise<{ success: boolean; error?: string }> {
    const user = await this.usersService.findByLoginIdentifier(username);

    // Always return success to prevent user enumeration
    if (!user) return { success: true };

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await this.db.query(`DELETE FROM password_resets WHERE user_id = $1`, [user.id]);
    await this.db.query(
      `INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt],
    );

    await this.emailService.sendPasswordReset(user.username, user.name, token);

    return { success: true };
  }

  async validateToken(token: string): Promise<{ valid: boolean; userId?: number }> {
    const result = await this.db.query<PasswordResetRow>(
      `
        SELECT *
        FROM password_resets
        WHERE token = $1
          AND expires_at > NOW()
        LIMIT 1
      `,
      [token],
    );
    const row = result.rows[0];

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

    const { valid, userId } = await this.validateToken(token);
    if (!valid || !userId) {
      return { success: false, error: 'Link inválido ou expirado.' };
    }

    const user = await this.usersService.findById(userId);
    if (!user) return { success: false, error: 'Usuário não encontrado.' };

    await this.usersService.updatePassword(userId, newPassword);

    await this.db.query(`DELETE FROM password_resets WHERE token = $1`, [token]);

    // Clean expired tokens
    await this.db.query(`DELETE FROM password_resets WHERE expires_at < NOW()`);

    await this.emailService.sendPasswordChanged(user.username, user.name);

    return { success: true };
  }
}
