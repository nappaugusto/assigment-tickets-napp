import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import {
  Ticket,
  TicketDto,
  TicketMonthlyAnalyticsDto,
  TicketMonthlyAnalyticsItem,
} from './ticket.entity';

const FINAL_STATUSES = [
  'cancelado',
  'resolvido',
  'resolvido - não atende',
  'fechado',
  'fechado pelo sistema',
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isFinal(status: string | null): boolean {
  if (!status) return false;
  return FINAL_STATUSES.includes(normalize(status));
}

function toDto(t: Ticket): TicketDto {
  return {
    id: Number(t.id),
    subject: t.subject,
    status: t.status,
    ownerTeam: t.ownerTeam,
    slaSolutionDate: toIsoString(t.slaSolutionDate),
    slaSolutionDateIsPaused: !!t.slaSolutionDateIsPaused,
    opened_at: toIsoString(t.opened_at),
    closed_at: toIsoString(t.closed_at),
    responsavel: t.responsavel,
    assigned_at: toIsoString(t.assigned_at),
  };
}

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@Injectable()
export class TicketsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async getAll(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(`SELECT * FROM tickets ORDER BY id DESC`);
    const rows = result.rows;
    return rows.map(toDto);
  }

  async getActive(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(`SELECT * FROM tickets ORDER BY id DESC`);
    const rows = result.rows;
    return rows
      .filter((t: Ticket) => !isFinal(t.status) && !isToday(toIsoString(t.opened_at)))
      .map(toDto);
  }

  async getNewToday(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(`SELECT * FROM tickets ORDER BY id DESC`);
    const rows = result.rows;
    return rows
      .filter((t: Ticket) => !isFinal(t.status) && isToday(toIsoString(t.opened_at)))
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
      `
        UPDATE tickets
        SET responsavel = $1,
            assigned_at = NOW(),
            assignment_override = 'local_assigned',
            updated_at = NOW()
        WHERE id = $2
      `,
      [responsavel, id],
    );
  }

  async unassign(id: number): Promise<void> {
    await this.db.query(
      `
        UPDATE tickets
        SET responsavel = NULL,
            assigned_at = NULL,
            assignment_override = 'local_unassigned',
            updated_at = NOW()
        WHERE id = $1
      `,
      [id],
    );
  }

  async upsertMany(tickets: Partial<Ticket>[]): Promise<void> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      for (const t of tickets) {
        await client.query(
          `
            INSERT INTO tickets (
              id,
              subject,
              status,
              "ownerTeam",
              "slaSolutionDate",
              "slaSolutionDateIsPaused",
              opened_at,
              closed_at,
              responsavel,
              assigned_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (id) DO UPDATE SET
              subject = EXCLUDED.subject,
              status = EXCLUDED.status,
              "ownerTeam" = EXCLUDED."ownerTeam",
              "slaSolutionDate" = EXCLUDED."slaSolutionDate",
              "slaSolutionDateIsPaused" = EXCLUDED."slaSolutionDateIsPaused",
              opened_at = EXCLUDED.opened_at,
              closed_at = EXCLUDED.closed_at,
              responsavel = CASE
                WHEN tickets.assignment_override = 'local_assigned' THEN tickets.responsavel
                WHEN tickets.assignment_override = 'local_unassigned' THEN NULL
                ELSE EXCLUDED.responsavel
              END,
              assigned_at = CASE
                WHEN tickets.assignment_override = 'local_assigned' THEN tickets.assigned_at
                WHEN tickets.assignment_override = 'local_unassigned' THEN NULL
                ELSE EXCLUDED.assigned_at
              END,
              updated_at = NOW()
          `,
          [
            t.id,
            t.subject ?? null,
            t.status ?? null,
            t.ownerTeam ?? null,
            toIsoString(t.slaSolutionDate) ?? null,
            !!t.slaSolutionDateIsPaused,
            toIsoString(t.opened_at) ?? null,
            toIsoString(t.closed_at) ?? null,
            t.responsavel ?? null,
            toIsoString(t.assigned_at) ?? null,
          ],
        );
      }

      if (tickets.length > 0) {
        await client.query(`DELETE FROM tickets WHERE id <> ALL($1::bigint[])`, [
          tickets.map((ticket) => Number(ticket.id)),
        ]);
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
      `
        SELECT DISTINCT responsavel
        FROM tickets
        WHERE responsavel IS NOT NULL
        ORDER BY responsavel
      `,
    );
    return result.rows.map((r: { responsavel: string }) => r.responsavel);
  }

  async getMonthlyAnalytics(months = 6): Promise<TicketMonthlyAnalyticsDto> {
    const totalMonths = Math.max(1, Math.min(months, 24));
    const result = await this.db.query<Ticket>(`SELECT * FROM tickets ORDER BY id DESC`);
    const rows = result.rows;

    const now = new Date();
    const firstMonth = startOfMonth(addMonths(now, -(totalMonths - 1)));
    const monthMap = new Map<string, TicketMonthlyAnalyticsItem>();

    for (let index = 0; index < totalMonths; index++) {
      const current = addMonths(firstMonth, index);
      const key = monthKey(current);
      monthMap.set(key, {
        month: key,
        label: current.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }),
        opened: 0,
        breached: 0,
        resolved_on_time: 0,
        resolved_late: 0,
      });
    }

    for (const ticket of rows) {
      const openedAt = parseIsoDate(toIsoString(ticket.opened_at));
      const closedAt = parseIsoDate(toIsoString(ticket.closed_at));
      const slaAt = parseIsoDate(toIsoString(ticket.slaSolutionDate));

      if (openedAt) {
        const bucket = monthMap.get(monthKey(openedAt));
        if (bucket) bucket.opened += 1;
      }

      if (closedAt && slaAt) {
        const bucket = monthMap.get(monthKey(closedAt));
        if (bucket) {
          if (closedAt.getTime() <= slaAt.getTime()) {
            bucket.resolved_on_time += 1;
          } else {
            bucket.resolved_late += 1;
          }
        }
      }

      if (slaAt) {
        const bucket = monthMap.get(monthKey(slaAt));
        const breached =
          (!closedAt && slaAt.getTime() < now.getTime()) ||
          (!!closedAt && closedAt.getTime() > slaAt.getTime());

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
