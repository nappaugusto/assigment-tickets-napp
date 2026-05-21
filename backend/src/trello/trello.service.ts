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

interface MovideskAttachment {
  id?: string | number;
  hash?: string;
  guid?: string;
  storageFileGuid?: string;
  name?: string;
  fileName?: string;
  originalFileName?: string;
  path?: string;
  url?: string;
  uri?: string;
  href?: string;
  size?: number;
  length?: number;
  contentLength?: number;
  contentType?: string;
  type?: string;
}

interface MovideskAction {
  id?: number;
  description?: string;
  htmlDescription?: string;
  attachments?: MovideskAttachment[] | null;
}

interface MovideskTicketDetails {
  actions?: MovideskAction[] | null;
  attachments?: MovideskAttachment[] | null;
  customFieldValues?: unknown[] | null;
}

interface ImageAttachment {
  name: string;
  url: string;
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
  private readonly movideskClient: AxiosInstance;

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
    this.movideskClient = axios.create({
      timeout: Number(config.get('MOVIDESK_API_TIMEOUT') ?? 10000),
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

    if (!dto.forceNew && ticket.trello_card_id && ticket.trello_card_url) {
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
    const mcpContent = await this.buildMcpTicketContent(ticket);
    const [desc, ...comments] = this.splitForTrello(mcpContent);
    const images = await this.getTicketImages(ticket.id, mcpContent);

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
    await this.addCardImageAttachments(card.id, images);

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

  private async buildMcpTicketContent(ticket: TicketDto): Promise<string> {
    try {
      await this.mcpMovidesk.getPrompt('resumo_ticket', {
        ticket_id: String(ticket.id),
        contexto: this.defaultCardDescription(ticket),
        formato: 'técnico detalhado',
      });
      const ticketDetails = await this.mcpMovidesk.callTool(
        'consultar_ticket',
        { ticketId: ticket.id },
      );
      const detailsText = this.removeUnwantedSystemContent(
        this.mcpResultToText(ticketDetails),
      );
      if (!detailsText.trim()) {
        throw new ServiceUnavailableException(
          'MCP consultar_ticket não retornou conteúdo para o chamado.',
        );
      }

      return [
        `# Ticket Movidesk #${ticket.id}`,
        '',
        this.defaultCardDescription(ticket),
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

  private async addCardImageAttachments(
    cardId: string,
    images: ImageAttachment[],
  ) {
    if (images.length === 0) return;

    const failures: string[] = [];
    for (const image of images) {
      try {
        await this.uploadImageAttachmentToTrello(cardId, image);
      } catch (error) {
        failures.push(image.name);
        this.logger.warn(
          `Erro ao anexar imagem ${image.name} no card Trello ${cardId}: ${(error as Error).message}`,
        );
      }
    }
    await this.clearCardCover(cardId);

    if (failures.length > 0) {
      await this.addCardComments(cardId, [
        [
          'Algumas imagens do chamado nao puderam ser anexadas automaticamente ao Trello:',
          ...failures.map((name) => `- ${name}`),
        ].join('\n'),
      ]);
    }
  }

  private async uploadImageAttachmentToTrello(
    cardId: string,
    image: ImageAttachment,
  ) {
    const response = await this.movideskClient.get<ArrayBuffer>(image.url, {
      responseType: 'arraybuffer',
    });
    const contentType =
      response.headers['content-type']?.toString() ||
      this.contentTypeFromImageName(image.name);
    const form = new FormData();
    form.append('name', image.name);
    form.append(
      'file',
      new globalThis.Blob([response.data], { type: contentType }),
      image.name,
    );

    await this.client.post(
      `/cards/${encodeURIComponent(cardId)}/attachments`,
      form,
      {
        params: {
          ...this.authParams(),
          setCover: false,
        },
      },
    );
  }

  private async clearCardCover(cardId: string) {
    try {
      await this.client.put(
        `/cards/${encodeURIComponent(cardId)}`,
        { idAttachmentCover: null },
        {
          params: this.authParams(),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Erro ao remover capa do card Trello ${cardId}: ${(error as Error).message}`,
      );
    }
  }

  private async getTicketImages(
    ticketId: number,
    mcpContent: string,
  ): Promise<ImageAttachment[]> {
    const images = new Map<string, ImageAttachment>();
    const add = (image: ImageAttachment) => {
      if (!image.url || images.has(image.url)) return;
      images.set(image.url, image);
    };

    for (const image of this.extractImageUrlsFromText(mcpContent)) {
      add(image);
    }

    const movideskTicket = await this.fetchMovideskTicketDetails(ticketId);
    for (const attachment of movideskTicket?.attachments ?? []) {
      const image = this.imageFromMovideskAttachment(attachment);
      if (image) add(image);
    }

    for (const attachment of this.extractMovideskAttachmentsFromUnknown(
      movideskTicket?.customFieldValues,
    )) {
      const image = this.imageFromMovideskAttachment(attachment);
      if (image) add(image);
    }

    for (const action of movideskTicket?.actions ?? []) {
      const actionText = `${action.description ?? ''}\n${action.htmlDescription ?? ''}`;
      const skipAction =
        this.looksLikeSignature(actionText) ||
        this.looksLikeSystemInteraction(actionText);

      if (skipAction) {
        continue;
      }

      for (const image of this.extractImageUrlsFromText(actionText)) {
        add(image);
      }

      for (const attachment of action.attachments ?? []) {
        const image = this.imageFromMovideskAttachment(attachment, actionText);
        if (image) add(image);
      }

      for (const attachment of this.extractMovideskAttachmentsFromUnknown(
        action,
      )) {
        const image = this.imageFromMovideskAttachment(attachment, actionText);
        if (image) add(image);
      }
    }

    return [...images.values()];
  }

  private async fetchMovideskTicketDetails(
    ticketId: number,
  ): Promise<MovideskTicketDetails | null> {
    const apiUrl = this.getEnv('MOVIDESK_API_URL');
    const token =
      this.getEnv('MOVIDESK_API_TOKEN') || this.getEnv('MOVIDESK_TOKEN');
    if (!apiUrl || !token) return null;

    try {
      const response = await this.movideskClient.get<MovideskTicketDetails>(
        apiUrl,
        {
          params: {
            token,
            id: ticketId,
            $select: 'id,actions,attachments,customFieldValues',
            $expand: 'actions',
          },
        },
      );
      return response.data;
    } catch (error) {
      this.logger.warn(
        `Erro ao buscar anexos do ticket #${ticketId} no Movidesk: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private extractImageUrlsFromText(text: string): ImageAttachment[] {
    const result: ImageAttachment[] = [];
    const patterns = [
      /<img[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi,
      /<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi,
      /<img[^>]*src=["']([^"']+)["'][^>]*>/gi,
      /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        const [first, second] = [match[1], match[2]];
        const url = first?.startsWith('http') ? first : second;
        const alt = first?.startsWith('http') ? second : first;
        const resolvedUrl = url ? this.resolveMovideskInlineUrl(url) : '';
        if (
          resolvedUrl &&
          !this.looksLikeSignature(`${alt ?? ''} ${resolvedUrl}`)
        ) {
          result.push({
            name: this.imageNameFromUrl(resolvedUrl, alt),
            url: resolvedUrl,
          });
        }
      }
    }

    return result;
  }

  private imageFromMovideskAttachment(
    attachment: MovideskAttachment,
    context = '',
  ): ImageAttachment | null {
    const rawUrl =
      attachment.url ||
      attachment.uri ||
      attachment.href ||
      attachment.path ||
      attachment.storageFileGuid ||
      attachment.guid ||
      attachment.hash ||
      (attachment.id !== undefined ? String(attachment.id) : '') ||
      '';
    const name =
      attachment.fileName ||
      attachment.originalFileName ||
      attachment.name ||
      this.imageNameFromUrl(rawUrl);
    if (!this.isImageName(name) && !this.isImageUrl(rawUrl)) return null;
    if (this.looksLikeSignature(`${name} ${rawUrl}`)) return null;
    if (this.looksLikeSignatureImage(attachment, context)) return null;

    const url = this.resolveMovideskAttachmentUrl(rawUrl);
    if (!url) return null;

    return { name, url };
  }

  private extractMovideskAttachmentsFromUnknown(
    value: unknown,
  ): MovideskAttachment[] {
    const attachments: MovideskAttachment[] = [];
    const visited = new WeakSet<object>();

    const visit = (item: unknown) => {
      if (!item || typeof item !== 'object') return;
      if (visited.has(item)) return;
      visited.add(item);

      if (Array.isArray(item)) {
        for (const child of item) visit(child);
        return;
      }

      const record = item as Record<string, unknown>;
      const nestedAttachments =
        record.attachments ||
        record.files ||
        record.fileAttachments ||
        record.value ||
        record.items;

      if (this.looksLikeMovideskAttachment(record)) {
        attachments.push(record as MovideskAttachment);
      }

      visit(nestedAttachments);
    };

    visit(value);
    return attachments;
  }

  private looksLikeMovideskAttachment(record: Record<string, unknown>): boolean {
    const name =
      this.pickString(record.fileName) ||
      this.pickString(record.originalFileName) ||
      this.pickString(record.name);
    const locator =
      this.pickString(record.url) ||
      this.pickString(record.uri) ||
      this.pickString(record.href) ||
      this.pickString(record.path) ||
      this.pickString(record.storageFileGuid) ||
      this.pickString(record.guid) ||
      this.pickString(record.hash) ||
      this.pickString(record.id);

    return Boolean(
      locator &&
        (this.isImageName(name) ||
          this.isImageUrl(locator) ||
          this.isLikelyMovideskStorageHash(locator)),
    );
  }

  private resolveMovideskInlineUrl(rawUrl: string): string {
    const value = this.decodeHtmlEntities(rawUrl.trim());
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return `https:${value}`;

    const movideskBaseUrl =
      this.getEnv('VITE_MOVIDESK_BASE_URL') ||
      'https://atendimento.nappsolutions.com';

    if (value.startsWith('/')) {
      return `${movideskBaseUrl.replace(/\/$/, '')}${value}`;
    }

    return '';
  }

  private resolveMovideskAttachmentUrl(rawUrl: string): string {
    const value = this.decodeHtmlEntities(rawUrl.trim());
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;

    const template = this.getEnv('MOVIDESK_ATTACHMENT_URL_TEMPLATE');
    if (template) {
      return template
        .replace('{path}', encodeURIComponent(value))
        .replace('{rawPath}', value);
    }

    if (this.isLikelyMovideskStorageHash(value)) {
      const token =
        this.getEnv('MOVIDESK_API_TOKEN') || this.getEnv('MOVIDESK_TOKEN');
      if (!token) return '';

      const apiUrl = this.getEnv('MOVIDESK_API_URL');
      let origin = 'https://api.movidesk.com';
      try {
        if (apiUrl) {
          const parsed = new URL(apiUrl);
          origin = `${parsed.protocol}//${parsed.host}`;
        }
      } catch {
        origin = 'https://api.movidesk.com';
      }

      return `${origin}/public/v1/storage/download?token=${encodeURIComponent(token)}&id=${encodeURIComponent(value)}`;
    }

    return '';
  }

  private isLikelyMovideskStorageHash(value: string): boolean {
    return /^[a-z0-9][a-z0-9_-]{16,}$/i.test(value);
  }

  private isImageUrl(url: string): boolean {
    try {
      const parsed = new URL(this.decodeHtmlEntities(url));
      return this.isImageName(parsed.pathname);
    } catch {
      return this.isImageName(url);
    }
  }

  private isImageName(name: string): boolean {
    return /\.(apng|avif|gif|jpe?g|png|webp|bmp|tiff?|svg)(\?.*)?$/i.test(name);
  }

  private imageNameFromUrl(url: string, fallback?: string): string {
    if (fallback?.trim()) return fallback.trim();
    try {
      const parsed = new URL(this.decodeHtmlEntities(url));
      const fileName = parsed.pathname.split('/').filter(Boolean).pop();
      return fileName || 'imagem-do-chamado';
    } catch {
      return url.split('/').filter(Boolean).pop() || 'imagem-do-chamado';
    }
  }

  private contentTypeFromImageName(name: string): string {
    const normalized = name.toLowerCase();
    if (normalized.endsWith('.png')) return 'image/png';
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (normalized.endsWith('.gif')) return 'image/gif';
    if (normalized.endsWith('.webp')) return 'image/webp';
    if (normalized.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }

  private pickString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private removeUnwantedSystemContent(text: string): string {
    return text
      .split(/\n---\n/g)
      .filter(
        (block) =>
          !this.looksLikeSignature(block) &&
          !this.looksLikeSystemInteraction(block),
      )
      .join('\n---\n')
      .replace(
        /!\[[^\]]*(?:napp|assinatura|signature|suporte|plataforma|kaue|kauê)[^\]]*\]\([^)]+\)/gi,
        '',
      )
      .replace(
        /<img[^>]+(?:napp|assinatura|signature|suporte|plataforma|kaue|kauê)[^>]*>/gi,
        '',
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private looksLikeSystemInteraction(text: string): boolean {
    const normalized = this.normalizeForSignatureCheck(text);
    if (!normalized) return false;

    return (
      /(?:interna|publica)\s+por\s+sistema\s+em/.test(normalized) ||
      /por\s+sistema\s+em\s+\d{2}\/\d{2}\/\d{4}/.test(normalized) ||
      normalized.includes('por sistema em')
    );
  }

  private looksLikeSignature(text: string): boolean {
    const normalized = this.normalizeForSignatureCheck(text);
    if (!normalized) return false;

    const hasBrand =
      normalized.includes('napp solutions') ||
      normalized.includes('nappsolutions') ||
      normalized.includes('inteligencia de dados') ||
      normalized.includes('suporte plataforma');

    const hasAgentIdentity =
      normalized.includes('kaue torres') ||
      normalized.includes('kaue.torres') ||
      normalized.includes('kauetorres') ||
      normalized.includes('kaue@') ||
      normalized.includes('nappsolution');

    const hasSignatureHint =
      normalized.includes('assinatura') ||
      normalized.includes('signature') ||
      normalized.includes('cid:') ||
      normalized.includes('suporte') ||
      normalized.includes('plataforma');

    return hasBrand || (hasAgentIdentity && hasSignatureHint);
  }

  private looksLikeSignatureImage(
    attachment: MovideskAttachment,
    context: string,
  ): boolean {
    const rawUrl =
      attachment.url ||
      attachment.uri ||
      attachment.href ||
      attachment.path ||
      '';
    const name = attachment.fileName || this.imageNameFromUrl(rawUrl);
    const normalizedName = this.normalizeForSignatureCheck(name);
    const normalizedContext = this.normalizeForSignatureCheck(context);
    const normalizedRawUrl = this.normalizeForSignatureCheck(rawUrl);
    const size =
      attachment.size ?? attachment.length ?? attachment.contentLength ?? null;
    const looksLikeHashName = /^[a-f0-9]{24,}$/i.test(name.replace(/\W/g, ''));
    const contextHasAgentSignature =
      normalizedContext.includes('napp solutions') ||
      normalizedContext.includes('nappsolutions') ||
      normalizedContext.includes('kaue torres') ||
      normalizedContext.includes('kauetorres') ||
      normalizedContext.includes('kaue.torres') ||
      normalizedContext.includes('kaue@') ||
      normalizedContext.includes('suporte plataforma') ||
      normalizedContext.includes('inteligencia de dados');

    return (
      normalizedName.includes('assinatura') ||
      normalizedName.includes('signature') ||
      normalizedName.includes('napp') ||
      normalizedRawUrl.includes('assinatura') ||
      normalizedRawUrl.includes('signature') ||
      normalizedRawUrl.includes('napp') ||
      normalizedRawUrl.includes('kaue') ||
      (contextHasAgentSignature &&
        (looksLikeHashName || size === null || size < 250000))
    );
  }

  private normalizeForSignatureCheck(text: string): string {
    return this.decodeHtmlEntities(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
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
