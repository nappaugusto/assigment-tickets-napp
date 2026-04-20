import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';
import {
  Ticket,
  TicketDto,
  TicketMonthlyAnalyticsDto,
  TicketMonthlyAnalyticsItem,
} from './ticket.entity';

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

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function monthKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

function parseTicketDate(value: string | null): Date | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const dotNetMatch = trimmed.match(/\/Date\((\d+)\)\//);
  if (dotNetMatch) {
    const parsed = new Date(Number(dotNetMatch[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const brMatch = trimmed.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (brMatch) {
    const [, day, month, year, hours = '00', minutes = '00', seconds = '00'] = brMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getAnalyticsAnchorDate(rows: Ticket[], fallback: Date): Date {
  let latestTimestamp = 0;

  for (const ticket of rows) {
    for (const value of [ticket.opened_at, ticket.closed_at, ticket.slaSolutionDate]) {
      const parsed = parseTicketDate(value);
      if (parsed && parsed.getTime() > latestTimestamp) {
        latestTimestamp = parsed.getTime();
      }
    }
  }

  return latestTimestamp > 0 ? new Date(latestTimestamp) : fallback;
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

  getMonthlyAnalytics(months = 6): TicketMonthlyAnalyticsDto {
    const totalMonths = Math.max(1, Math.min(months, 24));
    const rows = this.db
      .prepare(`SELECT * FROM tickets ORDER BY id DESC`)
      .all() as Ticket[];

    const now = new Date();
    const anchorDate = getAnalyticsAnchorDate(rows, now);
    const firstMonth = startOfMonth(addMonths(anchorDate, -(totalMonths - 1)));
    const monthMap = new Map<string, TicketMonthlyAnalyticsItem>();

    for (let index = 0; index < totalMonths; index++) {
      const current = addMonths(firstMonth, index);
      const key = monthKey(current);
      monthMap.set(key, {
        month: key,
        label: current.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }),
        opened: 0,
        resolved: 0,
        breached: 0,
        resolved_on_time: 0,
        resolved_late: 0,
      });
    }

    for (const ticket of rows) {
      const openedAt = parseTicketDate(ticket.opened_at);
      const closedAt = parseTicketDate(ticket.closed_at);
      const slaAt = parseTicketDate(ticket.slaSolutionDate);
      const finalStatus = isFinal(ticket.status);

      if (openedAt) {
        const bucket = monthMap.get(monthKey(openedAt));
        if (bucket) bucket.opened += 1;
      }

      const resolvedReferenceDate = closedAt ?? slaAt ?? openedAt;

      if (finalStatus && resolvedReferenceDate) {
        const bucket = monthMap.get(monthKey(resolvedReferenceDate));
        if (bucket) {
          bucket.resolved += 1;
          if (slaAt) {
            if (now.getTime() <= slaAt.getTime()) {
              bucket.resolved_on_time += 1;
            } else {
              bucket.resolved_late += 1;
            }
          }
        }
      }

      if (slaAt) {
        const bucket = monthMap.get(monthKey(slaAt));
        const breached =
          (!finalStatus && slaAt.getTime() < now.getTime()) ||
          (finalStatus && !!closedAt && closedAt.getTime() > slaAt.getTime());

        if (bucket && breached) {
          bucket.breached += 1;
        }
      }
    }

    const analyticsMonths = Array.from(monthMap.values());
    const currentMonth = analyticsMonths[analyticsMonths.length - 1] ?? null;

    return {
      generated_at: new Date().toISOString(),
      months: analyticsMonths,
      current_month: currentMonth,
    };
  }
}
