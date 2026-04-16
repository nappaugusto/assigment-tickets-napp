import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM') ?? 'no-reply@exemplo.com';

    this.transporter = nodemailer.createTransport({
      host: config.get<string>('MAIL_HOST') ?? 'smtp.exemplo.com',
      port: Number(config.get('MAIL_PORT') ?? 587),
      secure: false,
      auth: {
        user: config.get<string>('MAIL_USER') ?? '',
        pass: config.get<string>('MAIL_PASS') ?? '',
      },
    });
  }

  async sendPasswordReset(email: string, name: string, token: string): Promise<void> {
    const baseUrl =
      this.config.get<string>('APP_BASE_URL') ??
      `http://127.0.0.1:${this.config.get('PORT') ?? 3001}`;

    const resetUrl = `${baseUrl}/reset-password/${token}`;

    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Redefinição de senha</h2>
        <p>Olá, <strong>${name}</strong>!</p>
        <p>Você solicitou a redefinição da sua senha. Clique no link abaixo para redefinir:</p>
        <p>
          <a href="${resetUrl}" style="background:#3498db;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">
            Redefinir senha
          </a>
        </p>
        <p>Este link expira em <strong>1 hora</strong>.</p>
        <p>Se você não solicitou a redefinição, ignore este email.</p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Redefinição de senha — Assignment Tickets',
        html,
      });
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (err) {
      this.logger.error(`Failed to send email: ${(err as Error).message}`);
    }
  }

  async sendPasswordChanged(email: string, name: string): Promise<void> {
    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Senha alterada</h2>
        <p>Olá, <strong>${name}</strong>!</p>
        <p>Sua senha foi redefinida com sucesso.</p>
        <p>Se você não realizou essa alteração, entre em contato imediatamente.</p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Senha alterada — Assignment Tickets',
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send password-changed email: ${(err as Error).message}`);
    }
  }
}
