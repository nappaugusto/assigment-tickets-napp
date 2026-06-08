import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { promises as fs } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import { TicketsService } from '../tickets/tickets.service';
import {
  CodeSnippetDto,
  TicketAiTriageDto,
  TicketAiTriageResult,
  TriageDecision,
} from './ai-triage.dto';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';
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
  created_at: string;
  updated_at: string;
  finished_at: string | null;
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class AiTriageService {
  private readonly logger = new Logger(AiTriageService.name);
  private readonly model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  private readonly repoRoot = resolve(process.env.AI_TRIAGE_REPO_ROOT || join(process.cwd(), '..'));

  constructor(
    @Inject(DB_TOKEN) private readonly db: Pool,
    private readonly ticketsService: TicketsService,
  ) {}

  async getLatestForTicket(ticketId: number): Promise<TicketAiTriageDto | null> {
    const result = await this.db.query<TriageRow>(
      `SELECT * FROM ticket_ai_triages WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [ticketId],
    );
    return result.rows[0] ? toDto(result.rows[0]) : null;
  }

  async start(ticketId: number): Promise<{ triage: TicketAiTriageDto }> {
    const ticket = await this.ticketsService.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');

    const result = await this.db.query<TriageRow>(
      `INSERT INTO ticket_ai_triages (ticket_id, provider, model, status)
       VALUES ($1, 'claude', $2, 'pending')
       RETURNING *`,
      [ticketId, this.model],
    );
    const triage = toDto(result.rows[0]);

    void this.runAnalysis(triage.id, ticketId).catch((error) => {
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

  private async runAnalysis(id: number, ticketId: number) {
    await this.updateStatus(id, 'running');

    try {
      const ticket = await this.ticketsService.findById(ticketId);
      if (!ticket) throw new NotFoundException('Ticket não encontrado.');

      const snippets = await this.findRelevantCodeSnippets(ticket);
      const inputSummary = {
        ticket,
        codeSnippetCount: snippets.length,
        codePaths: snippets.map((snippet) => snippet.path),
      };

      const triage = await this.callClaude(ticket, snippets);

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

  private async updateStatus(id: number, status: TicketAiTriageDto['status']) {
    await this.db.query(
      `UPDATE ticket_ai_triages SET status = $1, updated_at = now() WHERE id = $2`,
      [status, id],
    );
  }

  private async callClaude(
    ticket: Awaited<ReturnType<TicketsService['findById']>>,
    snippets: CodeSnippetDto[],
  ): Promise<TicketAiTriageResult> {
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY não configurada no backend.');
    }

    const prompt = this.buildPrompt(ticket, snippets);
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

    const text = response.data.content
      ?.filter((block): block is AnthropicTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) throw new Error('Claude não retornou texto para a triagem.');
    return this.parseTriageResult(text, ticket);
  }

  private buildPrompt(
    ticket: NonNullable<Awaited<ReturnType<TicketsService['findById']>>>,
    snippets: CodeSnippetDto[],
  ) {
    return JSON.stringify(
      {
        instruction:
          'Analise o ticket e os trechos de código. Gere uma triagem operacional para o suporte decidir se cria card técnico. Responda exatamente no schema solicitado.',
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
          customerQuestions: ['string'],
          confidence: 'baixa | media | alta',
        },
        ticket,
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
