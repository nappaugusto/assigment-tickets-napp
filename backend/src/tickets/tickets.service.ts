import { BadGatewayException, Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import {
  Ticket,
  TicketAiTriagePreview,
  TicketDetailDto,
  TicketDetailInteractionDto,
  TicketDto,
  TicketMonthlyAnalyticsDto,
  TicketMonthlyAnalyticsItem,
  SimilarTicketDto,
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

type RawMovideskRecord = Record<string, unknown>;

interface LatestTriagePreviewRow {
  ticket_id: number;
  id: number;
  status: 'completed';
  triage: {
    priority?: unknown;
    summary?: unknown;
    likelyArea?: unknown;
    confidence?: unknown;
  } | null;
  updated_at: string;
  finished_at: string | null;
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

function asTriageEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function toTriagePreview(row: LatestTriagePreviewRow): TicketAiTriagePreview | null {
  if (!row.triage) return null;

  return {
    id: row.id,
    status: row.status,
    priority: asTriageEnum(
      row.triage.priority,
      ['baixa', 'media', 'alta', 'critica'],
      'media',
    ),
    summary: String(row.triage.summary || 'Triagem salva sem resumo.'),
    likelyArea: String(row.triage.likelyArea || 'Área não identificada'),
    confidence: asTriageEnum(row.triage.confidence, ['baixa', 'media', 'alta'], 'media'),
    updated_at: row.updated_at,
    finished_at: row.finished_at,
  };
}

function toDto(t: Ticket, aiTriage: TicketAiTriagePreview | null = null): TicketDto {
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
    ai_triage: aiTriage,
  };
}

function getRecord(value: unknown): RawMovideskRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawMovideskRecord)
    : null;
}

function getString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getArray(value: unknown): RawMovideskRecord[] {
  return Array.isArray(value)
    ? value.map(getRecord).filter((item): item is RawMovideskRecord => !!item)
    : [];
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };

  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (normalized.startsWith('#')) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entities[normalized] ?? match;
  });
}

function stripHtml(value: unknown): string {
  const html = getString(value) ?? '';
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const text = getString(value);
    if (text) return text;
  }
  return null;
}

function extractDocumentIds(value: string | null | undefined) {
  const text = String(value ?? '');
  return Array.from(new Set(text.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) ?? []))
    .map((item) => item.replace(/\D/g, ''))
    .filter((item) => item.length >= 14);
}

