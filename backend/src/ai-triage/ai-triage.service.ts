import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import axios from 'axios';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import { TicketsService } from '../tickets/tickets.service';
import { TicketDetailDto } from '../tickets/ticket.entity';
import { TrelloService } from '../trello/trello.service';
import {
  AiTriageMemoryDto,
  CodeAnalysisContextDto,
  CodeSnippetDto,
  TicketAiTriageDto,
  TicketAiTriageMessageDto,
  TicketAiTriageResult,
  TriageDecision,
} from './ai-triage.dto';

const DEFAULT_API_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_CLI_MODEL = 'sonnet';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_CLI_TIMEOUT_MS = Number(
  process.env.CLAUDE_CLI_TIMEOUT_MS || 300_000,
);
const CODE_ANALYSIS_TIMEOUT_MS = Number(
  process.env.AI_TRIAGE_CODE_TIMEOUT_MS || 45_000,
);
const GIT_PULL_TIMEOUT_MS = Number(
  process.env.AI_TRIAGE_GIT_PULL_TIMEOUT_MS || 60_000,
);
const MAX_CODE_FILES = 8;
const MAX_SNIPPET_CHARS = 1_200;
const MAX_FILE_BYTES = 120_000;
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.go',
  '.json',
  '.md',
  '.sql',
  '.css',
  '.yaml',
  '.yml',
]);
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'vendor',
]);
const SECRET_FILE_PATTERNS = [
  '.env',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'id_rsa',
  'private',
  'secret',
];
const SEARCH_STOP_WORDS = new Set([
  'cliente',
  'ticket',
  'chamado',
  'problema',
  'erro',
  'sistema',
  'usuario',
  'usuarios',
  'informou',
  'informa',
  'quando',
  'onde',
  'para',
  'como',
  'esta',
  'este',
  'essa',
  'isso',
  'nao',
  'mais',
  'dados',
  'realizar',
  'consegue',
]);
const SEARCH_ALIASES: Record<string, string[]> = {
  produto: ['product', 'item', 'sku'],
  produtos: ['product', 'products', 'item', 'items', 'sku'],
  relatorio: ['report', 'export'],
  relatorios: ['report', 'reports', 'export'],
  preco: ['price', 'pricing', 'value'],
  precos: ['price', 'prices', 'pricing', 'value'],
  estoque: ['stock', 'inventory'],
  cliente: ['customer', 'client', 'organization'],
  cnpj: ['document', 'seller_document'],
  ean: ['catalog', 'product'],
  loja: ['store', 'shop'],
  pedido: ['order'],
  pedidos: ['order', 'orders'],
  promocao: ['promotion', 'discount'],
};

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicTextBlock[];
}

type AiTriageProvider = 'claude_cli' | 'anthropic_api';
type AiTriageMode = 'triage' | 'code_analysis';
type ClaudeCliStartupStatus = 'pending' | 'ready' | 'failed' | 'disabled';

interface TriageRow {
  id: number;
  ticket_id: number;
  provider: string;
  model: string;
  status: TicketAiTriageDto['status'];
  triage: TicketAiTriageResult | null;
  input_summary: Record<string, unknown> | null;
  error: string | null;
  decision: string | null;
  follow_up_messages: TicketAiTriageMessageDto[] | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface MemoryRow {
  id: number;
  status: AiTriageMemoryDto['status'];
  likely_area: string;
  technical_pattern: string;
  code_paths: TicketAiTriageResult['codeInvestigationPaths'] | null;
  diagnostic_queries: TicketAiTriageResult['diagnosticQueries'] | null;
  confidence: TicketAiTriageResult['confidence'];
}

interface DiagnosticDbContext {
  schema: string;
  tables: Array<{
    name: string;
    type: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
    }>;
  }>;
}

