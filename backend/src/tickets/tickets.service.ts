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
const BRAZIL_LOCALE = 'pt-BR';
const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

interface TicketExitEvent {
  ticket_id: number;
  sla_solution_date: string | null;
  exited_at: string;
  exited_month: string;
  exited_label: string;
  resolved_on_time: number;
  resolved_late: number;
}

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
  const current = parseCalendarDateParts(isoDate);
  const today = getBrazilDateParts(new Date());
  if (!current) return false;
  return compareCalendarDateParts(current, today) === 0;
}

function monthKeyFromParts(parts: CalendarDateParts): string {
  return `${parts.year}-${`${parts.month}`.padStart(2, '0')}`;
}

function getBrazilDateParts(date: Date): CalendarDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZIL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return { year, month, day };
}

function parseCalendarDateParts(value: string | null): CalendarDateParts | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    };
  }

  const brMatch = trimmed.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (brMatch) {
    return {
      year: Number(brMatch[3]),
      month: Number(brMatch[2]),
      day: Number(brMatch[1]),
    };
  }

  const dotNetMatch = trimmed.match(/\/Date\((\d+)\)\//);
  if (dotNetMatch) {
    return getBrazilDateParts(new Date(Number(dotNetMatch[1])));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : getBrazilDateParts(parsed);
}

function compareCalendarDateParts(a: CalendarDateParts, b: CalendarDateParts): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function isOnTimeByBrazilCalendar(
  referenceDate: CalendarDateParts,
  dueDate: CalendarDateParts,
): boolean {
  return compareCalendarDateParts(referenceDate, dueDate) <= 0;
}

function createBrazilMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat(BRAZIL_LOCALE, {
    timeZone: BRAZIL_TIME_ZONE,
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

function addMonthsToParts(parts: CalendarDateParts, delta: number): CalendarDateParts {
  const date = new Date(parts.year, parts.month - 1 + delta, 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: 1,
  };
}

function getAnalyticsAnchorMonthPartsFromExitEvents(
  events: TicketExitEvent[],
  fallback: Date,
): CalendarDateParts {
  let latestMonthParts: CalendarDateParts | null = null;

  for (const event of events) {
    const parts = parseCalendarDateParts(`${event.exited_month}-01`);
    if (!parts) continue;

    const monthOnly = { year: parts.year, month: parts.month, day: 1 };
    if (!latestMonthParts || compareCalendarDateParts(monthOnly, latestMonthParts) > 0) {
      latestMonthParts = monthOnly;
    }
  }

  const fallbackParts = getBrazilDateParts(fallback);
  return latestMonthParts ?? { year: fallbackParts.year, month: fallbackParts.month, day: 1 };
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

  getAllRaw(): Ticket[] {
    return this.db
      .prepare(`SELECT * FROM tickets ORDER BY id DESC`)
      .all() as Ticket[];
  }

  registerTicketExitEvents(missingTickets: Ticket[], referenceDate = new Date()): void {
    if (missingTickets.length === 0) return;

    const brazilNow = getBrazilDateParts(referenceDate);
    const exitedAt = referenceDate.toISOString();
    const exitedMonth = monthKeyFromParts({ year: brazilNow.year, month: brazilNow.month, day: 1 });
    const exitedLabel = createBrazilMonthLabel(brazilNow.year, brazilNow.month);

    const insertEvent = this.db.prepare(`
      INSERT OR IGNORE INTO ticket_exit_events (
        ticket_id,
        sla_solution_date,
        exited_at,
        exited_month,
        exited_label,
        resolved_on_time,
        resolved_late
      )
      VALUES (
        @ticket_id,
        @sla_solution_date,
        @exited_at,
        @exited_month,
        @exited_label,
        @resolved_on_time,
        @resolved_late
      )
    `);

    this.db.transaction(() => {
      for (const ticket of missingTickets) {
        const dueAt = parseCalendarDateParts(ticket.slaSolutionDate);
        const resolvedOnTime = dueAt && isOnTimeByBrazilCalendar(brazilNow, dueAt) ? 1 : 0;
        const resolvedLate = dueAt && !isOnTimeByBrazilCalendar(brazilNow, dueAt) ? 1 : 0;

        insertEvent.run({
          ticket_id: ticket.id,
          sla_solution_date: ticket.slaSolutionDate ?? null,
          exited_at: exitedAt,
          exited_month: exitedMonth,
          exited_label: exitedLabel,
          resolved_on_time: resolvedOnTime,
          resolved_late: resolvedLate,
        });
      }
    })();
  }

  purgeOldTicketExitEvents(referenceDate = new Date(), monthsToKeep = 3): void {
    const safeMonthsToKeep = Math.max(1, monthsToKeep);
    const brazilNow = getBrazilDateParts(referenceDate);
    const currentMonth = { year: brazilNow.year, month: brazilNow.month, day: 1 };
    const oldestMonthToKeep = addMonthsToParts(currentMonth, -(safeMonthsToKeep - 1));
    const oldestKeyToKeep = monthKeyFromParts(oldestMonthToKeep);

    this.db
      .prepare(`DELETE FROM ticket_exit_events WHERE exited_month < ?`)
      .run(oldestKeyToKeep);
  }

  getMonthlyAnalytics(months = 3): TicketMonthlyAnalyticsDto {
    const totalMonths = Math.max(1, Math.min(months, 12));
    const events = this.db
      .prepare(`SELECT * FROM ticket_exit_events ORDER BY exited_month ASC, ticket_id ASC`)
      .all() as TicketExitEvent[];

    const anchorMonth = getAnalyticsAnchorMonthPartsFromExitEvents(events, new Date());
    const firstMonth = addMonthsToParts(anchorMonth, -(totalMonths - 1));
    const monthMap = new Map<string, TicketMonthlyAnalyticsItem>();

    for (let index = 0; index < totalMonths; index++) {
      const current = addMonthsToParts(firstMonth, index);
      const key = monthKeyFromParts(current);
      monthMap.set(key, {
        month: key,
        label: createBrazilMonthLabel(current.year, current.month),
        resolved_on_time: 0,
        resolved_late: 0,
      });
    }

    for (const event of events) {
      const bucket = monthMap.get(event.exited_month);
      if (bucket) {
        bucket.resolved_on_time += event.resolved_on_time;
        bucket.resolved_late += event.resolved_late;
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
