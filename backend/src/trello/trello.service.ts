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
  idBoard?: string;
}

interface TrelloLabelResponse {
  id: string;
  name: string;
  color: string | null;
}

interface TrelloCardLabelStateResponse {
  idBoard?: string;
  idLabels?: string[];
}

interface MovideskAttachment {
  id?: string | number;
  hash?: string;
  guid?: string;
  storageFileGuid?: string;
  source?: string;
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
  type?: number;
  description?: string;
  htmlDescription?: string;
  createdDate?: string;
  createdBy?: {
    businessName?: string;
    name?: string;
  } | null;
  attachments?: MovideskAttachment[] | null;
}

interface MovideskTicketDetails {
  actions?: MovideskAction[] | null;
  attachments?: MovideskAttachment[] | null;
  assets?: unknown[] | null;
  customFieldValues?: unknown[] | null;
}

interface ImageAttachment {
  name: string;
  url: string;
  source?: string;
  context?: string;
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
  private readonly signatureImageHashes = new Set([
    'addf9f0cec78bae06fb09f2cd65ebb5c',
    'b279a5cb852c0e241765d0575336ae3f',
  ]);
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
          fields: 'name,closed,idBoard',
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

    const destination = await this.resolveCardDestination(dto);

    const name = (dto.name || this.defaultCardName(ticket)).trim();
    const ticketContent = await this.buildMcpTicketContent(ticket);
    const extraDescription = dto.extraDescription?.trim() || dto.description?.trim();
    const labelIds = destination.boardId
      ? await this.resolveLabelIds(destination.boardId, dto.labels)
      : [];
    if (dto.labels?.length) {
      this.logger.log(
        `Ticket #${ticket.id}: ${labelIds.length}/${dto.labels.length} label(s) resolvida(s) para o Trello.`,
      );
    }
    const mcpContent = extraDescription
      ? [
          ticketContent,
          '',
          '## Triagem IA',
          extraDescription,
        ].join('\n')
      : ticketContent;
    const [desc, ...comments] = this.splitForTrello(mcpContent);
    const images = await this.getTicketImages(ticket.id);
    this.logger.log(
      `Ticket #${ticket.id}: ${images.length} anexo(s) de campo do chamado encontrado(s) para o Trello: ${images.map((image) => `${image.name}${image.source ? ` (${image.source})` : ''}`).join(', ') || 'nenhum'}.`,
    );

