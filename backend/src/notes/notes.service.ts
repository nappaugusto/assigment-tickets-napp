import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';

interface NoteRow {
  content: string;
}

@Injectable()
export class NotesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async getNote(userId: number, ticketId: number): Promise<string> {
    const result = await this.db.query<NoteRow>(
      'SELECT content FROM ticket_notes WHERE user_id = $1 AND ticket_id = $2',
      [userId, ticketId],
    );
    const row = result.rows[0];
    return row?.content ?? '';
  }

  async saveNote(userId: number, ticketId: number, content: string): Promise<void> {
    await this.db.query(
      `
        INSERT INTO ticket_notes (user_id, ticket_id, content, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT(user_id, ticket_id) DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `,
      [userId, ticketId, content],
    );
  }

  async hasNote(userId: number, ticketId: number): Promise<boolean> {
    const result = await this.db.query(
      "SELECT 1 FROM ticket_notes WHERE user_id = $1 AND ticket_id = $2 AND content != ''",
      [userId, ticketId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getTicketsWithNotes(userId: number): Promise<number[]> {
    const result = await this.db.query<{ ticket_id: number }>(
      "SELECT ticket_id FROM ticket_notes WHERE user_id = $1 AND content != ''",
      [userId],
    );
    return result.rows.map((r: { ticket_id: number }) => Number(r.ticket_id));
  }
}
