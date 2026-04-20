import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TicketsService } from '../tickets/tickets.service';

interface RawTicket {
  [key: string]: unknown;
}

const FINAL_STATUS_KEYWORDS = ['cancelado', 'resolvido', 'fechado'];
const DIAGNOSTIC_TICKET_IDS = new Set([224615, 224608, 224605, 224576, 224570]);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private lastSyncAt: Date | null = null;
  private readonly minIntervalMs: number;
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly queryParams: Record<string, string>;

  constructor(
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
  ) {
    this.minIntervalMs =
      Number(config.get('MOVIDESK_SYNC_MIN_INTERVAL_SECONDS') ?? 25) * 1000;
    this.apiUrl = config.get<string>('MOVIDESK_API_URL') ?? '';
    this.apiToken = config.get<string>('MOVIDESK_API_TOKEN') ?? '';

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

  private normalizeTicket(ticket: RawTicket): Record<string, unknown> | null {
    const id = this.getNested(ticket, 'id');
    if (id === null || id === undefined) return null;

    const numId = Number(id);
    if (isNaN(numId)) return null;

    if (DIAGNOSTIC_TICKET_IDS.has(numId)) {
      this.logRawTicketDiagnostics(numId, ticket);
    }

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
    let closedAt = (
      String(
        this.getNested(
          ticket,
          'closedDate',
          'closedDateTime',
          'resolvedDate',
          'resolvedDateTime',
        ) ?? '',
      )
    ).trim() || null;

    const isFinalStatus = this.isFinalStatus(status);

    if (!closedAt && isFinalStatus) {
      closedAt = (
        String(
          this.getNested(
            ticket,
            'statusChangedDate',
            'statusChangedDateTime',
            'actionDate',
            'actionDateTime',
            'lastActionDate',
            'lastActionDateTime',
            'lastUpdate',
            'lastUpdateDate',
          ) ?? '',
        )
      ).trim() || null;
    }

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

  private logRawTicketDiagnostics(ticketId: number, ticket: RawTicket) {
    const rawSnapshot = {
      id: ticketId,
      status: this.getNested(ticket, 'status', 'status.name', 'statusName', 'baseStatus'),
      slaSolutionDate: this.getNested(ticket, 'slaSolutionDate'),
      slaSolutionDateTime: this.getNested(ticket, 'slaSolutionDateTime'),
      solutionDate: this.getNested(ticket, 'solutionDate'),
      solutionDateTime: this.getNested(ticket, 'solutionDateTime'),
      closedDate: this.getNested(ticket, 'closedDate'),
      closedDateTime: this.getNested(ticket, 'closedDateTime'),
      resolvedDate: this.getNested(ticket, 'resolvedDate'),
      resolvedDateTime: this.getNested(ticket, 'resolvedDateTime'),
      statusChangedDate: this.getNested(ticket, 'statusChangedDate'),
      statusChangedDateTime: this.getNested(ticket, 'statusChangedDateTime'),
      lastActionDate: this.getNested(ticket, 'lastActionDate'),
      lastActionDateTime: this.getNested(ticket, 'lastActionDateTime'),
      lastUpdate: this.getNested(ticket, 'lastUpdate'),
      lastUpdateDate: this.getNested(ticket, 'lastUpdateDate'),
      sla: this.getNested(ticket, 'sla'),
    };

    this.logger.log(`RAW_TICKET_DIAGNOSTICS | ${JSON.stringify(rawSnapshot)}`);
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

      const normalized: Record<string, unknown>[] = [];
      for (const item of data as RawTicket[]) {
        const n = this.normalizeTicket(item);
        if (n) normalized.push(n);
      }

      this.logAnalyticsDiagnostics(normalized);

      this.logger.log(`Fetched ${normalized.length} tickets from Movidesk API`);
      return normalized;
    } catch (err) {
      this.logger.error(`Error fetching tickets: ${(err as Error).message}`);
      return [];
    }
  }

  private logAnalyticsDiagnostics(tickets: Record<string, unknown>[]) {
    const finalTickets = tickets.filter((ticket) =>
      this.isFinalStatus(String(ticket['status'] ?? '')),
    );
    const withClosed = finalTickets.filter((ticket) => !!ticket['closed_at']);
    const withSla = finalTickets.filter((ticket) => !!ticket['slaSolutionDate']);
    const withBoth = finalTickets.filter(
      (ticket) => !!ticket['closed_at'] && !!ticket['slaSolutionDate'],
    );

    this.logger.log(
      [
        'ANALYTICS_DIAGNOSTICS',
        `final=${finalTickets.length}`,
        `with_closed=${withClosed.length}`,
        `with_sla=${withSla.length}`,
        `with_both=${withBoth.length}`,
      ].join(' | '),
    );

    const sample = finalTickets.slice(0, 5).map((ticket) => ({
      id: ticket['id'],
      status: ticket['status'],
      opened_at: ticket['opened_at'],
      closed_at: ticket['closed_at'],
      slaSolutionDate: ticket['slaSolutionDate'],
    }));

    if (sample.length > 0) {
      this.logger.log(`ANALYTICS_SAMPLE | ${JSON.stringify(sample)}`);
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
      this.ticketsService.upsertMany(tickets as any);
      this.lastSyncAt = now;
      this.logger.log(`Sync complete: ${tickets.length} tickets upserted`);
    }
  }
}
