import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TicketsService } from '../tickets/tickets.service';

@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);
  private cachedPeople: string[] = [];
  private cachedAt: Date | null = null;
  private readonly cacheMs: number;
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly assignmentTeams: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
  ) {
    this.cacheMs =
      Number(config.get('MOVIDESK_PERSONS_CACHE_SECONDS') ?? 300) * 1000;
    this.apiUrl = config.get<string>('MOVIDESK_PERSONS_API_URL') ?? '';
    this.token = config.get<string>('MOVIDESK_API_TOKEN') ?? '';
    const teamNames = config.get<string>('ASSIGNMENT_TEAM_NAMES') ?? '';
    this.assignmentTeams = new Set(
      teamNames
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private isCacheValid(): boolean {
    if (!this.cachedAt || this.cachedPeople.length === 0) return false;
    return Date.now() - this.cachedAt.getTime() < this.cacheMs;
  }

  private matchesTeam(person: Record<string, unknown>): boolean {
    if (this.assignmentTeams.size === 0) return true;
    const teams = (person['teams'] as unknown[]) ?? [];
    for (const t of teams) {
      const name =
        typeof t === 'object' && t !== null
          ? String((t as Record<string, unknown>)['name'] ?? '')
          : String(t ?? '');
      if (this.assignmentTeams.has(name.toLowerCase())) return true;
    }
    return false;
  }

  async fetchAssignmentPeople(): Promise<string[]> {
    if (this.isCacheValid()) return this.cachedPeople;

    try {
      const pageSize = Number(this.config.get('MOVIDESK_PERSONS_PAGE_SIZE') ?? 200);
      const maxPages = Number(this.config.get('MOVIDESK_PERSONS_MAX_PAGES') ?? 10);
      const rawParams = this.config.get<string>('MOVIDESK_PERSONS_QUERY_PARAMS') ?? '';

      const baseParams = this.parseQueryString(rawParams);
      baseParams['$top'] = String(pageSize);
      if (this.token) baseParams['token'] = this.token;

      const people = new Set<string>();

      for (let page = 0; page < maxPages; page++) {
        baseParams['$skip'] = String(page * pageSize);
        const resp = await axios.get(this.apiUrl, {
          params: baseParams,
          timeout: 10000,
          headers: { accept: 'application/json', 'user-agent': 'NestJS/1.0' },
        });

        const data = Array.isArray(resp.data) ? (resp.data as Record<string, unknown>[]) : [];
        if (data.length === 0) break;

        for (const person of data) {
          const profileType = Number(person['profileType'] ?? 0);
          const isActive = person['isActive'];
          if ((profileType === 1 || profileType === 3) && isActive && this.matchesTeam(person)) {
            const name = String(person['businessName'] ?? '').trim();
            if (name) people.add(name);
          }
        }

        if (data.length < pageSize) break;
      }

      // Fallback: names from tickets
      for (const r of this.ticketsService.getAllResponsaveis()) {
        people.add(r);
      }

      const sorted = Array.from(people).sort((a, b) => a.localeCompare(b));
      this.cachedPeople = sorted;
      this.cachedAt = new Date();
      return sorted;
    } catch (err) {
      this.logger.error(`Error fetching people: ${(err as Error).message}`);
      // Fallback to ticket responsaveis
      const fallback = this.ticketsService.getAllResponsaveis();
      return fallback;
    }
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
}
