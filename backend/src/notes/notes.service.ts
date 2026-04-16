import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';

interface NoteRow {
  content: string;
}

@Injectable()
export class NotesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  getNote(userId: number, ticketId: number): string {
    const row = this.db
      .prepare('SELECT content FROM ticket_notes WHERE user_id = ? AND ticket_id = ?')
      .get(userId, ticketId) as NoteRow | undefined;
    return row?.content ?? '';
  }

  saveNote(userId: number, ticketId: number, content: string): void {
    this.db
      .prepare(`
        INSERT INTO ticket_notes (user_id, ticket_id, content, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, ticket_id) DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `)
      .run(userId, ticketId, content);
  }

  hasNote(userId: number, ticketId: number): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM ticket_notes WHERE user_id = ? AND ticket_id = ? AND content != ''")
      .get(userId, ticketId);
    return row !== undefined;
  }

  getTicketsWithNotes(userId: number): number[] {
    const rows = this.db
      .prepare("SELECT ticket_id FROM ticket_notes WHERE user_id = ? AND content != ''")
      .all(userId) as { ticket_id: number }[];
    return rows.map((r) => r.ticket_id);
  }
}
