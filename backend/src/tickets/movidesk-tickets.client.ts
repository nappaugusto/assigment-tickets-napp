import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

interface AssignmentPerson {
  email: string;
  teamName: string | null;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

@Injectable()
export class MovideskTicketsClient {
  private readonly logger = new Logger(MovideskTicketsClient.name);
  private readonly apiUrl: string;
  private readonly personsApiUrl: string;
  private readonly apiToken: string;
  private readonly timeout: number;
  private readonly assignmentTeams: Set<string>;
  private readonly personsQueryParams: string;
  private cachedPeople: Map<string, AssignmentPerson> = new Map();
  private cachedPeopleAt: Date | null = null;
  private readonly peopleCacheMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = config.get<string>('MOVIDESK_API_URL') ?? '';
    this.personsApiUrl = config.get<string>('MOVIDESK_PERSONS_API_URL') ?? '';
    this.apiToken = config.get<string>('MOVIDESK_API_TOKEN') ?? '';
    this.timeout = Number(config.get('MOVIDESK_API_TIMEOUT') ?? 10000);
    this.peopleCacheMs =
      Number(config.get('MOVIDESK_PERSONS_CACHE_SECONDS') ?? 300) * 1000;
    this.personsQueryParams =
      config.get<string>('MOVIDESK_PERSONS_QUERY_PARAMS') ?? '';
    this.assignmentTeams = new Set(
      (config.get<string>('ASSIGNMENT_TEAM_NAMES') ?? '')
        .split(',')
        .map((team) => team.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  async assign(
    ticketId: number,
    responsavel: string,
    ownerTeam: string | null,
  ): Promise<void> {
    const owner = await this.resolveOwner(responsavel, ownerTeam);
    const targetOwnerTeam = owner.teamName ?? ownerTeam;

    await this.patchTicket(ticketId, {
      owner: {
        id: owner.email,
      },
      ...(targetOwnerTeam ? { ownerTeam: targetOwnerTeam } : {}),
    });
  }

  async unassign(ticketId: number, ownerTeam: string | null): Promise<void> {
    await this.patchTicket(ticketId, {
      owner: null,
      ...(ownerTeam ? { ownerTeam } : {}),
    });
  }

  private async patchTicket(
    ticketId: number,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!this.apiUrl || !this.apiToken) {
      throw new BadGatewayException('Configuração da API Movidesk incompleta.');
    }

    try {
      await axios.patch(this.apiUrl, body, {
        params: {
          token: this.apiToken,
          id: ticketId,
        },
        timeout: this.timeout,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'NestJS/1.0',
        },
      });
    } catch (err) {
      const axiosError = err as AxiosError;
      const status = axiosError.response?.status;
      const detail =
        typeof axiosError.response?.data === 'string'
          ? axiosError.response.data
          : JSON.stringify(axiosError.response?.data ?? {});

      this.logger.error(
        `Error patching Movidesk ticket ${ticketId}: ${axiosError.message} status=${status ?? 'unknown'} detail=${detail}`,
      );
      throw new BadGatewayException(
        'Não foi possível atualizar o atendimento no Movidesk.',
      );
    }
  }

  private isPeopleCacheValid(): boolean {
    if (!this.cachedPeopleAt || this.cachedPeople.size === 0) return false;
    return Date.now() - this.cachedPeopleAt.getTime() < this.peopleCacheMs;
  }

