import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
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
const DEFAULT_ANALYTICS_MONTHS = 4;
const TICKET_RETENTION_MONTHS = 5;

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
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
  return FINAL_STATUS_KEYWORDS.some((keyword) =>
    normalizedStatus.includes(keyword),
  );
}

function isActive(ticket: Ticket): boolean {
  return !isFinal(ticket.status);
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
    last_update: t.last_update,
    responsavel: t.responsavel,
    assigned_at: t.assigned_at,
    trello_card_id: t.trello_card_id,
    trello_card_url: t.trello_card_url,
    trello_card_name: t.trello_card_name,
    trello_card_created_at: t.trello_card_created_at,
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

function parseCalendarDateParts(
  value: string | null,
): CalendarDateParts | null {
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

function compareCalendarDateParts(
  a: CalendarDateParts,
  b: CalendarDateParts,
): number {
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

function addMonthsToParts(
  parts: CalendarDateParts,
  delta: number,
): CalendarDateParts {
  const date = new Date(parts.year, parts.month - 1 + delta, 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: 1,
  };
}

function getOldestMonthToKeep(months: number): string {
  const today = getBrazilDateParts(new Date());
  const anchorMonth = { year: today.year, month: today.month, day: 1 };
  return monthKeyFromParts(addMonthsToParts(anchorMonth, -(months - 1)));
}

function parseTicketDateTime(value: string | null): Date | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const dotNetMatch = trimmed.match(/\/Date\((\d+)\)\//);
  if (dotNetMatch) {
    const parsed = new Date(Number(dotNetMatch[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/,
  );
  if (isoMatch) {
    const [
      ,
      year,
      month,
      day,
      hours = '00',
      minutes = '00',
      seconds = '00',
      fraction = '0',
    ] = isoMatch;
    const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      milliseconds,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const brMatch = trimmed.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (brMatch) {
    const [, day, month, year, hours = '00', minutes = '00', seconds = '00'] =
      brMatch;
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

@Injectable()
export class TicketsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async getAll(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY id DESC`,
    );
    return result.rows.map(toDto);
  }

  async getActive(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY id DESC`,
    );
    return result.rows
      .filter((t) => isActive(t) && !isToday(t.opened_at))
      .map(toDto);
  }

  async getNewToday(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY id DESC`,
    );
    return result.rows
      .filter((t) => isActive(t) && isToday(t.opened_at))
      .map(toDto);
  }

  async findById(id: number): Promise<TicketDto | undefined> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets WHERE id = $1 LIMIT 1`,
      [id],
    );
    const t = result.rows[0];
    return t ? toDto(t) : undefined;
  }

  async assign(id: number, responsavel: string): Promise<void> {
    await this.db.query(
      `UPDATE tickets
         SET responsavel = $1, assigned_at = now(), assignment_override = $2, updated_at = now()
         WHERE id = $3`,
      [responsavel, responsavel, id],
    );
  }

  async unassign(id: number): Promise<void> {
    await this.db.query(
      `UPDATE tickets
         SET responsavel = NULL, assigned_at = NULL, assignment_override = NULL, updated_at = now()
         WHERE id = $1`,
      [id],
    );
  }

  async attachTrelloCard(
    id: number,
    card: { id: string; url: string; name: string },
  ): Promise<TicketDto | undefined> {
    const result = await this.db.query<Ticket>(
      `UPDATE tickets
         SET trello_card_id = $1,
             trello_card_url = $2,
             trello_card_name = $3,
             trello_card_created_at = now(),
             updated_at = now()
         WHERE id = $4
         RETURNING *`,
      [card.id, card.url, card.name, id],
    );

    const ticket = result.rows[0];
    return ticket ? toDto(ticket) : undefined;
  }

  async detachTrelloCard(id: number): Promise<TicketDto | undefined> {
    const result = await this.db.query<Ticket>(
      `UPDATE tickets
         SET trello_card_id = NULL,
             trello_card_url = NULL,
             trello_card_name = NULL,
             trello_card_created_at = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
      [id],
    );

    const ticket = result.rows[0];
    return ticket ? toDto(ticket) : undefined;
  }

  async upsertMany(tickets: Partial<Ticket>[]): Promise<void> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');
      const syncedIds = new Set<number>();

      for (const t of tickets) {
        if (typeof t.id === 'number') {
          syncedIds.add(t.id);
        }

        await client.query(
          `
          INSERT INTO tickets (
            id, subject, status, "ownerTeam", "slaSolutionDate", "slaSolutionDateIsPaused",
            opened_at, closed_at, last_update, responsavel, assigned_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
          ON CONFLICT(id) DO UPDATE SET
            subject = excluded.subject,
            status = excluded.status,
            "ownerTeam" = excluded."ownerTeam",
            "slaSolutionDate" = excluded."slaSolutionDate",
            "slaSolutionDateIsPaused" = excluded."slaSolutionDateIsPaused",
            opened_at = excluded.opened_at,
            closed_at = excluded.closed_at,
            last_update = excluded.last_update,
            responsavel = excluded.responsavel,
            assigned_at = excluded.assigned_at,
            assignment_override = NULL,
            updated_at = now()
          `,
          [
            t.id,
            t.subject ?? null,
            t.status ?? null,
            t.ownerTeam ?? null,
            t.slaSolutionDate ?? null,
            !!t.slaSolutionDateIsPaused,
            t.opened_at ?? null,
            t.closed_at ?? null,
            t.last_update ?? null,
            t.responsavel ?? null,
            t.assigned_at ?? null,
          ],
        );
      }

      const oldestMonthToKeep = getOldestMonthToKeep(TICKET_RETENTION_MONTHS);
      const storedTickets = await client.query<
        Pick<Ticket, 'id' | 'status' | 'opened_at'>
      >(`SELECT id, status, opened_at FROM tickets`);

      for (const ticket of storedTickets.rows) {
        const openedAt = parseCalendarDateParts(ticket.opened_at);
        if (openedAt && monthKeyFromParts(openedAt) < oldestMonthToKeep) {
          await client.query(`DELETE FROM tickets WHERE id = $1`, [ticket.id]);
          continue;
        }

        if (!isFinal(ticket.status) && !syncedIds.has(ticket.id)) {
          await client.query(`DELETE FROM tickets WHERE id = $1`, [ticket.id]);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllResponsaveis(): Promise<string[]> {
    const result = await this.db.query<{ responsavel: string }>(
      `SELECT DISTINCT responsavel FROM tickets WHERE responsavel IS NOT NULL ORDER BY responsavel`,
    );
    return result.rows.map((r) => r.responsavel);
  }

  async getAllRaw(): Promise<Ticket[]> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY id DESC`,
    );
    return result.rows;
  }

  async getDashboardSnapshot(): Promise<{
    tickets: TicketDto[];
    newTickets: TicketDto[];
    monthlyAnalytics: TicketMonthlyAnalyticsDto;
  }> {
    const rows = await this.getAllRaw();
    return {
      tickets: rows
        .filter((t) => isActive(t) && !isToday(t.opened_at))
        .map(toDto),
      newTickets: rows
        .filter((t) => isActive(t) && isToday(t.opened_at))
        .map(toDto),
      monthlyAnalytics: this.buildMonthlyAnalytics(rows),
    };
  }

  async getMonthlyAnalytics(
    months = DEFAULT_ANALYTICS_MONTHS,
  ): Promise<TicketMonthlyAnalyticsDto> {
    const rows = await this.getAllRaw();
    return this.buildMonthlyAnalytics(rows, months);
  }

  private buildMonthlyAnalytics(
    rows: Ticket[],
    months = DEFAULT_ANALYTICS_MONTHS,
  ): TicketMonthlyAnalyticsDto {
    const totalMonths = Math.max(1, Math.min(months, 12));

    const today = getBrazilDateParts(new Date());
    const anchorMonth = { year: today.year, month: today.month, day: 1 };
    const firstMonth = addMonthsToParts(anchorMonth, -(totalMonths - 1));
    const monthMap = new Map<string, TicketMonthlyAnalyticsItem>();

    for (let index = 0; index < totalMonths; index++) {
      const current = addMonthsToParts(firstMonth, index);
      const key = monthKeyFromParts(current);
      monthMap.set(key, {
        month: key,
        label: createBrazilMonthLabel(current.year, current.month),
        opened: 0,
        resolved_on_time: 0,
        resolved_late: 0,
        sla_paused: 0,
      });
    }

    const oldestMonthToKeep = monthKeyFromParts(firstMonth);

    for (const ticket of rows) {
      const openedAt = parseCalendarDateParts(ticket.opened_at);
      const dueAt = parseTicketDateTime(ticket.slaSolutionDate);
      const lastUpdate = parseTicketDateTime(ticket.last_update);

      if (!openedAt) {
        continue;
      }

      const openedMonthKey = monthKeyFromParts(openedAt);
      if (openedMonthKey < oldestMonthToKeep) {
        continue;
      }

      const bucket = monthMap.get(openedMonthKey);
      if (!bucket) {
        continue;
      }

      bucket.opened += 1;

      if (ticket.slaSolutionDateIsPaused) {
        bucket.sla_paused += 1;
        continue;
      }

      if (!dueAt || !lastUpdate) {
        continue;
      }

      if (dueAt.getTime() > lastUpdate.getTime()) {
        bucket.resolved_on_time += 1;
      } else {
        bucket.resolved_late += 1;
      }
    }

    const analyticsMonths = Array.from(monthMap.values());
    const currentMonth = analyticsMonths[analyticsMonths.length - 1] ?? null;
    const activePausedCount = rows.filter(
      (ticket) => isActive(ticket) && !!ticket.slaSolutionDateIsPaused,
    ).length;

    return {
      generated_at: new Date().toISOString(),
      active_sla_paused: activePausedCount,
      months: analyticsMonths,
      current_month: currentMonth,
    };
  }
}
