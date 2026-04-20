import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';
import { Ticket, TicketDto } from './ticket.entity';

const FINAL_STATUS_KEYWORDS = ['cancelado', 'resolvido', 'fechado'];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isFinal(status: string | null): boolean {
  if (!status) return false;
  const normalizedStatus = normalize(status);
  return FINAL_STATUS_KEYWORDS.some((keyword) => normalizedStatus.includes(keyword));
}

function toDto(t: Ticket): TicketDto {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    ownerTeam: t.ownerTeam,
    slaSolutionDate: t.slaSolutionDate,
    slaSolutionDateIsPaused: !!t.slaSolutionDateIsPaused,
    opened_at: t.opened_at,
    closed_at: t.closed_at,
    responsavel: t.responsavel,
    assigned_at: t.assigned_at,
  };
}

function isToday(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

@Injectable()
export class TicketsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  getAll(): TicketDto[] {
    const rows = this.db
      .prepare(`SELECT * FROM tickets ORDER BY id DESC`)
      .all() as Ticket[];
    return rows.map(toDto);
  }

  getActive(): TicketDto[] {
    const rows = this.db
      .prepare(`SELECT * FROM tickets ORDER BY id DESC`)
      .all() as Ticket[];
    return rows
      .filter((t) => !isFinal(t.status) && !isToday(t.opened_at))
      .map(toDto);
  }

  getNewToday(): TicketDto[] {
    const rows = this.db
      .prepare(`SELECT * FROM tickets ORDER BY id DESC`)
      .all() as Ticket[];
    return rows.filter((t) => !isFinal(t.status) && isToday(t.opened_at)).map(toDto);
  }

  findById(id: number): TicketDto | undefined {
    const t = this.db
      .prepare(`SELECT * FROM tickets WHERE id = ? LIMIT 1`)
      .get(id) as Ticket | undefined;
    return t ? toDto(t) : undefined;
  }

  assign(id: number, responsavel: string): void {
    this.db
      .prepare(
        `UPDATE tickets
         SET responsavel = ?, assigned_at = datetime('now'), assignment_override = 'local_assigned', updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(responsavel, id);
  }

  unassign(id: number): void {
    this.db
      .prepare(
        `UPDATE tickets
         SET responsavel = NULL, assigned_at = NULL, assignment_override = 'local_unassigned', updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(id);
  }

  upsertMany(tickets: Partial<Ticket>[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO tickets (id, subject, status, ownerTeam, slaSolutionDate, slaSolutionDateIsPaused, opened_at, closed_at, responsavel, assigned_at, updated_at)
      VALUES (@id, @subject, @status, @ownerTeam, @slaSolutionDate, @slaSolutionDateIsPaused, @opened_at, @closed_at, @responsavel, @assigned_at, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        subject = excluded.subject,
        status = excluded.status,
        ownerTeam = excluded.ownerTeam,
        slaSolutionDate = excluded.slaSolutionDate,
        slaSolutionDateIsPaused = excluded.slaSolutionDateIsPaused,
        opened_at = excluded.opened_at,
        closed_at = excluded.closed_at,
        responsavel = CASE
          WHEN assignment_override = 'local_assigned' THEN responsavel
          WHEN assignment_override = 'local_unassigned' THEN NULL
          ELSE excluded.responsavel
        END,
        assigned_at = CASE
          WHEN assignment_override = 'local_assigned' THEN assigned_at
          WHEN assignment_override = 'local_unassigned' THEN NULL
          ELSE excluded.assigned_at
        END,
        updated_at = datetime('now')
    `);

    const deleteOld = this.db.prepare(
      `DELETE FROM tickets WHERE id NOT IN (${tickets.map(() => '?').join(',')})`,
    );

    this.db.transaction(() => {
      for (const t of tickets) {
        upsert.run({
          id: t.id,
          subject: t.subject ?? null,
          status: t.status ?? null,
          ownerTeam: t.ownerTeam ?? null,
          slaSolutionDate: t.slaSolutionDate ?? null,
          slaSolutionDateIsPaused: t.slaSolutionDateIsPaused ? 1 : 0,
          opened_at: t.opened_at ?? null,
          closed_at: t.closed_at ?? null,
          responsavel: t.responsavel ?? null,
          assigned_at: t.assigned_at ?? null,
        });
      }
      if (tickets.length > 0) {
        deleteOld.run(...tickets.map((t) => t.id));
      }
    })();
  }

  getAllResponsaveis(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT responsavel FROM tickets WHERE responsavel IS NOT NULL ORDER BY responsavel`,
      )
      .all() as { responsavel: string }[];
    return rows.map((r) => r.responsavel);
  }
}
