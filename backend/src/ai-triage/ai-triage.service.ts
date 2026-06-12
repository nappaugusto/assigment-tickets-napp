import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import axios from 'axios';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import { TicketsService } from '../tickets/tickets.service';
import { TrelloService } from '../trello/trello.service';
import {
  CodeSnippetDto,
  TicketAiTriageDto,
  TicketAiTriageMessageDto,
  TicketAiTriageResult,
  TriageDecision,
} from './ai-triage.dto';

const DEFAULT_API_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_CLI_MODEL = 'sonnet';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_CLI_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS || 300_000);
const GIT_PULL_TIMEOUT_MS = Number(process.env.AI_TRIAGE_GIT_PULL_TIMEOUT_MS || 60_000);
const MAX_CODE_FILES = 12;
const MAX_SNIPPET_CHARS = 1_800;
const MAX_FILE_BYTES = 120_000;
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.sql',
  '.css',
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
  private readonly claudeCommand = process.env.CLAUDE_CLI_COMMAND || 'claude';
  private readonly repoRoot = resolve(process.env.AI_TRIAGE_REPO_ROOT || join(process.cwd(), '..'));
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
      this.logger.log('Triagem IA usando Anthropic API; Claude CLI desativado.');
      return;
    }

    if (String(process.env.CLAUDE_CLI_STARTUP_CHECK || 'true').toLowerCase() === 'false') {
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
      this.logger.error(`Claude CLI indisponível no backend: ${getErrorMessage(error)}`);
    }

    return this.claudeCliStatus;
  }

  async getLatestForTicket(ticketId: number): Promise<TicketAiTriageDto | null> {
    const result = await this.db.query<TriageRow>(
      `SELECT *
         FROM ticket_ai_triages
        WHERE ticket_id = $1
        ORDER BY
          CASE
            WHEN status IN ('pending', 'running') THEN 0
            WHEN status = 'completed' THEN 1
            ELSE 2
          END,
          created_at DESC,
          id DESC
        LIMIT 1`,
      [ticketId],
    );
    return result.rows[0] ? toDto(result.rows[0]) : null;
  }

  async start(
    ticketId: number,
    mode: AiTriageMode = 'triage',
  ): Promise<{ triage: TicketAiTriageDto }> {
    const ticket = await this.ticketsService.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');

    const result = await this.db.query<TriageRow>(
      `INSERT INTO ticket_ai_triages (ticket_id, provider, model, status)
       VALUES ($1, 'claude', $2, 'pending')
       RETURNING *`,
      [ticketId, this.model],
    );
    const triage = toDto(result.rows[0]);

    void this.runAnalysis(triage.id, ticketId, mode).catch((error) => {
      this.logger.error(`Triagem IA ${triage.id} falhou`, error);
    });

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
    const messages = [...existingMessages, userMessage, assistantMessage].slice(-30);

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

  private async runAnalysis(id: number, ticketId: number, mode: AiTriageMode) {
    await this.updateStatus(id, 'running');

    try {
      const ticket = await this.ticketsService.findById(ticketId);
      if (!ticket) throw new NotFoundException('Ticket não encontrado.');

      const gitPull = mode === 'code_analysis' && this.shouldGitPull
        ? await this.gitPullRepo()
        : null;
      const snippets = await this.findRelevantCodeSnippets(ticket);
      const inputSummary = {
        mode,
        gitPull,
        ticket,
        codeSnippetCount: snippets.length,
        codePaths: snippets.map((snippet) => snippet.path),
      };

      const triage = await this.callClaude(ticket, snippets, mode);

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
    snippets: CodeSnippetDto[],
    mode: AiTriageMode,
  ): Promise<TicketAiTriageResult> {
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');

    const similarTickets = await this.ticketsService.getSimilarTickets(ticket.id, 5);
    const prompt = this.buildPrompt(ticket, snippets, mode, similarTickets);
    const text =
      this.provider === 'anthropic_api'
        ? await this.callAnthropicApi(prompt)
        : await this.callClaudeCli(prompt, mode);

    if (!text) throw new Error('Claude não retornou texto para a triagem.');
    return this.parseTriageResult(text, ticket);
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

    return response.data.content
      ?.filter((block): block is AnthropicTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim() || 'Não consegui gerar uma resposta para esse retorno.';
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

  private async callClaudeCli(prompt: string, mode: AiTriageMode) {
    const hasDbDiagnostics = mode === 'code_analysis' && this.hasDbDiagnostics();
    const systemPrompt = [
      'Você é um analista técnico de suporte e engenharia da Napp.',
      'Você faz triagem de tickets usando somente dados do chamado e trechos de código fornecidos no prompt.',
      'Você não pode alterar código, criar commits, executar comandos ou afirmar que algo foi corrigido.',
      hasDbDiagnostics
        ? 'Você pode usar ferramentas MCP de banco somente para investigar com SELECTs read-only. Use no máximo 5 chamadas de ferramentas de banco. Prefira consultar tabelas por nomes ligados ao ticket. Nunca tente escrever, alterar schema ou executar comandos destrutivos.'
        : mode === 'triage'
          ? 'Esta é uma triagem rápida: não use banco de dados nem ferramentas externas. Baseie-se no ticket e nos trechos de código fornecidos.'
          : 'Você não tem acesso ao banco de dados nesta execução.',
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
      this.model,
      '--system-prompt',
      systemPrompt,
      prompt,
    ];

    if (hasDbDiagnostics) {
      args.splice(
        6,
        0,
        '--mcp-config',
        JSON.stringify(this.buildDiagnosticMcpConfig()),
        '--allowedTools',
        [
          'mcp__db-readonly__listar_schemas',
          'mcp__db-readonly__listar_tabelas',
          'mcp__db-readonly__descrever_tabela',
          'mcp__db-readonly__executar_select',
        ].join(','),
      );
    } else {
      args.splice(6, 0, '--tools', '');
    }

    return this.runClaudeCli(args);
  }

  private hasDbDiagnostics() {
    return Boolean(process.env.AI_DIAGNOSTIC_DB_URL?.trim());
  }

  private buildDiagnosticMcpConfig() {
    return {
      mcpServers: {
        'db-readonly': {
          command: process.env.AI_DIAGNOSTIC_MCP_COMMAND || 'node',
          args: [this.diagnosticMcpEntrypoint],
          env: {
            AI_DIAGNOSTIC_DB_URL: process.env.AI_DIAGNOSTIC_DB_URL,
            AI_DIAGNOSTIC_DB_SCHEMA: process.env.AI_DIAGNOSTIC_DB_SCHEMA || 'public',
            AI_DIAGNOSTIC_DB_MAX_ROWS: process.env.AI_DIAGNOSTIC_DB_MAX_ROWS || '100',
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
        reject(new Error('Claude CLI não respondeu ao check de inicialização em 10s.'));
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

  private runClaudeCli(args: string[]) {
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(this.claudeCommand, args, {
        cwd: this.repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Claude CLI excedeu ${CLAUDE_CLI_TIMEOUT_MS}ms.`));
      }, CLAUDE_CLI_TIMEOUT_MS);

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
    return new Promise<{ command: string; output: string }>((resolvePromise, reject) => {
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
    });
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

  private buildPrompt(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    snippets: CodeSnippetDto[],
    mode: AiTriageMode,
    similarTickets: Awaited<ReturnType<TicketsService['getSimilarTickets']>>,
  ) {
    return JSON.stringify(
      {
        mode,
        instruction:
          mode === 'code_analysis'
            ? 'Faça uma análise técnica mais profunda do ticket usando os trechos de código. Se ferramentas MCP de banco estiverem disponíveis, use somente SELECTs para buscar evidências relevantes antes de concluir, com no máximo 5 chamadas de ferramenta de banco. Não faça exploração ampla de schema. Responda exatamente no schema solicitado.'
            : 'Faça uma triagem rápida e operacional do ticket usando os dados do chamado e trechos de código fornecidos. Não use banco de dados. Foque em resumo, sintoma, prioridade, hipótese inicial e próximos passos. Responda exatamente no schema solicitado.',
        schema: {
          tags: ['string'],
          priority: 'baixa | media | alta | critica',
          shouldCreateCard: 'boolean',
          summary: 'string',
          symptom: 'string',
          likelyArea: 'string',
          reasoning: 'string',
          technicalHypothesis: 'string',
          evidence: ['string'],
          relevantFiles: [{ path: 'string', reason: 'string' }],
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
        },
        ticket,
        similarTickets: similarTickets.map((item) => ({
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
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : ['triagem'],
      priority: this.asEnum(parsed.priority, ['baixa', 'media', 'alta', 'critica'], 'media'),
      shouldCreateCard: Boolean(parsed.shouldCreateCard),
      summary: String(parsed.summary || 'Sem resumo retornado.'),
      symptom: String(parsed.symptom || ticket.subject || 'Sintoma não identificado.'),
      likelyArea: String(parsed.likelyArea || ticket.ownerTeam || 'Área não identificada'),
      reasoning: String(parsed.reasoning || ''),
      technicalHypothesis: String(parsed.technicalHypothesis || ''),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 8) : [],
      relevantFiles: Array.isArray(parsed.relevantFiles)
        ? parsed.relevantFiles
            .map((item) => ({
              path: String(item?.path || ''),
              reason: String(item?.reason || ''),
            }))
            .filter((item) => item.path)
            .slice(0, 10)
        : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String).slice(0, 10) : [],
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
      confidence: this.asEnum(parsed.confidence, ['baixa', 'media', 'alta'], 'media'),
    };
  }

  private extractJson(text: string) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta do Claude não contém JSON válido.');
    return match[0];
  }

  private asEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
  }

  private async findRelevantCodeSnippets(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
  ): Promise<CodeSnippetDto[]> {
    const terms = this.extractSearchTerms(ticket);
    if (!terms.length) return [];

    const files = await this.listCodeFiles(this.repoRoot);
    const scored: Array<{ path: string; score: number; content: string }> = [];

    for (const filePath of files) {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_FILE_BYTES) continue;

      const content = await fs.readFile(filePath, 'utf8');
      const normalized = normalize(content);
      const score = terms.reduce(
        (total, term) => total + (normalized.includes(term) ? 1 : 0),
        0,
      );
      if (score > 0) scored.push({ path: filePath, score, content });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CODE_FILES)
      .map((item) => this.toSnippet(item.path, item.content, terms));
  }

  private extractSearchTerms(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
  ) {
    const source = [
      ticket.subject,
      ticket.status,
      ticket.ownerTeam,
      ticket.responsavel,
    ]
      .filter(Boolean)
      .join(' ');
    const normalized = normalize(source);
    const words = normalized
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !/^\d+$/.test(word));
    return unique(words).slice(0, 16);
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

  private toSnippet(path: string, content: string, terms: string[]): CodeSnippetDto {
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