  private normalize(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private async resolveOwner(
    responsavel: string,
    currentOwnerTeam: string | null,
  ): Promise<AssignmentPerson> {
    const normalizedResponsavel = this.normalize(responsavel);

    if (isEmail(responsavel)) {
      const cachedEmailOwner = this.cachedPeople.get(normalizedResponsavel);
      return {
        email: responsavel.trim(),
        teamName: cachedEmailOwner?.teamName ?? currentOwnerTeam,
      };
    }

    if (!this.isPeopleCacheValid()) {
      await this.refreshPeopleCache();
    }

    let owner = this.cachedPeople.get(normalizedResponsavel);
    if (!owner) {
      await this.refreshPeopleCache(true);
      owner = this.cachedPeople.get(normalizedResponsavel);
    }

    if (owner) {
      if (currentOwnerTeam && owner.teamName === currentOwnerTeam) return owner;
      return owner;
    }

    throw new BadGatewayException(
      `Não encontrei o e-mail do responsável "${responsavel}" na API do Movidesk.`,
    );
  }

  private async refreshPeopleCache(force = false): Promise<void> {
    if (!force && this.isPeopleCacheValid()) {
      return;
    }

    if (!this.personsApiUrl || !this.apiToken) {
      throw new BadGatewayException(
        'Configuração da API de pessoas do Movidesk incompleta.',
      );
    }

    const pageSize = Number(
      this.config.get('MOVIDESK_PERSONS_PAGE_SIZE') ?? 200,
    );
    const maxPages = Number(
      this.config.get('MOVIDESK_PERSONS_MAX_PAGES') ?? 10,
    );
    const baseParams = this.parseQueryString(this.personsQueryParams);
    this.ensureSelectedFields(baseParams, [
      'businessName',
      'email',
      'emails',
      'profileType',
      'isActive',
      'teams',
    ]);
    baseParams['$top'] = String(pageSize);
    if (this.apiToken) {
      baseParams['token'] = this.apiToken;
    }
    const people = new Map<string, AssignmentPerson>();

    try {
      for (let page = 0; page < maxPages; page++) {
        baseParams['$skip'] = String(page * pageSize);
        const response = await axios.get(this.personsApiUrl, {
          params: baseParams,
          timeout: this.timeout,
          headers: { accept: 'application/json', 'user-agent': 'NestJS/1.0' },
        });

        const data = Array.isArray(response.data)
          ? (response.data as Record<string, unknown>[])
          : [];
        if (data.length === 0) break;

        for (const person of data) {
          const name = String(person['businessName'] ?? '').trim();
          const email = this.extractEmail(person);
          const profileType = Number(person['profileType'] ?? 0);
          const isActive = Boolean(person['isActive']);
          const teamName = this.resolveAssignmentTeam(person);

          if (
            name &&
            email &&
            isActive &&
            (profileType === 1 || profileType === 3) &&
            teamName
          ) {
            people.set(this.normalize(name), { email, teamName });
            people.set(this.normalize(email), { email, teamName });
          }
        }

        if (data.length < pageSize) break;
      }

      this.cachedPeople = people;
      this.cachedPeopleAt = new Date();
    } catch (err) {
      const axiosError = err as AxiosError;
      this.logger.error(
        `Error fetching Movidesk people: ${axiosError.message}`,
      );

      if (this.cachedPeople.size > 0) {
        this.logger.warn('Using stale Movidesk people cache after fetch error.');
        return;
      }

      throw new BadGatewayException(
        'Não foi possível consultar os agentes no Movidesk.',
      );
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

  private ensureSelectedFields(
    params: Record<string, string>,
    requiredFields: string[],
  ): void {
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

  private extractEmail(person: Record<string, unknown>): string {
    const directEmail = String(person['email'] ?? '').trim();
    if (directEmail) return directEmail;

    const emails = Array.isArray(person['emails']) ? person['emails'] : [];
    const emailFromList =
      emails.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          Boolean((item as Record<string, unknown>)['isDefault']) &&
          String((item as Record<string, unknown>)['email'] ?? '').trim(),
      ) ??
      emails.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          String((item as Record<string, unknown>)['email'] ?? '').trim(),
      );

    if (emailFromList && typeof emailFromList === 'object') {
      return String((emailFromList as Record<string, unknown>)['email'] ?? '')
        .trim();
    }

    return '';
  }

  private resolveAssignmentTeam(person: Record<string, unknown>): string | null {
    const teams = Array.isArray(person['teams']) ? person['teams'] : [];
    const teamNames = teams
      .map((team) =>
        team && typeof team === 'object'
          ? String((team as Record<string, unknown>)['name'] ?? '').trim()
          : String(team ?? '').trim(),
      )
      .filter(Boolean);

    if (teamNames.length === 0) return null;
    if (this.assignmentTeams.size === 0) return teamNames[0];

    return (
      teamNames.find((team) => this.assignmentTeams.has(team.toLowerCase())) ??
      null
    );
  }
}
