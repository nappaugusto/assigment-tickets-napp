import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TicketsService } from '../tickets/tickets.service';

interface RawTicket {
  [key: string]: unknown;
}

const FINAL_STATUS_KEYWORDS = ['cancelado', 'resolvido', 'fechado'];

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private lastSyncAt: Date | null = null;
  private readonly minIntervalMs: number;
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly queryParams: Record<string, string>;
  private readonly debugDateFields: boolean;
  private readonly debugDateFieldsSampleSize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
  ) {
    this.minIntervalMs =
      Number(config.get('MOVIDESK_SYNC_MIN_INTERVAL_SECONDS') ?? 25) * 1000;
    this.apiUrl = config.get<string>('MOVIDESK_API_URL') ?? '';
    this.apiToken = config.get<string>('MOVIDESK_API_TOKEN') ?? '';
    this.debugDateFields =
      String(config.get('MOVIDESK_DEBUG_DATE_FIELDS') ?? '').toLowerCase() === 'true';
    this.debugDateFieldsSampleSize = Math.max(
      1,
      Number(config.get('MOVIDESK_DEBUG_DATE_FIELDS_SAMPLE_SIZE') ?? 5),
    );

    // Parse query params from env string
    const raw = config.get<string>('MOVIDESK_API_QUERY_PARAMS') ?? '';
    this.queryParams = this.parseQueryString(raw);
  }

  private parseQueryString(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const part of raw.split('&')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(part.slice(0, eqIdx));
      const value = decodeURIComponent(part.slice(eqIdx + 1));
      result[key] = value;
    }
    return result;
  }

  private getNested(obj: unknown, ...paths: string[]): unknown {
    for (const path of paths) {
      let current: unknown = obj;
      let found = true;
      for (const key of path.split('.')) {
        if (current && typeof current === 'object' && key in (current as object)) {
          current = (current as Record<string, unknown>)[key];
        } else {
          found = false;
          break;
        }
      }
      if (found && current !== null && current !== undefined && current !== '') {
        return current;
      }
    }
    return null;
  }

  private extractName(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      for (const key of ['name', 'businessName', 'title', 'value']) {
        if (obj[key]) return String(obj[key]).trim();
      }
    }
    if (Array.isArray(value)) {
      return (value as unknown[]).map((v) => this.extractName(v)).filter(Boolean).join(', ');
    }
    return String(value).trim();
  }

  private normalizeStatus(status: string): string {
    return status
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private isFinalStatus(status: string): boolean {
    const normalized = this.normalizeStatus(status);
    return FINAL_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword));
  }

  private resolveClosedAt(ticket: RawTicket): string | null {
    const explicitValue = this.getNested(
      ticket,
      'closedDate',
      'closedDateTime',
      'resolvedDate',
      'resolvedDateTime',
    );

    const explicitString = String(explicitValue ?? '').trim();
    return explicitString || null;
  }

  private normalizeTicket(ticket: RawTicket): Record<string, unknown> | null {
    const id = this.getNested(ticket, 'id');
    if (id === null || id === undefined) return null;

    const numId = Number(id);
    if (isNaN(numId)) return null;

    const status = this.extractName(
      this.getNested(ticket, 'status', 'status.name', 'statusName', 'baseStatus'),
    );
    const ownerTeam = this.extractName(
      this.getNested(ticket, 'ownerTeam', 'ownerTeam.name', 'ownerTeam.businessName', 'team.name'),
    );
    const subject = String(this.getNested(ticket, 'subject', 'title') ?? '').trim();
    const slaSolutionDate = this.resolveSolutionDueDate(ticket);

    const slaPausedRaw = this.getNested(ticket, 'slaSolutionDateIsPaused', 'sla.isPaused');
    const slaSolutionDateIsPaused =
      typeof slaPausedRaw === 'boolean'
        ? slaPausedRaw
        : String(slaPausedRaw ?? '').toLowerCase() === 'true';

    const openedAt = (
      String(this.getNested(ticket, 'createdDate', 'createdDateTime', 'createdAt') ?? '')
    ).trim() || null;
    const closedAt = this.resolveClosedAt(ticket);

    const isFinalStatus = this.isFinalStatus(status);

    const responsavelRaw = this.getNested(
      ticket,
      'responsavel',
      'owner',
      'owner.businessName',
      'owner.name',
      'ownerPerson.businessName',
    );
    const responsavel = this.extractName(responsavelRaw) || null;

    return {
      id: numId,
      subject,
      status,
      ownerTeam,
      slaSolutionDate,
      slaSolutionDateIsPaused,
      opened_at: openedAt,
      closed_at: closedAt,
      responsavel,
      assigned_at: null,
    };
  }

  private resolveSolutionDueDate(ticket: RawTicket): string | null {
    const explicitValue = this.getNested(
      ticket,
      'slaSolutionDate',
      'slaSolutionDateTime',
      'solutionDate',
      'solutionDateTime',
      'sla.solutionDate',
      'sla.solutionDateTime',
      'sla.solutionDeadline',
      'sla.solutionForecast',
      'sla.solutionForecastDate',
      'sla.predictedSolutionDate',
      'sla.estimatedSolutionDate',
    );

    const explicitString = String(explicitValue ?? '').trim();
    if (explicitString) return explicitString;

    const slaObject = this.getNested(ticket, 'sla');
    if (slaObject && typeof slaObject === 'object' && !Array.isArray(slaObject)) {
      const entries = Object.entries(slaObject as Record<string, unknown>);
      const preferredEntry = entries.find(([key, value]) => {
        const normalizedKey = this.normalizeStatus(key);
        if (!value) return false;
        return (
          normalizedKey.includes('solution') ||
          normalizedKey.includes('solucao') ||
          normalizedKey.includes('previsao')
        );
      });

      const preferredString = String(preferredEntry?.[1] ?? '').trim();
      if (preferredString) return preferredString;
    }

    return null;
  }

  private buildDateFieldSnapshot(ticket: RawTicket): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      id: this.getNested(ticket, 'id'),
      status: this.extractName(
        this.getNested(ticket, 'status', 'status.name', 'statusName', 'baseStatus'),
      ),
      available_keys: Object.keys(ticket).sort(),
      createdDate: this.getNested(ticket, 'createdDate'),
      createdDateTime: this.getNested(ticket, 'createdDateTime'),
      closedDate: this.getNested(ticket, 'closedDate'),
      closedDateTime: this.getNested(ticket, 'closedDateTime'),
      resolvedDate: this.getNested(ticket, 'resolvedDate'),
      resolvedDateTime: this.getNested(ticket, 'resolvedDateTime'),
      statusChangedDate: this.getNested(ticket, 'statusChangedDate'),
      statusChangedDateTime: this.getNested(ticket, 'statusChangedDateTime'),
      slaSolutionDate: this.getNested(ticket, 'slaSolutionDate'),
      slaSolutionDateTime: this.getNested(ticket, 'slaSolutionDateTime'),
      solutionDate: this.getNested(ticket, 'solutionDate'),
      solutionDateTime: this.getNested(ticket, 'solutionDateTime'),
      slaSolutionDateIsPaused: this.getNested(ticket, 'slaSolutionDateIsPaused'),
      raw_sla: this.getNested(ticket, 'sla'),
    };

    return snapshot;
  }

  private logDateFieldDiagnostics(tickets: RawTicket[]): void {
    const selectedFields = this.queryParams['$select'] ?? '(not provided)';
    const expandedFields = this.queryParams['$expand'] ?? '(not provided)';

    this.logger.warn(
      [
        'MOVIDESK_DATE_FIELDS_DEBUG',
        `selected=${selectedFields}`,
        `expanded=${expandedFields}`,
        `sample_size=${Math.min(tickets.length, this.debugDateFieldsSampleSize)}`,
      ].join(' | '),
    );

    const samples = tickets.slice(0, this.debugDateFieldsSampleSize);
    for (const ticket of samples) {
      this.logger.warn(
        `MOVIDESK_DATE_FIELDS_SAMPLE ${JSON.stringify(this.buildDateFieldSnapshot(ticket))}`,
      );
    }
  }

  private async fetchFromApi(): Promise<Record<string, unknown>[]> {
    const params: Record<string, string> = { ...this.queryParams };
    if (this.apiToken) params['token'] = this.apiToken;

    try {
      const response = await axios.get(this.apiUrl, {
        params,
        timeout: Number(this.config.get('MOVIDESK_API_TIMEOUT') ?? 10000),
        headers: { accept: 'application/json', 'user-agent': 'NestJS/1.0' },
      });

      let data = response.data as unknown;
      if (Array.isArray(data)) {
        // ok
      } else if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        for (const key of ['tickets', 'data', 'items', 'result', 'results']) {
          if (Array.isArray(obj[key])) {
            data = obj[key];
            break;
          }
        }
      }

      if (!Array.isArray(data)) return [];

      if (this.debugDateFields) {
        this.logDateFieldDiagnostics(data as RawTicket[]);
      }

      const normalized: Record<string, unknown>[] = [];
      for (const item of data as RawTicket[]) {
        const n = this.normalizeTicket(item);
        if (n) normalized.push(n);
      }

      this.logger.log(`Fetched ${normalized.length} tickets from Movidesk API`);
      return normalized;
    } catch (err) {
      this.logger.error(`Error fetching tickets: ${(err as Error).message}`);
      return [];
    }
  }

  async sync(force = false): Promise<void> {
    const now = new Date();
    if (
      !force &&
      this.lastSyncAt &&
      now.getTime() - this.lastSyncAt.getTime() < this.minIntervalMs
    ) {
      this.logger.debug('Sync skipped (too soon)');
      return;
    }

    const tickets = await this.fetchFromApi();
    if (tickets.length > 0) {
      const existingTickets = this.ticketsService.getAllRaw();
      const incomingIds = new Set(
        tickets
          .map((ticket) => Number((ticket as Record<string, unknown>).id))
          .filter((id) => Number.isFinite(id)),
      );
      const missingTickets = existingTickets.filter((ticket) => !incomingIds.has(ticket.id));

      this.ticketsService.registerTicketExitEvents(missingTickets, now);
      this.ticketsService.upsertMany(tickets as any);
      this.lastSyncAt = now;
      this.logger.log(`Sync complete: ${tickets.length} tickets upserted`);
    }
  }
}
