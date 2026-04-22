import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

@Injectable()
export class MovideskTicketsClient {
  private readonly logger = new Logger(MovideskTicketsClient.name);
  private readonly apiUrl: string;
  private readonly personsApiUrl: string;
  private readonly apiToken: string;
  private readonly timeout: number;
  private readonly assignmentTeams: Set<string>;
  private cachedPeople: Map<string, string> = new Map();
  private cachedPeopleAt: Date | null = null;
  private readonly peopleCacheMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = config.get<string>('MOVIDESK_API_URL') ?? '';
    this.personsApiUrl = config.get<string>('MOVIDESK_PERSONS_API_URL') ?? '';
    this.apiToken = config.get<string>('MOVIDESK_API_TOKEN') ?? '';
    this.timeout = Number(config.get('MOVIDESK_API_TIMEOUT') ?? 10000);
    this.peopleCacheMs =
      Number(config.get('MOVIDESK_PERSONS_CACHE_SECONDS') ?? 300) * 1000;
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
    const ownerEmail = await this.resolveOwnerEmail(responsavel);

    await this.patchTicket(ticketId, {
      owner: {
        id: ownerEmail,
        businessName: responsavel,
      },
      ...(ownerTeam ? { ownerTeam } : {}),
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

  private matchesConfiguredTeam(person: Record<string, unknown>): boolean {
    if (this.assignmentTeams.size === 0) return true;

    const teams = Array.isArray(person['teams']) ? person['teams'] : [];
    return teams.some((team) => {
      const name =
        team && typeof team === 'object'
          ? String((team as Record<string, unknown>)['name'] ?? '')
          : String(team ?? '');
      return this.assignmentTeams.has(name.trim().toLowerCase());
    });
  }

  private async resolveOwnerEmail(responsavel: string): Promise<string> {
    if (!this.isPeopleCacheValid()) {
      await this.refreshPeopleCache();
    }

    const email = this.cachedPeople.get(this.normalize(responsavel));
    if (email) return email;

    throw new BadGatewayException(
      `Não encontrei o e-mail do responsável "${responsavel}" na API do Movidesk.`,
    );
  }

  private async refreshPeopleCache(): Promise<void> {
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
    const people = new Map<string, string>();

    try {
      for (let page = 0; page < maxPages; page++) {
        const response = await axios.get(this.personsApiUrl, {
          params: {
            token: this.apiToken,
            $select: 'businessName,email,profileType,isActive,teams',
            $top: pageSize,
            $skip: page * pageSize,
          },
          timeout: this.timeout,
          headers: { accept: 'application/json', 'user-agent': 'NestJS/1.0' },
        });

        const data = Array.isArray(response.data)
          ? (response.data as Record<string, unknown>[])
          : [];
        if (data.length === 0) break;

        for (const person of data) {
          const name = String(person['businessName'] ?? '').trim();
          const email = String(person['email'] ?? '').trim();
          const profileType = Number(person['profileType'] ?? 0);
          const isActive = Boolean(person['isActive']);

          if (
            name &&
            email &&
            isActive &&
            (profileType === 1 || profileType === 3) &&
            this.matchesConfiguredTeam(person)
          ) {
            people.set(this.normalize(name), email);
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
      throw new BadGatewayException(
        'Não foi possível consultar os agentes no Movidesk.',
      );
    }
  }
}
