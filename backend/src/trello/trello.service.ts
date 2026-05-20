import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { TicketsService } from '../tickets/tickets.service';
import { TicketDto } from '../tickets/ticket.entity';
import {
  CreateTrelloCardDto,
  TrelloBoardDto,
  TrelloListDto,
  TrelloStatusDto,
} from './trello.dto';

interface TrelloBoardResponse {
  id: string;
  name: string;
  url: string;
}

interface TrelloListResponse {
  id: string;
  name: string;
  closed: boolean;
}

export interface TrelloCardResponse {
  id: string;
  name: string;
  url: string;
  shortUrl?: string;
}

@Injectable()
export class TrelloService {
  private readonly client: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
  ) {
    this.client = axios.create({
      baseURL: 'https://api.trello.com/1',
      timeout: Number(config.get('TRELLO_API_TIMEOUT') ?? 10000),
      headers: { accept: 'application/json' },
    });
  }

  getStatus(): TrelloStatusDto {
    return {
      configured: this.isConfigured(),
      defaultBoardId: this.config.get<string>('TRELLO_DEFAULT_BOARD_ID') || null,
      defaultListId: this.config.get<string>('TRELLO_DEFAULT_LIST_ID') || null,
    };
  }

  async listBoards(): Promise<TrelloBoardDto[]> {
    this.ensureConfigured();
    const response = await this.client.get<TrelloBoardResponse[]>(
      '/members/me/boards',
      {
        params: {
          ...this.authParams(),
          fields: 'name,url',
          filter: 'open',
        },
      },
    );

    return response.data.map((board) => ({
      id: board.id,
      name: board.name,
      url: board.url,
    }));
  }

  async listBoardLists(boardId?: string): Promise<TrelloListDto[]> {
    this.ensureConfigured();
    const id = boardId || this.config.get<string>('TRELLO_DEFAULT_BOARD_ID');
    if (!id?.trim()) {
      throw new BadRequestException('Board do Trello não informado.');
    }

    const response = await this.client.get<TrelloListResponse[]>(
      `/boards/${encodeURIComponent(id.trim())}/lists`,
      {
        params: {
          ...this.authParams(),
          fields: 'name,closed',
          filter: 'open',
        },
      },
    );

    return response.data.map((list) => ({
      id: list.id,
      name: list.name,
      closed: !!list.closed,
    }));
  }

  async createCardFromTicket(
    ticketId: number,
    dto: CreateTrelloCardDto,
  ): Promise<{ card: TrelloCardResponse; ticket: TicketDto }> {
    this.ensureConfigured();

    const ticket = await this.ticketsService.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException('Ticket não encontrado.');
    }

    if (ticket.trello_card_id && ticket.trello_card_url) {
      return {
        card: {
          id: ticket.trello_card_id,
          name: ticket.trello_card_name || this.defaultCardName(ticket),
          url: ticket.trello_card_url,
        },
        ticket,
      };
    }

    const listId = dto.listId || this.config.get<string>('TRELLO_DEFAULT_LIST_ID');
    if (!listId?.trim()) {
      throw new BadRequestException('Lista do Trello não informada.');
    }

    const name = (dto.name || this.defaultCardName(ticket)).trim();
    const desc = (dto.description || this.defaultCardDescription(ticket)).trim();

    const response = await this.client.post<TrelloCardResponse>('/cards', null, {
      params: {
        ...this.authParams(),
        idList: listId.trim(),
        name,
        desc,
        pos: 'top',
      },
    });

    const card = response.data;
    const updatedTicket = await this.ticketsService.attachTrelloCard(ticket.id, {
      id: card.id,
      name: card.name,
      url: card.url || card.shortUrl || '',
    });

    return {
      card,
      ticket: updatedTicket ?? ticket,
    };
  }

  private isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('TRELLO_API_KEY')?.trim() &&
        this.config.get<string>('TRELLO_API_TOKEN')?.trim(),
    );
  }

  private ensureConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Integração Trello não configurada. Defina TRELLO_API_KEY e TRELLO_API_TOKEN.',
      );
    }
  }

  private authParams() {
    return {
      key: this.config.get<string>('TRELLO_API_KEY')?.trim(),
      token: this.config.get<string>('TRELLO_API_TOKEN')?.trim(),
    };
  }

  private defaultCardName(ticket: TicketDto): string {
    const subject = ticket.subject?.trim() || 'Sem assunto';
    return `#${ticket.id} - ${subject}`.slice(0, 160);
  }

  private defaultCardDescription(ticket: TicketDto): string {
    const movideskBaseUrl =
      this.config.get<string>('VITE_MOVIDESK_BASE_URL') ||
      'https://atendimento.nappsolutions.com';
    const ticketUrl = `${movideskBaseUrl.replace(/\/$/, '')}/Ticket/Edit/${ticket.id}`;

    return [
      `Ticket Movidesk: #${ticket.id}`,
      '',
      ticket.subject ? `Assunto: ${ticket.subject}` : null,
      ticket.status ? `Status: ${ticket.status}` : null,
      ticket.ownerTeam ? `Equipe: ${ticket.ownerTeam}` : null,
      ticket.responsavel ? `Responsavel: ${ticket.responsavel}` : 'Responsavel: nao atribuido',
      ticket.slaSolutionDate ? `SLA: ${ticket.slaSolutionDate}` : null,
      ticket.opened_at ? `Aberto em: ${ticket.opened_at}` : null,
      '',
      `Link: ${ticketUrl}`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