    const response = await this.client.post<TrelloCardResponse>(
      '/cards',
      null,
      {
        params: {
          ...this.authParams(),
          idList: destination.listId,
          name,
          desc,
          ...(labelIds.length ? { idLabels: labelIds.join(',') } : {}),
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

  async applyLabelsToTicketCard(
    ticket: TicketDto,
    labels: string[] | undefined,
  ): Promise<{ applied: number; resolved: number }> {
    const cardId = ticket.trello_card_id?.trim();
    const names = this.normalizeLabelNames(labels);
    if (!cardId || !names.length) return { applied: 0, resolved: 0 };

    const response = await this.client.get<TrelloCardLabelStateResponse>(
      `/cards/${encodeURIComponent(cardId)}`,
      {
        params: {
          ...this.authParams(),
          fields: 'idBoard,idLabels',
        },
      },
    );

    const boardId = response.data.idBoard;
    if (!boardId) return { applied: 0, resolved: 0 };

    const labelIds = await this.resolveLabelIds(boardId, names);
    const existingIds = new Set(response.data.idLabels ?? []);
    const missingIds = labelIds.filter((labelId) => !existingIds.has(labelId));

    for (const labelId of missingIds) {
      await this.client.post(
        `/cards/${encodeURIComponent(cardId)}/idLabels`,
        null,
        {
          params: {
            ...this.authParams(),
            value: labelId,
          },
        },
      );
    }

    if (labelIds.length) {
      this.logger.log(
        `Card Trello ${cardId}: ${missingIds.length}/${labelIds.length} label(s) da triagem IA aplicada(s).`,
      );
    }

    return { applied: missingIds.length, resolved: labelIds.length };
  }

  private async resolveCardDestination(
    dto: CreateTrelloCardDto,
  ): Promise<{ listId: string; boardId: string | null }> {
    const explicitListId = dto.listId?.trim();
    if (explicitListId) {
      return {
        listId: explicitListId,
        boardId: dto.boardId?.trim() || await this.getListBoardId(explicitListId),
      };
    }

    const defaultListId = this.getEnv('TRELLO_DEFAULT_LIST_ID');
    if (defaultListId) {
      return {
        listId: defaultListId,
        boardId: dto.boardId?.trim() || await this.getListBoardId(defaultListId),
      };
    }

    const boardId = dto.boardId?.trim() || this.getEnv('TRELLO_DEFAULT_BOARD_ID');
    if (boardId) {
      const lists = await this.listBoardLists(boardId);
      const list = lists.find((item) => !item.closed) ?? lists[0];
      if (list?.id) return { listId: list.id, boardId };
    }

    const boards = await this.listBoards();
    const board = boards[0];
    if (board?.id) {
      const lists = await this.listBoardLists(board.id);
      const list = lists.find((item) => !item.closed) ?? lists[0];
      if (list?.id) return { listId: list.id, boardId: board.id };
    }

    throw new BadRequestException(
      'Não encontrei uma lista aberta no Trello para criar o card.',
    );
  }

  private async getListBoardId(listId: string): Promise<string | null> {
    try {
      const response = await this.client.get<{ idBoard?: string }>(
        `/lists/${encodeURIComponent(listId)}`,
        {
          params: {
            ...this.authParams(),
            fields: 'idBoard',
          },
        },
      );
      return response.data.idBoard ?? null;
    } catch (error) {
      this.logger.warn(
        `Não foi possível descobrir o board da lista ${listId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async resolveLabelIds(
    boardId: string,
    labels: string[] | undefined,
  ): Promise<string[]> {
    const names = this.normalizeLabelNames(labels);
    if (!names.length) return [];

    const response = await this.client.get<TrelloLabelResponse[]>(
      `/boards/${encodeURIComponent(boardId)}/labels`,
      {
        params: {
          ...this.authParams(),
          fields: 'name,color',
          limit: 1000,
        },
      },
    );

    const existingByName = new Map(
      response.data
        .filter((label) => label.name?.trim())
        .map((label) => [this.normalizeLabelKey(label.name), label]),
    );
    const ids: string[] = [];

    for (const name of names) {
      const existing = existingByName.get(this.normalizeLabelKey(name));
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const created = await this.createBoardLabel(boardId, name);
      ids.push(created.id);
      existingByName.set(this.normalizeLabelKey(name), created);
    }

    return ids;
  }

  private async createBoardLabel(
    boardId: string,
    name: string,
  ): Promise<TrelloLabelResponse> {
    const response = await this.client.post<TrelloLabelResponse>(
      '/labels',
      null,
      {
        params: {
          ...this.authParams(),
          idBoard: boardId,
          name,
          color: this.getLabelColor(name),
        },
      },
    );
    return response.data;
  }

  private normalizeLabelNames(labels: string[] | undefined): string[] {
    return Array.from(
      new Set(
        (labels ?? [])
          .map((label) => String(label).trim())
          .filter(Boolean)
          .map((label) => label.slice(0, 64)),
      ),
    ).slice(0, 8);
  }

  private normalizeLabelKey(label: string): string {
    return label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private getLabelColor(label: string): string {
    const normalized = this.normalizeLabelKey(label);
    if (normalized.includes('critica') || normalized.includes('alta') || normalized.includes('bug')) {
      return 'red';
    }
    if (normalized.includes('sla') || normalized.includes('prioridade')) {
      return 'orange';
    }
    if (normalized.includes('catalog')) return 'blue';
    if (normalized.includes('config')) return 'purple';
    if (normalized.includes('seller')) return 'lime';
    return 'sky';
  }

  async detachCardFromTicket(ticketId: number): Promise<{ ticket: TicketDto }> {
    const ticket = await this.ticketsService.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException('Ticket não encontrado.');
    }

    const updatedTicket = await this.ticketsService.detachTrelloCard(ticketId);
    return { ticket: updatedTicket ?? ticket };
  }

  private async buildMcpTicketContent(ticket: TicketDto): Promise<string> {
    try {
      let detailsText = '';

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
        detailsText = this.removeUnwantedSystemContent(
          this.mcpResultToText(ticketDetails),
        );
      } catch (error) {
        this.logger.warn(
          `MCP consultar_ticket falhou para o ticket #${ticket.id}; usando fallback Movidesk/local: ${(error as Error).message}`,
        );
      }

      if (!detailsText.trim()) {
        this.logger.warn(
          `MCP consultar_ticket nao retornou conteudo util para o ticket #${ticket.id}; usando fallback Movidesk/local.`,
        );
        return this.buildFallbackTicketContent(ticket);
      }

      return [
        `# Ticket #${ticket.id}`,
        '',
        this.defaultCardDescription(ticket),
        `\n## Conteudo Completo\n${detailsText.trim()}`,
      ]
        .filter((section): section is string => Boolean(section))
        .join('\n');
    } catch (error) {
      this.logger.error(
        `Erro ao montar conteúdo do ticket #${ticket.id}: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível montar o conteúdo do chamado. O card do Trello não foi criado.',
      );
    }
  }

  private async buildFallbackTicketContent(ticket: TicketDto): Promise<string> {
    const movideskTicket = await this.fetchMovideskTicketDetails(ticket.id);
    const actionText = this.formatMovideskActions(movideskTicket);

    return [
      `# Ticket #${ticket.id}`,
      '',
      this.defaultCardDescription(ticket),
      actionText ? `\n## Ultimas Interacoes\n${actionText}` : null,
    ]
      .filter((section): section is string => Boolean(section))
      .join('\n');
  }

  private formatMovideskActions(ticket: MovideskTicketDetails | null): string {
    if (!ticket?.actions?.length) return '';

    const visibleActions = ticket.actions
      .filter((action) =>
        `${action.description ?? ''}\n${action.htmlDescription ?? ''}`.trim(),
      );

    return visibleActions
      .map((action) => this.formatMovideskAction(action))
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  private formatMovideskAction(action: MovideskAction): string {
    const body = this.htmlToPlainText(
      action.description || action.htmlDescription || '',
    );
    if (!body) return '';

    const visibility = action.type === 2 ? 'Publica' : 'Interna';
    const author =
      action.createdBy?.businessName || action.createdBy?.name || 'Sistema';
    const date = action.createdDate ? ` em ${action.createdDate}` : '';

    return [`**Acao ${visibility}** - por ${author}${date}`, '', body].join(
      '\n',
    );
  }

  private async addCardComments(cardId: string, comments: string[]) {
    for (let index = 0; index < comments.length; index += 1) {
      const text =
        comments.length === 1
          ? comments[index]
          : `Conteudo Completo (${index + 1}/${comments.length})\n\n${comments[index]}`;

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
    let uploaded = 0;
    for (const image of images) {
      try {
        await this.uploadImageAttachmentToTrello(cardId, image);
        uploaded += 1;
      } catch (error) {
        failures.push(image.name);
        this.logger.warn(
          `Erro ao anexar imagem ${image.name} no card Trello ${cardId}: ${(error as Error).message}`,
        );
      }
    }
    await this.clearCardCover(cardId);
    this.logger.log(
      `Card Trello ${cardId}: ${uploaded}/${images.length} imagem(ns) anexada(s).`,
    );

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
    await this.client.post(
      `/cards/${encodeURIComponent(cardId)}/attachments`,
      null,
      {
        params: {
          ...this.authParams(),
          name: image.name,
          url: image.url,
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

  private async getTicketImages(ticketId: number): Promise<ImageAttachment[]> {
    const images = new Map<string, ImageAttachment>();
    const add = (image: ImageAttachment) => {
      if (!image.url || images.has(image.url)) return;
      images.set(image.url, image);
    };

    const movideskTicket = await this.fetchMovideskTicketDetails(ticketId);
    for (const attachment of this.extractTicketOpeningAttachments(movideskTicket)) {
      const image = this.imageFromMovideskAttachment(attachment);
      if (image) add(image);
    }

    for (const image of this.extractConversationImages(movideskTicket)) {
      add(image);
    }

    if (images.size === 0) {
      this.logMovideskAttachmentDiagnostics(ticketId, movideskTicket);
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
            $expand: 'actions,attachments,clients,owner',
          },
        },
      );
      return response.data;
    } catch (error) {
      this.logger.warn(
        `Erro ao buscar detalhes expandidos do ticket #${ticketId} no Movidesk: ${(error as Error).message}`,
      );

      try {
        const response = await this.movideskClient.get<MovideskTicketDetails>(
          apiUrl,
          {
            params: {
              token,
              id: ticketId,
            },
          },
        );
        return response.data;
      } catch (fallbackError) {
        this.logger.warn(
          `Erro ao buscar detalhes simples do ticket #${ticketId} no Movidesk: ${(fallbackError as Error).message}`,
        );
        return null;
      }
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
        const localContext = this.textWindowAroundMatch(text, match.index);
        if (resolvedUrl) {
          result.push({
            name: this.imageNameFromUrl(resolvedUrl, alt),
            url: resolvedUrl,
            context: localContext,
          });
        }
      }
    }

    return result;
  }

  private extractConversationImages(
    ticket: MovideskTicketDetails | null,
  ): ImageAttachment[] {
    if (!ticket?.actions?.length) return [];

    const images: ImageAttachment[] = [];
    for (const action of ticket.actions) {
      const actionText = `${action.description ?? ''}\n${action.htmlDescription ?? ''}`;
      if (this.looksLikeSystemInteraction(actionText)) {
        continue;
      }

      const candidates = this.extractImageUrlsFromText(actionText);
      let accepted = 0;
      let rejected = 0;
      for (const image of candidates) {
        if (this.looksLikeSignatureConversationImage(image, actionText)) {
          rejected += 1;
          continue;
        }

        accepted += 1;
        images.push({
          ...image,
          source: action.id ? `actions.${action.id}` : 'actions',
        });
      }

      if (candidates.length > 0) {
        this.logger.log(
          `Acao Movidesk ${action.id ?? 'sem-id'}: ${accepted}/${candidates.length} imagem(ns) inline aceita(s), ${rejected} ignorada(s) como assinatura.`,
        );
      }
    }

    return images;
  }

  private textWindowAroundMatch(text: string, index: number): string {
    return text
      .slice(Math.max(0, index - 300), index + 700)
      .replace(/\s+/g, ' ')
      .trim();
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
      this.imageNameFromAttachmentLocator(rawUrl);
    if (
      !this.isImageName(name) &&
      !this.isImageUrl(rawUrl) &&
      !this.isLikelyMovideskStorageHash(rawUrl)
    ) {
      return null;
    }
    if (this.looksLikeSignature(`${name} ${rawUrl}`)) return null;
    if (this.looksLikeSignatureImage(attachment, context)) return null;

    const url = this.resolveMovideskAttachmentUrl(rawUrl);
    if (!url) return null;

    return { name, url, source: attachment.source };
  }

  private extractCustomFieldStorageAttachments(
    value: unknown,
  ): MovideskAttachment[] {
    if (!Array.isArray(value)) return [];

    const attachments: MovideskAttachment[] = [];
    for (const field of value) {
      if (!field || typeof field !== 'object') continue;
      const record = field as Record<string, unknown>;
      const items = Array.isArray(record.items) ? record.items : [];
      const customFieldId = this.pickString(record.customFieldId);

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const itemRecord = item as Record<string, unknown>;
        const storageFileGuid = this.pickString(itemRecord.storageFileGuid);
        if (!storageFileGuid) continue;

        attachments.push({
          storageFileGuid,
          fileName:
            this.pickString(itemRecord.fileName) ||
            `print-${storageFileGuid.slice(0, 8)}.png`,
          source: customFieldId
            ? `customFieldValues.${customFieldId}`
            : 'customFieldValues',
        });
      }
    }

    return attachments;
  }

  private extractTicketOpeningAttachments(
    ticket: MovideskTicketDetails | null,
  ): MovideskAttachment[] {
    if (!ticket) return [];

    return [
      ...this.extractCustomFieldStorageAttachments(ticket.customFieldValues),
      ...this.extractStorageAttachmentsFromUnknown(ticket.assets, 'assets'),
      ...this.extractStorageAttachmentsFromUnknown(
        ticket.attachments,
        'attachments',
      ),
    ];
  }

  private extractStorageAttachmentsFromUnknown(
    value: unknown,
    source: string,
  ): MovideskAttachment[] {
    const attachments: MovideskAttachment[] = [];
    const visited = new WeakSet<object>();

    const visit = (item: unknown, path: string) => {
      if (!item || typeof item !== 'object') return;
      if (visited.has(item)) return;
      visited.add(item);

      if (Array.isArray(item)) {
        item.forEach((child, index) => visit(child, `${path}.${index}`));
        return;
      }

      const record = item as Record<string, unknown>;
      const storageFileGuid =
        this.pickString(record.storageFileGuid) ||
        this.pickString(record.guid) ||
        this.pickString(record.hash);
      const locator =
        storageFileGuid ||
        this.pickString(record.url) ||
        this.pickString(record.uri) ||
        this.pickString(record.href) ||
        this.pickString(record.path);

      if (locator) {
        attachments.push({
          storageFileGuid,
          guid: storageFileGuid ? undefined : this.pickString(record.guid),
          hash: storageFileGuid ? undefined : this.pickString(record.hash),
          url: this.pickString(record.url),
          uri: this.pickString(record.uri),
          href: this.pickString(record.href),
          path: this.pickString(record.path),
          fileName:
            this.pickString(record.fileName) ||
            this.pickString(record.originalFileName) ||
            this.pickString(record.name) ||
            (this.isLikelyMovideskStorageHash(locator)
              ? `print-${locator.slice(0, 8)}.png`
              : ''),
          source: path,
          size:
            typeof record.size === 'number'
              ? record.size
              : typeof record.length === 'number'
                ? record.length
                : undefined,
        });
      }

      for (const [key, child] of Object.entries(record)) {
        if (key === 'actions' || key === 'description' || key === 'htmlDescription') {
          continue;
        }
        visit(child, `${path}.${key}`);
      }
    };

    visit(value, source);
    return attachments;
  }

  private logMovideskAttachmentDiagnostics(
    ticketId: number,
    ticket: MovideskTicketDetails | null,
  ) {
    if (!ticket) {
      this.logger.warn(
        `Ticket #${ticketId}: Movidesk nao retornou detalhes para buscar anexos.`,
      );
      return;
    }

    this.logger.warn(
      [
        `Ticket #${ticketId}: nenhum anexo de abertura encontrado para o Trello.`,
        `keys=${Object.keys(ticket).sort().join(',')}`,
        `customFieldValues=${Array.isArray(ticket.customFieldValues) ? ticket.customFieldValues.length : 'nao-array'}`,
        `assets=${Array.isArray(ticket.assets) ? ticket.assets.length : 'nao-array'}`,
        `attachments=${Array.isArray(ticket.attachments) ? ticket.attachments.length : 'nao-array'}`,
      ].join(' '),
    );
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

  private imageNameFromAttachmentLocator(locator: string): string {
    const name = this.imageNameFromUrl(locator);
    if (this.isImageName(name)) return name;

    if (this.isLikelyMovideskStorageHash(locator)) {
      return `print-${locator.slice(0, 8)}.png`;
    }

    return name;
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

  private htmlToPlainText(html: string): string {
    return this.decodeHtmlEntities(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]*>/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private removeUnwantedSystemContent(text: string): string {
    return text
      .split(/\n---\n/g)
      .filter((block) => !this.looksLikeSignature(block))
      .join('\n---\n')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/https?:\/\/\S+\/storage\/download\?\S+/gi, '')
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

  private looksLikeSignatureConversationImage(
    image: ImageAttachment,
    context: string,
  ): boolean {
    const normalizedName = this.normalizeForSignatureCheck(image.name);
    const urlWithoutQuery = this.urlWithoutQueryString(image.url);
    if (this.isKnownSignatureImageUrl(urlWithoutQuery)) return true;

    const normalizedUrl = this.normalizeForSignatureCheck(urlWithoutQuery);
    const imageHasSignatureHint =
      normalizedName.includes('assinatura') ||
      normalizedName.includes('signature') ||
      normalizedName.includes('napp') ||
      normalizedUrl.includes('assinatura') ||
      normalizedUrl.includes('signature') ||
      normalizedUrl.includes('napp') ||
      normalizedUrl.includes('kaue');

    return imageHasSignatureHint;
  }

  private isKnownSignatureImageUrl(rawUrl: string): boolean {
    try {
      const parsed = new URL(this.decodeHtmlEntities(rawUrl));
      const fileId = parsed.pathname.split('/').filter(Boolean).pop();
      return fileId
        ? this.signatureImageHashes.has(fileId.toLowerCase())
        : false;
    } catch {
      const fileId = rawUrl.split('/').filter(Boolean).pop();
      return fileId
        ? this.signatureImageHashes.has(fileId.toLowerCase())
        : false;
    }
  }

  private urlWithoutQueryString(rawUrl: string): string {
    try {
      const parsed = new URL(this.decodeHtmlEntities(rawUrl));
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return rawUrl.split('?')[0] ?? rawUrl;
    }
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
      `Ticket: #${ticket.id}`,
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