function extractSimilarityTerms(value: string | null | undefined) {
  const stopWords = new Set([
    'com',
    'das',
    'dos',
    'para',
    'por',
    'sem',
    'uma',
    'nos',
    'nas',
    'erro',
    'ticket',
    'cnpj',
  ]);

  return Array.from(
    new Set(
      normalize(String(value ?? ''))
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !stopWords.has(term)),
    ),
  ).slice(0, 18);
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
  private readonly movideskApiUrl: string;
  private readonly movideskToken: string;
  private readonly movideskTimeout: number;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Pool,
    private readonly config: ConfigService,
  ) {
    this.movideskApiUrl =
      config.get<string>('MOVIDESK_API_URL') ??
      'https://api.movidesk.com/public/v1/tickets';
    this.movideskToken =
      config.get<string>('MOVIDESK_API_TOKEN') ??
      config.get<string>('MOVIDESK_TOKEN') ??
      '';
    this.movideskTimeout = Number(config.get('MOVIDESK_API_TIMEOUT') ?? 10000);
  }

  async getAll(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY id DESC`,
    );
    return result.rows.map((ticket) => toDto(ticket));
  }

  async getActive(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY id DESC`,
    );
    return result.rows
      .filter((t) => isActive(t) && !isToday(t.opened_at))
      .map((ticket) => toDto(ticket));
  }

  async getNewToday(): Promise<TicketDto[]> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets ORDER BY id DESC`,
    );
    return result.rows
      .filter((t) => isActive(t) && isToday(t.opened_at))
      .map((ticket) => toDto(ticket));
  }

  async findById(id: number): Promise<TicketDto | undefined> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets WHERE id = $1 LIMIT 1`,
      [id],
    );
    const t = result.rows[0];
    return t ? toDto(t) : undefined;
  }

  async getDetail(id: number): Promise<TicketDetailDto> {
    if (!this.movideskToken) {
      const cached = await this.getCachedDetail(id);
      if (cached) return cached;
      throw new BadGatewayException('Token do Movidesk não configurado.');
    }

    try {
      const response = await axios.get<RawMovideskRecord>(this.movideskApiUrl, {
        params: { token: this.movideskToken, id },
        timeout: this.movideskTimeout,
      });
      return this.toDetailDto(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cached = await this.getCachedDetail(id, message);
      if (cached) return cached;
      throw new BadGatewayException(`Não foi possível buscar detalhes do ticket no Movidesk: ${message}`);
    }
  }

  private async getCachedDetail(id: number, cause?: string): Promise<TicketDetailDto | null> {
    const result = await this.db.query<Ticket>(
      `SELECT * FROM tickets WHERE id = $1 LIMIT 1`,
      [id],
    );
    const ticket = result.rows[0];
    if (!ticket) return null;

    const unavailableReason = cause
      ? ` Detalhes completos temporariamente indisponíveis: ${cause}`
      : '';

    return {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      urgency: null,
      category: null,
      ownerTeam: ticket.ownerTeam,
      ownerName: ticket.responsavel,
      createdDate: ticket.opened_at,
      lastUpdate: ticket.last_update,
      slaSolutionDate: ticket.slaSolutionDate,
      clients: [],
      serviceFull: [],
      tags: [],
      summary:
        `Exibindo dados locais em cache do ticket #${ticket.id}.${unavailableReason}`.trim(),
      interactions: [],
      rawActionCount: 0,
    };
  }

  private toDetailDto(ticket: RawMovideskRecord): TicketDetailDto {
    const actions = getArray(ticket.actions)
      .map((action) => this.toInteractionDto(action))
      .filter((action) => !action.isDeleted)
      .sort((a, b) => {
        const left = a.createdDate ? new Date(a.createdDate).getTime() : 0;
        const right = b.createdDate ? new Date(b.createdDate).getTime() : 0;
        return left - right;
      });
    const firstInteraction = actions.find((action) => action.text)?.text ?? '';
    const owner = getRecord(ticket.owner);
    const clients = getArray(ticket.clients).map((client) => {
      const organization = getRecord(client.organization);
      return {
        name: firstNonEmpty(client.businessName, client.name),
        email: firstNonEmpty(client.email),
        organization: firstNonEmpty(organization?.businessName, organization?.name),
      };
    });

    return {
      id: getNumber(ticket.id) ?? 0,
      subject: firstNonEmpty(ticket.subject),
      status: firstNonEmpty(ticket.status),
      urgency: firstNonEmpty(ticket.urgency),
      category: firstNonEmpty(ticket.category),
      ownerTeam: firstNonEmpty(ticket.ownerTeam),
      ownerName: firstNonEmpty(owner?.businessName, owner?.name),
      createdDate: firstNonEmpty(ticket.createdDate, ticket.openedIn),
      lastUpdate: firstNonEmpty(ticket.lastUpdate),
      slaSolutionDate: firstNonEmpty(ticket.slaSolutionDate),
      clients,
      serviceFull: Array.isArray(ticket.serviceFull)
        ? ticket.serviceFull.map(String).filter(Boolean)
        : [ticket.serviceFirstLevel, ticket.serviceSecondLevel, ticket.serviceThirdLevel]
            .map((value) => getString(value))
            .filter((value): value is string => !!value),
      tags: Array.isArray(ticket.tags) ? ticket.tags.map(String).filter(Boolean) : [],
      summary:
        firstInteraction ||
        stripHtml(ticket.description) ||
        firstNonEmpty(ticket.subject) ||
        'Sem descrição disponível.',
      interactions: actions,
      rawActionCount: getNumber(ticket.actionCount) ?? actions.length,
    };
  }

  private toInteractionDto(action: RawMovideskRecord): TicketDetailInteractionDto {
    const createdBy = getRecord(action.createdBy);
    const type = getNumber(action.type) === 2 ? 'public' : 'internal';
    return {
      id: getNumber(action.id),
      type,
      origin: getNumber(action.origin),
      status: firstNonEmpty(action.status),
      author: firstNonEmpty(createdBy?.businessName, createdBy?.name),
      authorEmail: firstNonEmpty(createdBy?.email),
      createdDate: firstNonEmpty(action.createdDate),
      text: stripHtml(firstNonEmpty(action.description, action.htmlDescription)),
      isDeleted: Boolean(action.isDeleted),
    };
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

  private async getLatestCompletedTriagePreviews(ticketIds: number[]) {
    if (!ticketIds.length) return new Map<number, TicketAiTriagePreview>();

    const result = await this.db.query<LatestTriagePreviewRow>(
      `
      SELECT DISTINCT ON (ticket_id)
             ticket_id, id, status, triage, updated_at, finished_at
        FROM ticket_ai_triages
       WHERE ticket_id = ANY($1::int[])
         AND status = 'completed'
         AND triage IS NOT NULL
       ORDER BY ticket_id, created_at DESC, id DESC
      `,
      [ticketIds],
    );

    return new Map(
      result.rows
        .map((row) => [row.ticket_id, toTriagePreview(row)] as const)
        .filter((item): item is readonly [number, TicketAiTriagePreview] =>
          Boolean(item[1]),
        ),
    );
  }

  async getDashboardSnapshot(): Promise<{
    tickets: TicketDto[];
    newTickets: TicketDto[];
    monthlyAnalytics: TicketMonthlyAnalyticsDto;
  }> {
    const rows = await this.getAllRaw();
    const activeTickets = rows.filter(isActive);
    const triagePreviews = await this.getLatestCompletedTriagePreviews(
      activeTickets.map((ticket) => ticket.id),
    );

    return {
      tickets: activeTickets
        .filter((t) => !isToday(t.opened_at))
        .map((ticket) => toDto(ticket, triagePreviews.get(ticket.id) ?? null)),
      newTickets: activeTickets
        .filter((t) => isToday(t.opened_at))
        .map((ticket) => toDto(ticket, triagePreviews.get(ticket.id) ?? null)),
      monthlyAnalytics: this.buildMonthlyAnalytics(rows),
    };
  }

  async getMonthlyAnalytics(
    months = DEFAULT_ANALYTICS_MONTHS,
    team?: string,
    responsavel?: string,
  ): Promise<TicketMonthlyAnalyticsDto> {
    const rows = await this.getAllRaw();
    return this.buildMonthlyAnalytics(rows, months, team, responsavel);
  }

  async getSimilarTickets(id: number, limit = 6): Promise<SimilarTicketDto[]> {
    const rows = await this.getAllRaw();
    const target = rows.find((ticket) => ticket.id === id);
    if (!target) return [];

    const targetTerms = extractSimilarityTerms(target.subject);
    const targetDocs = extractDocumentIds(target.subject);
    const activeRows = rows.filter((ticket) => ticket.id !== id);
    const triagePreviews = await this.getLatestCompletedTriagePreviews(
      activeRows.map((ticket) => ticket.id),
    );

    return activeRows
      .map((ticket) => {
        let score = 0;
        const reasons: string[] = [];
        const subjectTerms = extractSimilarityTerms(ticket.subject);
        const subjectDocs = extractDocumentIds(ticket.subject);
        const commonTerms = targetTerms.filter((term) => subjectTerms.includes(term));
        const commonDocs = targetDocs.filter((doc) => subjectDocs.includes(doc));

        if (commonDocs.length) {
          score += commonDocs.length * 8;
          reasons.push('Mesmo CNPJ no assunto');
        }

        if (commonTerms.length) {
          score += commonTerms.length * 2;
          reasons.push(`${commonTerms.slice(0, 4).join(', ')} no assunto`);
        }

        if (target.ownerTeam && ticket.ownerTeam === target.ownerTeam) {
          score += 3;
          reasons.push('Mesmo time');
        }

        if (target.responsavel && ticket.responsavel === target.responsavel) {
          score += 2;
          reasons.push('Mesmo responsável');
        }

        if (ticket.trello_card_url) {
          score += 1;
          reasons.push('Já virou demanda técnica');
        }

        return {
          ticket,
          score,
          reasons: reasons.slice(0, 3),
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.ticket.id - a.ticket.id)
      .slice(0, Math.max(1, Math.min(limit, 12)))
      .map(({ ticket, score, reasons }) => ({
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        ownerTeam: ticket.ownerTeam,
        responsavel: ticket.responsavel,
        opened_at: ticket.opened_at,
        slaSolutionDate: ticket.slaSolutionDate,
        trello_card_url: ticket.trello_card_url,
        score,
        reasons,
        ai_triage: triagePreviews.get(ticket.id) ?? null,
      }));
  }

  private buildMonthlyAnalytics(
    rows: Ticket[],
    months = DEFAULT_ANALYTICS_MONTHS,
    team?: string,
    responsavel?: string,
  ): TicketMonthlyAnalyticsDto {
    const totalMonths = Math.max(1, Math.min(months, 12));
    const normalizedTeam = team?.trim() ? normalize(team.trim()) : '';
    const normalizedResponsavel = responsavel?.trim()
      ? normalize(responsavel.trim())
      : '';
    const filteredRows = rows.filter((ticket) => {
      if (
        normalizedTeam &&
        normalize(ticket.ownerTeam ?? '') !== normalizedTeam
      ) {
        return false;
      }

      if (
        normalizedResponsavel &&
        normalize(ticket.responsavel ?? '') !== normalizedResponsavel
      ) {
        return false;
      }

      return true;
    });

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

    for (const ticket of filteredRows) {
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
    const activePausedCount = filteredRows.filter(
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