export interface ClaudeCliStatus {
  provider: AiTriageProvider;
  command: string;
  model: string;
  repoRoot: string;
  status: ClaudeCliStartupStatus;
  version: string | null;
  error: string | null;
  checkedAt: string | null;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function toDto(row: TriageRow): TicketAiTriageDto {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    triage: row.triage,
    input_summary: row.input_summary,
    error: row.error,
    decision: row.decision,
    follow_up_messages: Array.isArray(row.follow_up_messages)
      ? row.follow_up_messages
      : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class AiTriageService implements OnModuleInit {
  private readonly logger = new Logger(AiTriageService.name);
  private readonly provider = this.getProvider();
  private readonly model = this.getModel();
  private readonly codeAnalysisModel =
    process.env.AI_TRIAGE_CODE_MODEL || 'haiku';
  private readonly claudeCommand = process.env.CLAUDE_CLI_COMMAND || 'claude';
  private readonly repoRoot = resolve(
    process.env.AI_TRIAGE_REPO_ROOT || join(process.cwd(), '..'),
  );
  private readonly diagnosticMcpEntrypoint =
    process.env.AI_DIAGNOSTIC_MCP_ENTRYPOINT ||
    join(this.repoRoot, 'mcp-db-readonly', 'dist', 'index.js');
  private readonly shouldGitPull =
    String(process.env.AI_TRIAGE_GIT_PULL || 'true').toLowerCase() !== 'false';
  private claudeCliStatus: ClaudeCliStatus = {
    provider: this.provider,
    command: this.claudeCommand,
    model: this.model,
    repoRoot: this.repoRoot,
    status: this.provider === 'claude_cli' ? 'pending' : 'disabled',
    version: null,
    error: null,
    checkedAt: null,
  };

  constructor(
    @Inject(DB_TOKEN) private readonly db: Pool,
    private readonly ticketsService: TicketsService,
    private readonly trelloService: TrelloService,
  ) {}

  onModuleInit() {
    if (this.provider !== 'claude_cli') {
      this.logger.log(
        'Triagem IA usando Anthropic API; Claude CLI desativado.',
      );
      return;
    }

    if (
      String(process.env.CLAUDE_CLI_STARTUP_CHECK || 'true').toLowerCase() ===
      'false'
    ) {
      this.claudeCliStatus = {
        ...this.claudeCliStatus,
        status: 'disabled',
        checkedAt: new Date().toISOString(),
      };
      this.logger.warn('Verificação automática do Claude CLI desativada.');
      return;
    }

    void this.refreshClaudeCliStatus();
  }

  getClaudeStatus() {
    return this.claudeCliStatus;
  }

  async refreshClaudeCliStatus() {
    if (this.provider !== 'claude_cli') {
      return this.claudeCliStatus;
    }

    try {
      const version = await this.runClaudeVersionCheck();
      this.claudeCliStatus = {
        ...this.claudeCliStatus,
        status: 'ready',
        version,
        error: null,
        checkedAt: new Date().toISOString(),
      };
      this.logger.log(`Claude CLI pronto no backend: ${version}`);
    } catch (error) {
      this.claudeCliStatus = {
        ...this.claudeCliStatus,
        status: 'failed',
        version: null,
        error: getErrorMessage(error),
        checkedAt: new Date().toISOString(),
      };
      this.logger.error(
        `Claude CLI indisponível no backend: ${getErrorMessage(error)}`,
      );
    }

    return this.claudeCliStatus;
  }

  async getLatestForTicket(
    ticketId: number,
  ): Promise<TicketAiTriageDto | null> {
    const result = await this.db.query<TriageRow>(
      `SELECT *
         FROM ticket_ai_triages
        WHERE ticket_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [ticketId],
    );
    return result.rows[0] ? toDto(result.rows[0]) : null;
  }

  async start(
    ticketId: number,
    mode: AiTriageMode = 'triage',
    technicalContext: CodeAnalysisContextDto = {},
  ): Promise<{ triage: TicketAiTriageDto }> {
    const ticket = await this.ticketsService.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');

    const result = await this.db.query<TriageRow>(
      `INSERT INTO ticket_ai_triages (ticket_id, provider, model, status, input_summary)
       VALUES ($1, 'claude', $2, 'pending', $3)
       RETURNING *`,
      [
        ticketId,
        this.getModelForMode(mode),
        JSON.stringify({ mode, technicalContext }),
      ],
    );
    const triage = toDto(result.rows[0]);

    void this.runAnalysis(triage.id, ticketId, mode, technicalContext).catch(
      (error) => {
        this.logger.error(`Triagem IA ${triage.id} falhou`, error);
      },
    );

    return { triage };
  }

  async setDecision(
    id: number,
    decision: TriageDecision,
  ): Promise<TicketAiTriageDto | null> {
    const result = await this.db.query<TriageRow>(
      `UPDATE ticket_ai_triages
         SET decision = $1, updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [decision, id],
    );
    if (result.rows[0] && decision !== 'copied') {
      await this.updateMemoryStatus(
        id,
        decision === 'ignored' ? 'rejected' : 'validated',
      );
    }
    return result.rows[0] ? toDto(result.rows[0]) : null;
  }

  async sendFollowUp(
    id: number,
    message: string,
  ): Promise<TicketAiTriageDto | null> {
    const current = await this.db.query<TriageRow>(
      `SELECT * FROM ticket_ai_triages WHERE id = $1`,
      [id],
    );
    const row = current.rows[0];
    if (!row) return null;

    const ticket = await this.ticketsService.findById(row.ticket_id);
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');

    const existingMessages = Array.isArray(row.follow_up_messages)
      ? row.follow_up_messages
      : [];
    const userMessage: TicketAiTriageMessageDto = {
      role: 'user',
      content: message.trim(),
      created_at: new Date().toISOString(),
    };
    const assistantMessage: TicketAiTriageMessageDto = {
      role: 'assistant',
      content: await this.callFollowUpAssistant({
        ticket,
        triage: row.triage,
        messages: [...existingMessages, userMessage],
      }),
      created_at: new Date().toISOString(),
    };
    const messages = [...existingMessages, userMessage, assistantMessage].slice(
      -30,
    );

    const updated = await this.db.query<TriageRow>(
      `UPDATE ticket_ai_triages
         SET follow_up_messages = $1,
             updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(messages), id],
    );

    return updated.rows[0] ? toDto(updated.rows[0]) : null;
  }

  private async runAnalysis(
    id: number,
    ticketId: number,
    mode: AiTriageMode,
    technicalContext: CodeAnalysisContextDto,
  ) {
    await this.updateStatus(id, 'running');

    try {
      const ticket = await this.ticketsService.findById(ticketId);
      if (!ticket) throw new NotFoundException('Ticket não encontrado.');
      const ticketDetail = await this.getTicketDetail(ticketId);

      let gitPull: Record<string, unknown> | null = null;
      if (mode === 'code_analysis' && this.shouldGitPull) {
        try {
          gitPull = {
            ...(await this.gitPullRepo()),
            success: true,
          };
        } catch (error) {
          gitPull = {
            command: `git -C ${this.repoRoot} pull --ff-only`,
            success: false,
            error: getErrorMessage(error),
          };
          this.logger.warn(
            `Análise de código continuará com o checkout local porque o git pull falhou: ${getErrorMessage(error)}`,
          );
        }
      }
      const snippets =
        mode === 'code_analysis'
          ? await this.findRelevantCodeSnippets(ticket, ticketDetail)
          : [];
      const databaseContext =
        mode === 'code_analysis'
          ? await this.getDiagnosticDatabaseContext(ticket, ticketDetail)
          : null;
      const memories =
        mode === 'code_analysis'
          ? await this.findRelevantMemories(ticket, ticketDetail)
          : [];
      const inputSummary = {
        mode,
        codeTools: mode === 'code_analysis' ? ['repository_index'] : [],
        databaseTools: mode === 'code_analysis' && this.hasDbDiagnostics(),
        gitPull,
        ticket,
        ticketDetail: {
          category: ticketDetail?.category,
          urgency: ticketDetail?.urgency,
          serviceFull: ticketDetail?.serviceFull,
          interactionCount: ticketDetail?.interactions.length ?? 0,
        },
        codeSnippetCount: snippets.length,
        codePaths: snippets.map((snippet) => snippet.path),
        databaseTables:
          databaseContext?.tables.map((table) => table.name) ?? [],
        memoryCount: memories.length,
        memoryIds: memories.map((memory) => memory.id),
        technicalContext,
      };

      const triage = await this.callClaude(
        ticket,
        ticketDetail,
        snippets,
        mode,
        memories,
        databaseContext,
        technicalContext,
      );
      if (mode === 'code_analysis') {
        triage.executedQueries = await this.executeDiagnosticQueries(
          triage.diagnosticQueries,
        );
      }

      await this.db.query(
        `UPDATE ticket_ai_triages
           SET status = 'completed',
               triage = $1,
               input_summary = $2,
               error = NULL,
               updated_at = now(),
               finished_at = now()
         WHERE id = $3`,
        [JSON.stringify(triage), JSON.stringify(inputSummary), id],
      );

      if (mode === 'code_analysis') {
        await this.saveMemoryCandidate(
          id,
          ticketId,
          ticket,
          ticketDetail,
          triage,
        );
      }
      await this.markMemoriesUsed(memories.map((memory) => memory.id));
      await this.applyTrelloLabels(ticket, triage);
    } catch (error) {
      await this.db.query(
        `UPDATE ticket_ai_triages
           SET status = 'failed',
               error = $1,
               updated_at = now(),
               finished_at = now()
         WHERE id = $2`,
        [getErrorMessage(error), id],
      );
      throw error;
    }
  }

  private async applyTrelloLabels(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    triage: TicketAiTriageResult,
  ) {
    if (!ticket.trello_card_id) return;

    try {
      await this.trelloService.applyLabelsToTicketCard(
        ticket,
        this.buildTrelloLabels(triage),
      );
    } catch (error) {
      this.logger.warn(
        `Não foi possível aplicar labels da triagem IA no card Trello do ticket #${ticket.id}: ${getErrorMessage(error)}`,
      );
    }
  }

  private buildTrelloLabels(triage: TicketAiTriageResult) {
    return Array.from(
      new Set(
        [
          ...triage.suggestedCard.labels,
          ...triage.tags,
          triage.priority !== 'baixa' ? triage.priority : null,
        ].filter((label): label is string => Boolean(label?.trim())),
      ),
    ).slice(0, 8);
  }

  private async updateStatus(id: number, status: TicketAiTriageDto['status']) {
    await this.db.query(
      `UPDATE ticket_ai_triages SET status = $1, updated_at = now() WHERE id = $2`,
      [status, id],
    );
  }

  private async callClaude(
    ticket: Awaited<ReturnType<TicketsService['findById']>>,
    ticketDetail: TicketDetailDto | null,
    snippets: CodeSnippetDto[],
    mode: AiTriageMode,
    memories: AiTriageMemoryDto[],
    databaseContext: DiagnosticDbContext | null,
    technicalContext: CodeAnalysisContextDto,
  ): Promise<TicketAiTriageResult> {
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');

    const similarTickets = await this.ticketsService.getSimilarTickets(
      ticket.id,
      5,
    );
    const prompt = this.buildPrompt(
      ticket,
      ticketDetail,
      snippets,
      mode,
      similarTickets,
      memories,
      databaseContext,
      technicalContext,
    );
    let triage: TicketAiTriageResult;
    try {
      const text =
        this.provider === 'anthropic_api'
          ? await this.callAnthropicApi(prompt)
          : await this.callClaudeCli(prompt, mode);
      if (!text) throw new Error('Claude não retornou texto para a triagem.');
      triage = this.parseTriageResult(text, ticket);
    } catch (error) {
      if (
        mode !== 'code_analysis' ||
        !getErrorMessage(error).includes('excedeu')
      ) {
        throw error;
      }
      this.logger.warn(
        `Síntese IA excedeu o tempo; usando análise técnica determinística: ${getErrorMessage(error)}`,
      );
      triage = this.buildDeterministicTechnicalResult(
        ticket,
        snippets,
        databaseContext,
      );
    }

    if (mode === 'code_analysis') {
      triage = await this.sanitizeCodeAnalysisResult(
        triage,
        snippets,
        databaseContext,
        technicalContext,
      );
      const qualityProblems = await this.getCodeAnalysisQualityProblems(
        triage,
        databaseContext,
      );

      if (qualityProblems.length) {
        throw new Error(
          `A análise de código não produziu evidências suficientes: ${qualityProblems.join('; ')}`,
        );
      }
    } else {
      triage = this.sanitizeOperationalTriageResult(triage);
    }

    return triage;
  }

  private sanitizeOperationalTriageResult(
    triage: TicketAiTriageResult,
  ): TicketAiTriageResult {
    const operationalSteps = triage.nextSteps.filter(
      (step) =>
        !/\b(query|queries|select|sql|banco de dados|database|arquivo|caminho no c[oó]digo)\b/i.test(
          step,
        ),
    );

    return {
      ...triage,
      relevantFiles: [],
      diagnosticQueries: [],
      executedQueries: [],
      codeInvestigationPaths: [],
      nextSteps: operationalSteps.length
        ? operationalSteps
        : [
            'Confirmar o impacto e coletar os identificadores necessários com o solicitante.',
            'Encaminhar o chamado à área provável com o histórico e as evidências disponíveis.',
          ],
    };
  }

  private buildDeterministicTechnicalResult(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    snippets: CodeSnippetDto[],
    databaseContext: DiagnosticDbContext | null,
  ): TicketAiTriageResult {
    const tables = databaseContext?.tables.map((table) => table.name) ?? [];
    return {
      tags: ['analise-tecnica', 'fallback'],
      priority: 'media',
      shouldCreateCard: false,
      summary:
        'O pacote técnico foi coletado, mas a síntese da IA excedeu o limite. Abaixo estão arquivos e consultas gerados diretamente pelo backend.',
      symptom: ticket.subject || 'Sintoma técnico não informado.',
      likelyArea: tables.length
        ? `Tabelas relacionadas: ${tables.slice(0, 6).join(', ')}`
        : 'Área técnica a confirmar pelos arquivos selecionados.',
      reasoning:
        'Resultado determinístico baseado no índice do repositório e no catálogo real do banco. Use as consultas executadas e os caminhos indicados para aprofundar a hipótese.',
      technicalHypothesis:
        'A causa ainda precisa ser confirmada com os filtros fornecidos e os arquivos selecionados.',
      evidence: [
        `${snippets.length} arquivo(s) relacionado(s) foram selecionados no repositório.`,
        `${tables.length} tabela(s) relacionada(s) foram encontradas no schema de diagnóstico.`,
      ],
      relevantFiles: snippets.slice(0, 6).map((snippet) => ({
        path: snippet.path,
        reason: `Trecho relevante nas linhas ${snippet.startLine}-${snippet.endLine}.`,
      })),
      diagnosticQueries: [],
      executedQueries: [],
      codeInvestigationPaths: snippets.slice(0, 5).map((snippet) => ({
        path: snippet.path,
        symbol: '',
        reason: 'Arquivo selecionado pelo indexador técnico.',
        check: `Revisar o fluxo nas linhas ${snippet.startLine}-${snippet.endLine}.`,
      })),
      nextSteps: [
        'Revisar as consultas realmente executadas e seus totais de linhas.',
        'Abrir os caminhos de código listados e comparar com os registros encontrados.',
        'Refinar os seller IDs/EANs e executar novamente se necessário.',
      ],
      suggestedCard: {
        title: `[ticket #${ticket.id}] Investigação técnica`,
        description: '',
        labels: ['investigacao'],
      },
      suggestedCustomerReply: '',
      similarTickets: [],
      customerQuestions: [],
      confidence: 'baixa',
    };
  }

  private async sanitizeCodeAnalysisResult(
    triage: TicketAiTriageResult,
    snippets: CodeSnippetDto[],
    databaseContext: DiagnosticDbContext | null,
    technicalContext: CodeAnalysisContextDto,
  ): Promise<TicketAiTriageResult> {
    const realPaths = new Set<string>();
    for (const snippet of snippets) {
      try {
        if ((await fs.stat(resolve(this.repoRoot, snippet.path))).isFile()) {
          realPaths.add(snippet.path);
        }
      } catch {
        // Snippets ausentes não entram no resultado sanitizado.
      }
    }

    const codeInvestigationPaths = triage.codeInvestigationPaths.filter(
      (item) => realPaths.has(item.path),
    );
    if (!codeInvestigationPaths.length) {
      codeInvestigationPaths.push(
        ...snippets.slice(0, 4).map((snippet) => ({
          path: snippet.path,
          symbol: '',
          reason:
            'Arquivo selecionado pelo indexador técnico para este ticket.',
          check: `Revisar o fluxo próximo às linhas ${snippet.startLine}-${snippet.endLine} e validar sua relação com a hipótese.`,
        })),
      );
    }

    let diagnosticQueries = databaseContext
      ? triage.diagnosticQueries.filter((query) =>
          this.isQueryCompatibleWithContext(query.sql, databaseContext),
        )
      : triage.diagnosticQueries;
    if (technicalContext.sellerIds?.length) {
      diagnosticQueries = diagnosticQueries.filter((query) =>
        technicalContext.sellerIds?.every((id) => query.sql.includes(id)),
      );
    }
    if (technicalContext.eans?.length) {
      diagnosticQueries = diagnosticQueries.filter((query) =>
        technicalContext.eans?.every((ean) => query.sql.includes(ean)),
      );
    }
    if (!diagnosticQueries.length && databaseContext?.tables.length) {
      const contextualTables = databaseContext.tables.filter((table) => {
        const columns = new Set(table.columns.map((column) => column.name));
        return (
          (!technicalContext.sellerIds?.length ||
            columns.has('fk_seller_id')) &&
          (!technicalContext.eans?.length || columns.has('ean'))
        );
      });
      const hasTechnicalFilters = Boolean(
        technicalContext.sellerIds?.length || technicalContext.eans?.length,
      );
      const fallbackTables = hasTechnicalFilters
        ? contextualTables
        : databaseContext.tables;
      diagnosticQueries = fallbackTables.slice(0, 3).map((table) => {
        const preferredColumns = table.columns
          .filter((column) =>
            /^(id|fk_.*_id|ean|sku|.*price.*|.*pmc.*|.*status.*|.*updated_at.*|.*created_at.*)$/i.test(
              column.name,
            ),
          )
          .slice(0, 12)
          .map((column) => `"${column.name}"`);
        const columns = preferredColumns.length
          ? preferredColumns.join(', ')
          : '*';
        const orderColumn = table.columns.find((column) =>
          /^(updated_at|created_at|checked_at)$/i.test(column.name),
        )?.name;
        const filters: string[] = [];
        if (
          technicalContext.sellerIds?.length &&
          table.columns.some((column) => column.name === 'fk_seller_id')
        ) {
          filters.push(
            `"fk_seller_id" = ANY(ARRAY[${technicalContext.sellerIds
              .map((id) => `'${id}'`)
              .join(', ')}]::uuid[])`,
          );
        }
        if (
          technicalContext.eans?.length &&
          table.columns.some((column) => column.name === 'ean')
        ) {
          filters.push(
            `"ean" = ANY(ARRAY[${technicalContext.eans
              .map((ean) => `'${ean.replace(/'/g, "''")}'`)
              .join(', ')}]::text[])`,
          );
        }
        return {
          title: `Inspecionar ${databaseContext.schema}.${table.name}`,
          purpose:
            'Consulta segura gerada pelo backend a partir do catálogo real para coletar evidências iniciais.',
          sql: `SELECT ${columns}\nFROM "${databaseContext.schema}"."${table.name}"${filters.length ? `\nWHERE ${filters.join('\n  AND ')}` : ''}${orderColumn ? `\nORDER BY "${orderColumn}" DESC` : ''}\nLIMIT 100;`,
          expectedEvidence:
            'Use as linhas retornadas para identificar padrões, estados e chaves que permitam refinar o diagnóstico.',
        };
      });
    }

    return {
      ...triage,
      relevantFiles: triage.relevantFiles.filter((item) =>
        realPaths.has(item.path),
      ),
      codeInvestigationPaths,
      diagnosticQueries,
    };
  }

  private isQueryCompatibleWithContext(
    sql: string,
    databaseContext: DiagnosticDbContext,
  ) {
    const tableMap = new Map(
      databaseContext.tables.map((table) => [
        table.name,
        new Set(table.columns.map((column) => column.name)),
      ]),
    );
    const aliases = new Map<string, string>();
    for (const match of sql.matchAll(
      /\b(?:from|join)\s+(?:[a-zA-Z_][\w]*\.)?["]?([a-zA-Z_][\w]*)["]?\s+(?:as\s+)?([a-zA-Z_][\w]*)/gi,
    )) {
      const [, table, alias] = match;
      if (!tableMap.has(table)) return false;
      aliases.set(alias, table);
    }
    if (!aliases.size) {
      const tableMatch = sql.match(
        /\bfrom\s+(?:[a-zA-Z_][\w]*\.)?["]?([a-zA-Z_][\w]*)["]?/i,
      );
      if (!tableMatch || !tableMap.has(tableMatch[1])) return false;
    }
    for (const match of sql.matchAll(
      /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b/g,
    )) {
      const [, alias, column] = match;
      const table = aliases.get(alias);
      if (table && !tableMap.get(table)?.has(column)) return false;
    }
    return /^(select|with)\b/i.test(sql) && /\blimit\s+\d+\b/i.test(sql);
  }

  private async executeDiagnosticQueries(
    queries: TicketAiTriageResult['diagnosticQueries'],
  ): Promise<TicketAiTriageResult['executedQueries']> {
    const connectionString = process.env.AI_DIAGNOSTIC_DB_URL?.trim();
    if (!connectionString) return [];

    const pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 5_000,
    });
    const results: TicketAiTriageResult['executedQueries'] = [];

    try {
      for (const query of queries.slice(0, 3)) {
        const startedAt = Date.now();
        const sql = query.sql.trim().replace(/;\s*$/, '');
        if (
          /<[^>]+>/.test(sql) ||
          !/^(select|with)\b/i.test(sql) ||
          !/\blimit\s+\d+\b/i.test(sql) ||
          /;|--|\/\*|\*\//.test(sql) ||
          /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|execute|vacuum|analyze|refresh|reindex)\b/i.test(
            sql,
          )
        ) {
          results.push({
            title: query.title,
            sql: query.sql,
            status: 'skipped',
            rowCount: null,
            durationMs: Date.now() - startedAt,
            error:
              'Consulta não executada: contém placeholder ou não passou na validação read-only.',
            columns: [],
            sampleRows: [],
            sampleTruncated: false,
          });
          continue;
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN READ ONLY');
          await client.query('SET LOCAL TRANSACTION READ ONLY');
          await client.query(`SET LOCAL statement_timeout = '5000ms'`);
          const execution = await client.query(sql);
          await client.query('ROLLBACK');
          results.push({
            title: query.title,
            sql: query.sql,
            status: 'completed',
            rowCount: execution.rowCount ?? execution.rows.length,
            durationMs: Date.now() - startedAt,
            error: '',
            columns: execution.fields.map((field) => field.name),
            sampleRows: execution.rows
              .slice(0, 10)
              .map((row) => this.toSafeQueryPreviewRow(row)),
            sampleTruncated: execution.rows.length > 10,
          });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          results.push({
            title: query.title,
            sql: query.sql,
            status: 'failed',
            rowCount: null,
            durationMs: Date.now() - startedAt,
            error: getErrorMessage(error).slice(0, 500),
            columns: [],
            sampleRows: [],
            sampleTruncated: false,
          });
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end().catch(() => undefined);
    }

    return results;
  }

  private toSafeQueryPreviewRow(
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        this.toSafeQueryPreviewValue(value),
      ]),
    );
  }

  private toSafeQueryPreviewValue(value: unknown): unknown {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[binário: ${value.length} bytes]`;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).slice(0, 500);
      } catch {
        return '[objeto não serializável]';
      }
    }
    return String(value).slice(0, 500);
  }

  private async callFollowUpAssistant({
    ticket,
    triage,
    messages,
  }: {
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>;
    triage: TicketAiTriageResult | null;
    messages: TicketAiTriageMessageDto[];
  }) {
    const prompt = JSON.stringify(
      {
        instruction:
          'Responda ao analista com base no ticket, na triagem salva e no histórico. O usuário pode colar erro, resultado de SELECT, hipótese ou ideia. Seja objetivo, explique o que o erro indica, diga se muda a hipótese e sugira próximos passos práticos. Não invente dados, não diga que corrigiu nada e não peça para executar alterações destrutivas.',
        ticket,
        triage,
        conversation: messages,
      },
      null,
      2,
    );

    if (this.provider === 'anthropic_api') {
      return this.callAnthropicFollowUp(prompt);
    }

    const systemPrompt = [
      'Você é um analista técnico de suporte e engenharia da Napp.',
      'Você responde follow-ups de uma triagem já feita.',
      'Não altere código, não crie commits, não afirme que algo foi corrigido.',
      'Responda em português, em texto claro e curto. Markdown simples é permitido.',
    ].join(' ');

    const text = await this.runClaudeCli([
      '--print',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--tools',
      '',
      '--model',
      this.model,
      '--system-prompt',
      systemPrompt,
      prompt,
    ]);

    return text || 'Não consegui gerar uma resposta para esse retorno.';
  }

  private async callAnthropicFollowUp(prompt: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY não configurada no backend.');
    }

    const response = await axios.post<AnthropicMessageResponse>(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.model,
        max_tokens: 1400,
        temperature: 0.2,
        system:
          'Você é um analista técnico de suporte e engenharia da Napp. Responda follow-ups de triagem em português, de forma objetiva. Não altere código e não invente dados.',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        timeout: 60_000,
      },
    );

    return (
      response.data.content
        ?.filter((block): block is AnthropicTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim() || 'Não consegui gerar uma resposta para esse retorno.'
    );
  }

  private async callAnthropicApi(prompt: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY não configurada no backend.');
    }

    const response = await axios.post<AnthropicMessageResponse>(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.model,
        max_tokens: 2200,
        temperature: 0.2,
        system: [
          'Você é um analista técnico de suporte e engenharia da Napp.',
          'Você faz triagem de tickets usando dados do chamado e trechos de código fornecidos.',
          'Você não pode alterar código, criar commits, executar comandos ou afirmar que algo foi corrigido.',
          'Você deve orientar um humano e responder somente JSON válido, sem markdown.',
        ].join(' '),
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        timeout: 60_000,
      },
    );

    return response.data.content
      ?.filter((block): block is AnthropicTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
  }

  private async callClaudeCli(
    prompt: string,
    mode: AiTriageMode,
    timeoutMs = mode === 'code_analysis'
      ? CODE_ANALYSIS_TIMEOUT_MS
      : CLAUDE_CLI_TIMEOUT_MS,
  ) {
    const systemPrompt = [
      'Você é um analista técnico de suporte e engenharia da Napp.',
      mode === 'code_analysis'
        ? 'Você recebe um pacote técnico já coletado pelo backend, contendo trechos reais do repositório e catálogo filtrado do banco. Analise somente esse material, cite caminhos e colunas reais e produza SELECTs read-only prontos. Não tente explorar ferramentas externas.'
        : 'Você faz triagem rápida usando somente os dados do chamado e os trechos fornecidos no prompt.',
      'Você não pode alterar código, criar commits, executar comandos ou afirmar que algo foi corrigido.',
      'Não use ferramentas. Você deve concluir com o contexto fornecido.',
      'Você deve orientar um humano e responder somente JSON válido, sem markdown.',
    ].join(' ');

    const args = [
      '--print',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--model',
      this.getModelForMode(mode),
      '--effort',
      'low',
      '--system-prompt',
      systemPrompt,
      prompt,
    ];

    args.splice(6, 0, '--tools', '');

    return this.runClaudeCli(args, timeoutMs);
  }

  private hasDbDiagnostics() {
    return Boolean(process.env.AI_DIAGNOSTIC_DB_URL?.trim());
  }

  private async getCodeAnalysisQualityProblems(
    triage: TicketAiTriageResult,
    databaseContext: DiagnosticDbContext | null,
  ): Promise<string[]> {
    const problems: string[] = [];
    const paths = unique([
      ...triage.relevantFiles.map((item) => item.path),
      ...triage.codeInvestigationPaths.map((item) => item.path),
    ]);
    const realPaths: string[] = [];

    for (const path of paths) {
      const candidates = [resolve(this.repoRoot, path), resolve(path)].filter(
        (candidate) => candidate.startsWith(this.repoRoot),
      );

      for (const candidate of candidates) {
        try {
          if ((await fs.stat(candidate)).isFile()) {
            realPaths.push(path);
            break;
          }
        } catch {
          // A qualidade é avaliada pelo conjunto; caminhos ausentes são ignorados aqui.
        }
      }
    }

    if (!realPaths.length) {
      problems.push('nenhum arquivo real do repositório foi citado');
    }
    if (
      triage.codeInvestigationPaths.some(
        (item) => !realPaths.includes(item.path),
      )
    ) {
      problems.push(
        'há caminhos de código prováveis ou inexistentes; cite somente arquivos reais',
      );
    }
    if (!triage.codeInvestigationPaths.some((item) => item.check.trim())) {
      problems.push(
        'nenhum ponto concreto do código foi indicado para conferência',
      );
    }
    if (!triage.diagnosticQueries.length) {
      problems.push('nenhum SELECT read-only foi entregue');
    }
    if (
      triage.diagnosticQueries.some(
        (item) =>
          !/\blimit\s+\d+\b/i.test(item.sql) ||
          !/^(select|with)\b/i.test(item.sql),
      )
    ) {
      problems.push('há SELECT sem LIMIT ou fora do formato read-only');
    }
    if (databaseContext) {
      const tableMap = new Map(
        databaseContext.tables.map((table) => [
          table.name,
          new Set(table.columns.map((column) => column.name)),
        ]),
      );
      const sqlProblems = new Set<string>();

      for (const query of triage.diagnosticQueries) {
        const aliases = new Map<string, string>();
        for (const match of query.sql.matchAll(
          /\b(?:from|join)\s+(?:[a-zA-Z_][\w]*\.)?([a-zA-Z_][\w]*)\s+(?:as\s+)?([a-zA-Z_][\w]*)/gi,
        )) {
          const [, table, alias] = match;
          aliases.set(alias, table);
          if (!tableMap.has(table)) {
            sqlProblems.add(`tabela não confirmada: ${table}`);
          }
        }
        for (const match of query.sql.matchAll(
          /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b/g,
        )) {
          const [, alias, column] = match;
          const table = aliases.get(alias);
          if (
            table &&
            tableMap.has(table) &&
            !tableMap.get(table)?.has(column)
          ) {
            sqlProblems.add(`coluna não confirmada: ${table}.${column}`);
          }
        }
      }

      if (sqlProblems.size) {
        problems.push(Array.from(sqlProblems).join(', '));
      }
    }

    return problems;
  }

  private buildDiagnosticMcpConfig() {
    return {
      mcpServers: {
        'db-readonly': {
          command: process.env.AI_DIAGNOSTIC_MCP_COMMAND || 'node',
          args: [this.diagnosticMcpEntrypoint],
          env: {
            AI_DIAGNOSTIC_DB_URL: process.env.AI_DIAGNOSTIC_DB_URL,
            AI_DIAGNOSTIC_DB_SCHEMA:
              process.env.AI_DIAGNOSTIC_DB_SCHEMA || 'public',
            AI_DIAGNOSTIC_DB_MAX_ROWS:
              process.env.AI_DIAGNOSTIC_DB_MAX_ROWS || '100',
            AI_DIAGNOSTIC_DB_STATEMENT_TIMEOUT_MS:
              process.env.AI_DIAGNOSTIC_DB_STATEMENT_TIMEOUT_MS || '5000',
          },
        },
      },
    };
  }

  private runClaudeVersionCheck() {
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(this.claudeCommand, ['--version'], {
        cwd: this.repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            'Claude CLI não respondeu ao check de inicialização em 10s.',
          ),
        );
      }, 10_000);

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timeout);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              `Claude CLI não encontrado no backend. Verifique CLAUDE_CLI_COMMAND="${this.claudeCommand}" ou instale o Claude Code CLI no ambiente do servidor.`,
            ),
          );
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = Buffer.concat(stdout).toString('utf8').trim();
        const errorOutput = Buffer.concat(stderr).toString('utf8').trim();

        if (code !== 0) {
          reject(
            new Error(
              `Claude CLI check terminou com código ${code}.${errorOutput ? ` ${errorOutput}` : ''}`,
            ),
          );
          return;
        }

        resolvePromise(output || 'Claude CLI instalado');
      });
    });
  }

  private runClaudeCli(args: string[], timeoutMs = CLAUDE_CLI_TIMEOUT_MS) {
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(this.claudeCommand, args, {
        cwd: this.repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Claude CLI excedeu ${timeoutMs}ms.`));
      }, timeoutMs);

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timeout);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              `Claude CLI não encontrado no backend. Verifique CLAUDE_CLI_COMMAND="${this.claudeCommand}" ou instale o Claude Code CLI no ambiente do servidor.`,
            ),
          );
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = Buffer.concat(stdout).toString('utf8').trim();
        const errorOutput = Buffer.concat(stderr).toString('utf8').trim();

        if (code !== 0) {
          reject(
            new Error(
              `Claude CLI terminou com código ${code}.${errorOutput ? ` ${errorOutput}` : ''}`,
            ),
          );
          return;
        }

        resolvePromise(output);
      });
    });
  }

  private gitPullRepo() {
    return new Promise<{ command: string; output: string }>(
      (resolvePromise, reject) => {
        const args = [
          '-c',
          `safe.directory=${this.repoRoot}`,
          '-C',
          this.repoRoot,
          'pull',
          '--ff-only',
        ];
        const child = spawn('git', args, {
          cwd: this.repoRoot,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_SSH_COMMAND:
              process.env.GIT_SSH_COMMAND ||
              'ssh -o StrictHostKeyChecking=accept-new',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const timeout = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`git pull excedeu ${GIT_PULL_TIMEOUT_MS}ms.`));
        }, GIT_PULL_TIMEOUT_MS);

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          const output = [
            Buffer.concat(stdout).toString('utf8').trim(),
            Buffer.concat(stderr).toString('utf8').trim(),
          ]
            .filter(Boolean)
            .join('\n');

          if (code !== 0) {
            reject(
              new Error(
                `Não foi possível atualizar o repositório antes da análise. Rode ou corrija manualmente: git -C ${this.repoRoot} pull --ff-only\n${output}`,
              ),
            );
            return;
          }

          resolvePromise({
            command: `git -C ${this.repoRoot} pull --ff-only`,
            output,
          });
        });
      },
    );
  }

  private getProvider(): AiTriageProvider {
    const provider = process.env.AI_TRIAGE_PROVIDER || 'claude_cli';
    return provider === 'anthropic_api' ? 'anthropic_api' : 'claude_cli';
  }

  private getModel() {
    if (this.provider === 'anthropic_api') {
      return process.env.ANTHROPIC_MODEL || DEFAULT_API_MODEL;
    }
    return process.env.CLAUDE_CLI_MODEL || DEFAULT_CLI_MODEL;
  }

  private getModelForMode(mode: AiTriageMode) {
    if (this.provider === 'anthropic_api') return this.model;
    return mode === 'code_analysis' ? this.codeAnalysisModel : this.model;
  }

  private buildPrompt(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    ticketDetail: TicketDetailDto | null,
    snippets: CodeSnippetDto[],
    mode: AiTriageMode,
    similarTickets: Awaited<ReturnType<TicketsService['getSimilarTickets']>>,
    memories: AiTriageMemoryDto[],
    databaseContext: DiagnosticDbContext | null,
    technicalContext: CodeAnalysisContextDto,
  ) {
    const technicalSchema = {
      priority: 'baixa | media | alta | critica',
      summary: 'string curta',
      symptom: 'string curta',
      likelyArea: 'string',
      reasoning: 'string objetiva',
      technicalHypothesis: 'string',
      evidence: ['string'],
      relevantFiles: [
        { path: 'caminho real de codeSnippets', reason: 'string' },
      ],
      diagnosticQueries: [
        {
          title: 'string',
          purpose: 'string',
          sql: 'SELECT/WITH read-only pronto para copiar, usando somente tabelas e colunas de databaseContext',
          expectedEvidence: 'como interpretar o resultado',
        },
      ],
      codeInvestigationPaths: [
        {
          path: 'caminho real de codeSnippets',
          symbol: 'função, classe ou query visível no trecho',
          reason: 'string',
          check: 'verificação concreta',
        },
      ],
      nextSteps: ['string'],
      confidence: 'baixa | media | alta',
    };
    const triageSchema = {
      tags: ['string'],
      priority: 'baixa | media | alta | critica',
      shouldCreateCard: 'boolean',
      summary: 'string',
      symptom: 'string',
      likelyArea: 'área ou equipe provável, sem inventar arquivo',
      reasoning: 'string',
      technicalHypothesis:
        'hipótese inicial baseada somente no chamado; deixe vazio se não houver evidência',
      evidence: ['string'],
      nextSteps: ['string'],
      suggestedCard: {
        title: 'string',
        description: 'string',
        labels: ['string'],
      },
      suggestedCustomerReply:
        'string em português, pronto para enviar ao cliente, sem prometer correção e sem inventar prazo',
      similarTickets: [{ id: 'number', subject: 'string', reason: 'string' }],
      customerQuestions: ['string'],
      confidence: 'baixa | media | alta',
    };

    return JSON.stringify(
      {
        mode,
        instruction:
          mode === 'code_analysis'
            ? 'Faça uma análise técnica profunda e acionável usando exclusivamente os codeSnippets e databaseContext já coletados. Relacione arquivos, funções, tabelas e colunas reais. Gere de 1 a 3 SELECTs read-only com filtros parametrizados e LIMIT. Se o pacote não comprovar a causa, entregue hipóteses verificáveis sem inventar nomes. Responda exatamente no schema solicitado.'
            : 'Faça uma triagem operacional rápida usando somente o chamado e seu histórico. Classifique prioridade, resuma o problema, identifique a área ou equipe provável, indique perguntas ao cliente, próximos passos operacionais e uma resposta pronta. Não analise repositório, não proponha SQL e não invente arquivos, tabelas ou detalhes técnicos. Responda exatamente no schema solicitado.',
        qualityRules:
          mode === 'code_analysis'
            ? [
                'Não repita o assunto como hipótese.',
                'Cada hipótese deve dizer por que é plausível e como pode ser refutada.',
                'Gere de 1 a 3 diagnosticQueries. Use apenas SELECT ou WITH; nunca UPDATE, DELETE, INSERT, DDL ou funções com efeito colateral.',
                'Não invente nomes de tabelas ou colunas como se fossem confirmados. Quando o schema não estiver disponível, marque placeholders com <tabela>, <coluna_cliente>, <id_registro> e explique o que substituir.',
                'Cada SELECT deve ter filtro restritivo, LIMIT e uma finalidade clara.',
                'Gere de 1 a 5 codeInvestigationPaths usando somente caminhos presentes em codeSnippets. Informe símbolo/função visível e exatamente o que conferir.',
                'nextSteps deve formar uma ordem de investigação: reproduzir, coletar evidência, validar banco, percorrer código e definir critério de conclusão.',
              ]
            : [
                'Não repita o assunto como hipótese.',
                'Use apenas evidências presentes no chamado e no histórico.',
                'Não gere SQL, caminhos de arquivos ou afirmações sobre implementação.',
                'Diferencie fatos relatados de hipóteses iniciais.',
                'nextSteps deve priorizar confirmação do impacto, coleta das informações faltantes, encaminhamento à equipe correta e critério de conclusão.',
                'A resposta ao cliente deve ser clara, sem prometer correção ou prazo.',
              ],
        schema: mode === 'code_analysis' ? technicalSchema : triageSchema,
        ticket,
        ticketDetail: this.toPromptTicketDetail(ticketDetail),
        technicalMemory: memories.map((memory) => ({
          id: memory.id,
          validation: memory.status,
          likelyArea: memory.likelyArea,
          technicalPattern: memory.technicalPattern,
          codePaths: memory.codePaths,
          diagnosticQueries: memory.diagnosticQueries,
          confidence: memory.confidence,
        })),
        memoryRules: [
          'Memórias validadas são pistas fortes, mas ainda devem ser verificadas contra o ticket atual.',
          'Memórias candidatas são apenas sugestões anteriores e não podem ser tratadas como fatos.',
          'Adapte SELECTs parametrizados ao caso atual sem inserir dados pessoais na resposta.',
          'Se uma memória divergir do código ou banco atual, ignore-a e explique a divergência em reasoning.',
        ],
        technicalContext: {
          sellerIds: technicalContext.sellerIds ?? [],
          eans: technicalContext.eans ?? [],
          notes: technicalContext.notes?.trim() || '',
        },
        technicalContextRules: [
          'Se sellerIds forem fornecidos, use-os diretamente em filtros fk_seller_id com ANY(ARRAY[...]::uuid[]) para limitar as consultas.',
          'Se eans forem fornecidos, use-os diretamente em filtros ean com ANY(ARRAY[...]::text[]).',
          'Nunca remova esses filtros nem amplie a consulta para outras lojas/produtos sem explicar.',
        ],
        similarTickets:
          mode === 'code_analysis'
            ? []
            : similarTickets.map((item) => ({
                id: item.id,
                subject: item.subject,
                status: item.status,
                ownerTeam: item.ownerTeam,
                score: item.score,
                reasons: item.reasons,
                previousTriage: item.ai_triage
                  ? {
                      priority: item.ai_triage.priority,
                      summary: item.ai_triage.summary,
                      likelyArea: item.ai_triage.likelyArea,
                    }
                  : null,
              })),
        codeSnippets: snippets,
        databaseContext,
      },
      null,
      2,
    );
  }

  private parseTriageResult(
    text: string,
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
  ): TicketAiTriageResult {
    const jsonText = this.extractJson(text);
    const parsed = JSON.parse(jsonText) as Partial<TicketAiTriageResult>;

    return {
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map(String).slice(0, 8)
        : ['triagem'],
      priority: this.asEnum(
        parsed.priority,
        ['baixa', 'media', 'alta', 'critica'],
        'media',
      ),
      shouldCreateCard: Boolean(parsed.shouldCreateCard),
      summary: String(parsed.summary || 'Sem resumo retornado.'),
      symptom: String(
        parsed.symptom || ticket.subject || 'Sintoma não identificado.',
      ),
      likelyArea: String(
        parsed.likelyArea || ticket.ownerTeam || 'Área não identificada',
      ),
      reasoning: String(parsed.reasoning || ''),
      technicalHypothesis: String(parsed.technicalHypothesis || ''),
      evidence: Array.isArray(parsed.evidence)
        ? parsed.evidence.map(String).slice(0, 8)
        : [],
      relevantFiles: Array.isArray(parsed.relevantFiles)
        ? parsed.relevantFiles
            .map((item) => ({
              path: String(item?.path || ''),
              reason: String(item?.reason || ''),
            }))
            .filter((item) => item.path)
            .slice(0, 10)
        : [],
      diagnosticQueries: Array.isArray(parsed.diagnosticQueries)
        ? parsed.diagnosticQueries
            .map((item) => ({
              title: String(item?.title || 'Consulta de diagnóstico'),
              purpose: String(item?.purpose || ''),
              sql: String(item?.sql || '').trim(),
              expectedEvidence: String(item?.expectedEvidence || ''),
            }))
            .filter((item) => /^(select|with)\b/i.test(item.sql))
            .slice(0, 5)
        : [],
      executedQueries: [],
      codeInvestigationPaths: Array.isArray(parsed.codeInvestigationPaths)
        ? parsed.codeInvestigationPaths
            .map((item) => ({
              path: String(item?.path || ''),
              symbol: String(item?.symbol || ''),
              reason: String(item?.reason || ''),
              check: String(item?.check || ''),
            }))
            .filter((item) => item.path)
            .slice(0, 6)
        : [],
      nextSteps: Array.isArray(parsed.nextSteps)
        ? parsed.nextSteps.map(String).slice(0, 10)
        : [],
      suggestedCard: {
        title: String(
          parsed.suggestedCard?.title ||
            `[ticket #${ticket.id}] ${ticket.subject || 'Triagem técnica'}`,
        ).slice(0, 180),
        description: String(parsed.suggestedCard?.description || ''),
        labels: Array.isArray(parsed.suggestedCard?.labels)
          ? parsed.suggestedCard.labels.map(String).slice(0, 8)
          : [],
      },
      suggestedCustomerReply: String(
        parsed.suggestedCustomerReply ||
          [
            'Olá! Obrigado pelo contato.',
            'Já recebemos sua solicitação e estamos analisando o cenário informado.',
            'Caso tenha prints, exemplos de produtos impactados ou mensagens de erro, pode nos encaminhar para acelerar a investigação.',
          ].join(' '),
      ),
      similarTickets: Array.isArray(parsed.similarTickets)
        ? parsed.similarTickets
            .map((item) => ({
              id: Number(item?.id) || 0,
              subject: String(item?.subject || ''),
              reason: String(item?.reason || ''),
            }))
            .filter((item) => item.id && item.subject)
            .slice(0, 5)
        : [],
      customerQuestions: Array.isArray(parsed.customerQuestions)
        ? parsed.customerQuestions.map(String).slice(0, 8)
        : [],
      confidence: this.asEnum(
        parsed.confidence,
        ['baixa', 'media', 'alta'],
        'media',
      ),
    };
  }

  private extractJson(text: string) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta do Claude não contém JSON válido.');
    return match[0];
  }

  private asEnum<T extends string>(
    value: unknown,
    allowed: T[],
    fallback: T,
  ): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
  }

  private async findRelevantCodeSnippets(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    ticketDetail: TicketDetailDto | null,
  ): Promise<CodeSnippetDto[]> {
    const terms = this.extractSearchTerms(ticket, ticketDetail);
    if (!terms.length) return [];

    const files = await this.listCodeFiles(this.repoRoot);
    const scored: Array<{ path: string; score: number; content: string }> = [];

    for (const filePath of files) {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_FILE_BYTES) continue;

      const content = await fs.readFile(filePath, 'utf8');
      const normalized = normalize(content);
      const normalizedPath = normalize(relative(this.repoRoot, filePath));
      const score = terms.reduce((total, term, index) => {
        const priority = Math.max(1, 8 - Math.floor(index / 4));
        const pathScore = normalizedPath.includes(term) ? 100 * priority : 0;
        const occurrences = normalized.split(term).length - 1;
        return total + pathScore + Math.min(occurrences, 4) * priority;
      }, 0);
      if (score > 0) scored.push({ path: filePath, score, content });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CODE_FILES)
      .map((item) => this.toSnippet(item.path, item.content, terms));
  }

  private extractSearchTerms(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    ticketDetail: TicketDetailDto | null,
  ) {
    const primarySource = [
      ticket.subject,
      ticketDetail?.category,
      ...(ticketDetail?.serviceFull ?? []),
      ...(ticketDetail?.tags ?? []),
    ]
      .filter(Boolean)
      .join(' ');
    const secondarySource = [
      ticket.ownerTeam,
      ticketDetail?.summary,
      ...(ticketDetail?.interactions.slice(-6).map((item) => item.text) ?? []),
    ]
      .filter(Boolean)
      .join(' ');
    const words = [primarySource, secondarySource]
      .flatMap((source) => normalize(source).split(/[^a-z0-9]+/))
      .filter(
        (word) =>
          word.length >= 3 &&
          !/^\d+$/.test(word) &&
          !SEARCH_STOP_WORDS.has(word),
      );
    const expanded = [
      ...words,
      ...words.flatMap((word) => SEARCH_ALIASES[word] ?? []),
    ];
    return unique(expanded).slice(0, 24);
  }

  private async getTicketDetail(
    ticketId: number,
  ): Promise<TicketDetailDto | null> {
    try {
      return await this.ticketsService.getDetail(ticketId);
    } catch (error) {
      this.logger.warn(
        `Triagem do ticket #${ticketId} continuará sem detalhes completos: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async getDiagnosticDatabaseContext(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    ticketDetail: TicketDetailDto | null,
  ): Promise<DiagnosticDbContext | null> {
    const connectionString = process.env.AI_DIAGNOSTIC_DB_URL?.trim();
    if (!connectionString) return null;

    const schema = process.env.AI_DIAGNOSTIC_DB_SCHEMA?.trim() || 'public';
    const pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 5_000,
    });

    try {
      const result = await pool.query<{
        table_name: string;
        table_type: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT
           t.table_name,
           t.table_type,
           c.column_name,
           c.data_type,
           c.is_nullable
         FROM information_schema.tables t
         JOIN information_schema.columns c
           ON c.table_schema = t.table_schema
          AND c.table_name = t.table_name
        WHERE t.table_schema = $1
        ORDER BY t.table_name, c.ordinal_position`,
        [schema],
      );
      const terms = this.extractSearchTerms(ticket, ticketDetail);
      const grouped = new Map<string, DiagnosticDbContext['tables'][number]>();

      for (const row of result.rows) {
        const table = grouped.get(row.table_name) ?? {
          name: row.table_name,
          type: row.table_type,
          columns: [],
        };
        table.columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
        });
        grouped.set(row.table_name, table);
      }

      const rankedTables = Array.from(grouped.values())
        .map((table) => {
          const tableName = normalize(table.name);
          const columnNames = table.columns.map((column) =>
            normalize(column.name),
          );
          const score = terms.reduce((total, term, index) => {
            const priority = Math.max(1, 8 - Math.floor(index / 4));
            if (tableName === term) return total + 20 * priority;
            if (tableName.includes(term)) return total + 8 * priority;
            if (columnNames.some((column) => column.includes(term))) {
              return total + 2 * priority;
            }
            return total;
          }, 0);
          return { table, score };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 4)
        .map((item) => item.table);
      const selectedNames = new Set(rankedTables.map((table) => table.name));

      for (let level = 0; level < 2 && selectedNames.size < 12; level += 1) {
        const currentTables = Array.from(selectedNames)
          .map((name) => grouped.get(name))
          .filter((table): table is DiagnosticDbContext['tables'][number] =>
            Boolean(table),
          );
        for (const table of currentTables) {
          for (const column of table.columns) {
            const match = column.name.match(/^fk_(.+)_id$/);
            if (match && grouped.has(match[1])) selectedNames.add(match[1]);
            if (selectedNames.size >= 12) break;
          }
          if (selectedNames.size >= 12) break;
        }
      }

      const tables = Array.from(selectedNames)
        .map((name) => grouped.get(name))
        .filter((table): table is DiagnosticDbContext['tables'][number] =>
          Boolean(table),
        )
        .map((table) => ({
          ...table,
          columns: table.columns.slice(0, 40),
        }));

      return { schema, tables };
    } catch (error) {
      this.logger.warn(
        `Não foi possível coletar o catálogo do banco de diagnóstico: ${getErrorMessage(error)}`,
      );
      return null;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private async findRelevantMemories(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    ticketDetail: TicketDetailDto | null,
  ): Promise<AiTriageMemoryDto[]> {
    const keywords = this.extractSearchTerms(ticket, ticketDetail);
    if (!keywords.length) return [];

    const result = await this.db.query<MemoryRow>(
      `SELECT
         id,
         status,
         likely_area,
         technical_pattern,
         code_paths,
         diagnostic_queries,
         confidence
       FROM ai_triage_memories
       WHERE status IN ('validated', 'candidate')
         AND keywords && $1::text[]
       ORDER BY
         CASE status WHEN 'validated' THEN 0 ELSE 1 END,
         cardinality(ARRAY(
           SELECT unnest(keywords)
           INTERSECT
           SELECT unnest($1::text[])
         )) DESC,
         updated_at DESC
       LIMIT 6`,
      [keywords],
    );

    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      likelyArea: row.likely_area,
      technicalPattern: row.technical_pattern,
      codePaths: Array.isArray(row.code_paths) ? row.code_paths : [],
      diagnosticQueries: Array.isArray(row.diagnostic_queries)
        ? row.diagnostic_queries
        : [],
      confidence: row.confidence,
    }));
  }

  private async saveMemoryCandidate(
    triageId: number,
    ticketId: number,
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    ticketDetail: TicketDetailDto | null,
    triage: TicketAiTriageResult,
  ) {
    const codePaths = triage.codeInvestigationPaths
      .filter((item) => item.path && item.check)
      .slice(0, 6);
    const diagnosticQueries = triage.diagnosticQueries
      .map((item) => ({
        ...item,
        sql: this.toMemorySqlTemplate(item.sql),
      }))
      .filter((item) => item.sql)
      .slice(0, 5);

    if (!codePaths.length && !diagnosticQueries.length) return;

    const keywords = unique([
      ...this.extractSearchTerms(ticket, ticketDetail),
      ...triage.tags.map(normalize),
      ...normalize(triage.likelyArea).split(/[^a-z0-9]+/),
    ])
      .filter((item) => item.length >= 3 && !SEARCH_STOP_WORDS.has(item))
      .slice(0, 30);
    const technicalPattern = this.redactMemoryText(
      triage.technicalHypothesis || triage.reasoning,
      ticket,
      ticketDetail,
    ).slice(0, 1_500);
    const likelyArea = this.redactMemoryText(
      triage.likelyArea,
      ticket,
      ticketDetail,
    ).slice(0, 300);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          likelyArea: normalize(likelyArea),
          technicalPattern: normalize(technicalPattern),
          codePaths: codePaths
            .map((item) => `${item.path}:${item.symbol}`)
            .sort(),
          diagnosticQueries: diagnosticQueries.map((item) => item.sql).sort(),
        }),
      )
      .digest('hex');

    await this.db.query(
      `INSERT INTO ai_triage_memories (
         fingerprint,
         source_triage_id,
         source_ticket_id,
         keywords,
         likely_area,
         technical_pattern,
         code_paths,
         diagnostic_queries,
         confidence
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (fingerprint) DO UPDATE
         SET source_triage_id = EXCLUDED.source_triage_id,
             source_ticket_id = EXCLUDED.source_ticket_id,
             keywords = ARRAY(
               SELECT DISTINCT value
               FROM unnest(ai_triage_memories.keywords || EXCLUDED.keywords) AS value
               LIMIT 40
             ),
             likely_area = EXCLUDED.likely_area,
             technical_pattern = EXCLUDED.technical_pattern,
             code_paths = EXCLUDED.code_paths,
             diagnostic_queries = EXCLUDED.diagnostic_queries,
             confidence = EXCLUDED.confidence,
             updated_at = now()`,
      [
        fingerprint,
        triageId,
        ticketId,
        keywords,
        likelyArea,
        technicalPattern,
        JSON.stringify(codePaths),
        JSON.stringify(diagnosticQueries),
        triage.confidence,
      ],
    );
  }

  private async updateMemoryStatus(
    triageId: number,
    status: AiTriageMemoryDto['status'],
  ) {
    await this.db.query(
      `UPDATE ai_triage_memories
          SET status = $1,
              updated_at = now()
        WHERE source_triage_id = $2`,
      [status, triageId],
    );
  }

  private async markMemoriesUsed(ids: number[]) {
    if (!ids.length) return;
    await this.db.query(
      `UPDATE ai_triage_memories
          SET use_count = use_count + 1,
              last_used_at = now()
        WHERE id = ANY($1::int[])`,
      [ids],
    );
  }

  private toMemorySqlTemplate(sql: string) {
    if (!/^(select|with)\b/i.test(sql)) return '';

    const withoutStrings = sql.replace(/'(?:''|[^'])*'/g, "'<value>'");
    return withoutStrings.replace(/\b\d+\b/g, (value, offset, source) => {
      const prefix = source.slice(Math.max(0, offset - 12), offset);
      return /\blimit\s*$/i.test(prefix) ? value : '<number>';
    });
  }

  private redactMemoryText(
    value: string,
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    ticketDetail: TicketDetailDto | null,
  ) {
    const sensitiveValues = [
      ticket.subject,
      ...(ticketDetail?.clients.flatMap((client) => [
        client.name,
        client.email,
        client.organization,
      ]) ?? []),
    ].filter((item): item is string => Boolean(item?.trim()));

    return sensitiveValues.reduce(
      (text, sensitive) =>
        text.replace(
          new RegExp(this.escapeRegExp(sensitive), 'gi'),
          '<contexto_do_cliente>',
        ),
      value,
    );
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private toPromptTicketDetail(ticketDetail: TicketDetailDto | null) {
    if (!ticketDetail) return null;

    return {
      ...ticketDetail,
      summary: ticketDetail.summary.slice(0, 4_000),
      interactions: ticketDetail.interactions.slice(-12).map((interaction) => ({
        ...interaction,
        text: interaction.text.slice(0, 3_000),
      })),
    };
  }

  private async listCodeFiles(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        files.push(...(await this.listCodeFiles(fullPath)));
        continue;
      }

      if (!entry.isFile()) continue;
      const lowerName = entry.name.toLowerCase();
      if (SECRET_FILE_PATTERNS.some((pattern) => lowerName.includes(pattern))) {
        continue;
      }
      if (!CODE_EXTENSIONS.has(extname(entry.name))) continue;
      files.push(fullPath);
    }

    return files;
  }

  private toSnippet(
    path: string,
    content: string,
    terms: string[],
  ): CodeSnippetDto {
    const lines = content.split('\n');
    const matchIndex = Math.max(
      0,
      lines.findIndex((line) => {
        const normalized = normalize(line);
        return terms.some((term) => normalized.includes(term));
      }),
    );
    const startLine = Math.max(1, matchIndex - 8);
    const selected: string[] = [];
    let charCount = 0;

    for (let index = startLine - 1; index < lines.length; index += 1) {
      const line = lines[index];
      charCount += line.length + 1;
      if (charCount > MAX_SNIPPET_CHARS) break;
      selected.push(line);
    }

    return {
      path: relative(this.repoRoot, path) || basename(path),
      startLine,
      endLine: startLine + selected.length - 1,
      content: selected.join('\n'),
    };
  }
}
