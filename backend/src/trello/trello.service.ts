import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { McpMovideskService } from '../mcp/mcp-movidesk.service';
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
  private readonly logger = new Logger(TrelloService.name);
  private readonly trelloTextLimit = 16000;
  private readonly client: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
    private readonly mcpMovidesk: McpMovideskService,
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
      defaultBoardId: this.getEnv('TRELLO_DEFAULT_BOARD_ID') || null,
      defaultListId: this.getEnv('TRELLO_DEFAULT_LIST_ID') || null,
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
    const id = boardId || this.getEnv('TRELLO_DEFAULT_BOARD_ID');
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

    const listId = dto.listId || this.getEnv('TRELLO_DEFAULT_LIST_ID');
    if (!listId?.trim()) {
      throw new BadRequestException('Lista do Trello não informada.');
    }

    const name = (dto.name || this.defaultCardName(ticket)).trim();
    const mcpContent = await this.buildMcpTicketContent(
      ticket,
      dto.description,
    );
    const [desc, ...comments] = this.splitForTrello(mcpContent);

    const response = await this.client.post<TrelloCardResponse>(
      '/cards',
      null,
      {
        params: {
          ...this.authParams(),
          idList: listId.trim(),
          name,
          desc,
          pos: 'top',
        },
      },
    );

    const card = response.data;
    await this.addCardComments(card.id, comments);

    const updatedTicket = await this.ticketsService.attachTrelloCard(
      ticket.id,
      {
        id: card.id,
        name: card.name,
        url: card.url || card.shortUrl || '',
      },
    );

    return {
      card,
      ticket: updatedTicket ?? ticket,
    };
  }

  private async buildMcpTicketContent(
    ticket: TicketDto,
    requestedDescription?: string,
  ): Promise<string> {
    try {
      const [summaryPrompt, ticketDetails] = await Promise.all([
        this.mcpMovidesk.getPrompt('resumo_ticket', {
          ticket_id: String(ticket.id),
          contexto: this.defaultCardDescription(ticket),
          formato: 'técnico detalhado',
        }),
        this.mcpMovidesk.callTool('consultar_ticket', { ticketId: ticket.id }),
      ]);

      const promptText = this.promptResultToText(summaryPrompt);
      const detailsText = this.mcpResultToText(ticketDetails);
      if (!detailsText.trim()) {
        throw new ServiceUnavailableException(
          'MCP consultar_ticket não retornou conteúdo para o chamado.',
        );
      }

      return [
        `# Ticket Movidesk #${ticket.id}`,
        '',
        this.defaultCardDescription(ticket),
        requestedDescription?.trim()
          ? `\n## Observação enviada pelo app\n${requestedDescription.trim()}`
          : null,
        promptText.trim()
          ? `\n## Prompt MCP usado: resumo_ticket\n${promptText.trim()}`
          : null,
        `\n## Conteúdo completo do chamado via MCP consultar_ticket\n${detailsText.trim()}`,
      ]
        .filter((section): section is string => Boolean(section))
        .join('\n');
    } catch (error) {
      this.logger.error(
        `Erro ao montar conteúdo MCP do ticket #${ticket.id}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível obter o resumo/conversa do chamado via MCP. O card do Trello não foi criado.',
      );
    }
  }

  private async addCardComments(cardId: string, comments: string[]) {
    for (let index = 0; index < comments.length; index += 1) {
      const text =
        comments.length === 1
          ? comments[index]
          : `Conteúdo completo do chamado via MCP (${index + 1}/${comments.length})\n\n${comments[index]}`;

      await this.client.post(
        `/cards/${encodeURIComponent(cardId)}/actions/comments`,
        null,
        {
          params: {
            ...this.authParams(),
            text,
          },
        },
      );
    }
  }

  private splitForTrello(text: string): string[] {
    const normalized = text.trim();
    if (!normalized) return [''];

    const chunks: string[] = [];
    for (
      let offset = 0;
      offset < normalized.length;
      offset += this.trelloTextLimit
    ) {
      chunks.push(normalized.slice(offset, offset + this.trelloTextLimit));
    }

    return chunks;
  }

  private mcpResultToText(result: unknown): string {
    const payload = result as {
      content?: Array<{
        type?: string;
        text?: string;
        resource?: { text?: string };
      }>;
      structuredContent?: unknown;
    };

    const textParts = payload.content
      ?.map((item) => {
        if (item.type === 'text' && typeof item.text === 'string') {
          return item.text;
        }
        if (
          item.type === 'resource' &&
          typeof item.resource?.text === 'string'
        ) {
          return item.resource.text;
        }
        return '';
      })
      .filter(Boolean);

    if (textParts?.length) return textParts.join('\n\n');
    if (payload.structuredContent) {
      return JSON.stringify(payload.structuredContent, null, 2);
    }
    return JSON.stringify(result, null, 2);
  }

  private promptResultToText(result: unknown): string {
    const payload = result as {
      messages?: Array<{
        role?: string;
        content?: {
          type?: string;
          text?: string;
          resource?: { text?: string };
        };
      }>;
    };

    return (
      payload.messages
        ?.map((message) => {
          const content = message.content;
          if (content?.type === 'text' && typeof content.text === 'string') {
            return `${message.role || 'user'}: ${content.text}`;
          }
          if (
            content?.type === 'resource' &&
            typeof content.resource?.text === 'string'
          ) {
            return `${message.role || 'user'}: ${content.resource.text}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n') || ''
    );
  }

  private isConfigured(): boolean {
    return Boolean(
      this.getEnv('TRELLO_API_KEY') && this.getEnv('TRELLO_API_TOKEN'),
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
      key: this.getEnv('TRELLO_API_KEY'),
      token: this.getEnv('TRELLO_API_TOKEN'),
    };
  }

  private getEnv(key: string): string {
    return (
      process.env[key]?.trim() || this.config.get<string>(key)?.trim() || ''
    );
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
      ticket.responsavel
        ? `Responsavel: ${ticket.responsavel}`
        : 'Responsavel: nao atribuido',
      ticket.slaSolutionDate ? `SLA: ${ticket.slaSolutionDate}` : null,
      ticket.opened_at ? `Aberto em: ${ticket.opened_at}` : null,
      '',
      `Link: ${ticketUrl}`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
