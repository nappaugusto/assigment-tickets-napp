import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TicketsService } from '../tickets/tickets.service';

@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);
  private cachedPeople: string[] = [];
  private cachedDetailedPeople: AssignmentPersonDto[] = [];
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

  private getTeamNames(person: Record<string, unknown>): string[] {
    const teams = (person['teams'] as unknown[]) ?? [];
    return teams
      .map((team) => {
        if (team && typeof team === 'object') {
          return String((team as Record<string, unknown>)['name'] ?? '').trim();
        }
        return String(team ?? '').trim();
      })
      .filter(Boolean);
  }

  private matchesTeam(person: Record<string, unknown>): boolean {
    if (this.assignmentTeams.size === 0) return true;
    for (const name of this.getTeamNames(person)) {
      if (this.assignmentTeams.has(name.toLowerCase())) return true;
    }
    return false;
  }

  private ensureSelectFields(params: Record<string, string>): void {
    const requiredFields = [
      'id',
      'businessName',
      'email',
      'profileType',
      'isActive',
      'teams',
    ];
    const currentFields = new Set(
      String(params['$select'] ?? '')
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean),
    );

    for (const field of requiredFields) {
      currentFields.add(field);
    }

    params['$select'] = Array.from(currentFields).join(',');
  }

  private normalizePerson(
    person: Record<string, unknown>,
  ): AssignmentPersonDto | null {
    const id = String(person['id'] ?? '').trim();
    const businessName = String(person['businessName'] ?? '').trim();
    const email = String(person['email'] ?? person['emails'] ?? '').trim();
    const teams = this.getTeamNames(person);

    if (!id && !email && !businessName) return null;

    return {
      id: id || email || businessName,
      businessName,
      email: email || null,
      teams,
    };
  }

  private async fetchAssignmentPeopleFromApi(): Promise<AssignmentPersonDto[]> {
    const pageSize = Number(
      this.config.get('MOVIDESK_PERSONS_PAGE_SIZE') ?? 200,
    );
    const maxPages = Number(
      this.config.get('MOVIDESK_PERSONS_MAX_PAGES') ?? 10,
    );
    const rawParams =
      this.config.get<string>('MOVIDESK_PERSONS_QUERY_PARAMS') ?? '';

    const baseParams = this.parseQueryString(rawParams);
    this.ensureSelectFields(baseParams);
    baseParams['$top'] = String(pageSize);
    if (this.token) baseParams['token'] = this.token;

    const people = new Map<string, AssignmentPersonDto>();

    for (let page = 0; page < maxPages; page++) {
      baseParams['$skip'] = String(page * pageSize);
      const resp = await axios.get(this.apiUrl, {
        params: baseParams,
        timeout: 10000,
        headers: { accept: 'application/json', 'user-agent': 'NestJS/1.0' },
      });

      const data = Array.isArray(resp.data)
        ? (resp.data as Record<string, unknown>[])
        : [];
      if (data.length === 0) break;

      for (const person of data) {
        const profileType = Number(person['profileType'] ?? 0);
        const isActive = person['isActive'];
        if (
          (profileType === 1 || profileType === 3) &&
          isActive &&
          this.matchesTeam(person)
        ) {
          const normalized = this.normalizePerson(person);
          if (normalized) {
            people.set(normalized.id, normalized);
          }
        }
      }

      if (data.length < pageSize) break;
    }

    for (const name of await this.ticketsService.getAllResponsaveis()) {
      if (
        ![...people.values()].some((person) => person.businessName === name)
      ) {
        people.set(name, {
          id: name,
          businessName: name,
          email: null,
          teams: [],
        });
      }
    }

    return Array.from(people.values()).sort((a, b) =>
      (a.businessName || a.id).localeCompare(b.businessName || b.id),
    );
  }

  async fetchAssignmentPeople(): Promise<string[]> {
    if (this.isCacheValid()) return this.cachedPeople;

    try {
      const detailedPeople = await this.fetchAssignmentPeopleFromApi();
      this.cachedDetailedPeople = detailedPeople;
      this.cachedPeople = detailedPeople
        .map((person) => person.businessName || person.email || person.id)
        .filter(Boolean);
      this.cachedAt = new Date();
      return this.cachedPeople;
    } catch (err) {
      this.logger.error(`Error fetching people: ${(err as Error).message}`);
      // Fallback to ticket responsaveis
      const fallback = await this.ticketsService.getAllResponsaveis();
      return fallback;
    }
  }

  async fetchAssignmentPeopleDetails(): Promise<AssignmentPersonDto[]> {
    if (this.isCacheValid() && this.cachedDetailedPeople.length > 0) {
      return this.cachedDetailedPeople;
    }

    try {
      const detailedPeople = await this.fetchAssignmentPeopleFromApi();
      this.cachedDetailedPeople = detailedPeople;
      this.cachedPeople = detailedPeople
        .map((person) => person.businessName || person.email || person.id)
        .filter(Boolean);
      this.cachedAt = new Date();
      return detailedPeople;
    } catch (err) {
      this.logger.error(
        `Error fetching detailed people: ${(err as Error).message}`,
      );
      const fallback = await this.ticketsService.getAllResponsaveis();
      return fallback.map((name) => ({
        id: name,
        businessName: name,
        email: null,
        teams: [],
      }));
    }
  }

  async fetchAssignmentTeams(): Promise<string[]> {
    const pageSize = Number(
      this.config.get('MOVIDESK_PERSONS_PAGE_SIZE') ?? 200,
    );
    const maxPages = Number(
      this.config.get('MOVIDESK_PERSONS_MAX_PAGES') ?? 10,
    );
    const rawParams =
      this.config.get<string>('MOVIDESK_PERSONS_QUERY_PARAMS') ?? '';

    const baseParams = this.parseQueryString(rawParams);
    this.ensureSelectFields(baseParams);
    baseParams['$top'] = String(pageSize);
    if (this.token) baseParams['token'] = this.token;

    const teams = new Set<string>();

    for (let page = 0; page < maxPages; page++) {
      baseParams['$skip'] = String(page * pageSize);
      const resp = await axios.get(this.apiUrl, {
        params: baseParams,
        timeout: 10000,
        headers: { accept: 'application/json', 'user-agent': 'NestJS/1.0' },
      });

      const data = Array.isArray(resp.data)
        ? (resp.data as Record<string, unknown>[])
        : [];
      if (data.length === 0) break;

      for (const person of data) {
        const profileType = Number(person['profileType'] ?? 0);
        const isActive = person['isActive'];
        if ((profileType === 1 || profileType === 3) && isActive) {
          for (const team of this.getTeamNames(person)) {
            const normalized = team.trim();
            if (normalized) teams.add(normalized);
          }
        }
      }

      if (data.length < pageSize) break;
    }

    return Array.from(teams).sort((a, b) => a.localeCompare(b));
  }

  async fetchAssignmentTeamsForConfiguredScope(): Promise<string[]> {
    const people = await this.fetchAssignmentPeopleDetails();
    const teams = new Set<string>();

    for (const person of people) {
      for (const team of person.teams) {
        const normalized = team.trim();
        if (normalized) teams.add(normalized);
      }
    }

    return Array.from(teams).sort((a, b) => a.localeCompare(b));
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

export interface AssignmentPersonDto {
  id: string;
  businessName: string;
  email: string | null;
  teams: string[];
}
