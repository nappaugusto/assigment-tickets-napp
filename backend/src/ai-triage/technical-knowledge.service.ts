import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join, relative, resolve } from 'path';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.sql',
  '.go',
]);
const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'vendor',
]);
const MAX_SOURCE_BYTES = 250_000;

export interface TechnicalCatalogColumn {
  name: string;
  type: string;
  nullable: boolean;
  ordinal: number;
}

export interface TechnicalCatalogRelationship {
  column: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
}

export interface TechnicalCodeReference {
  path: string;
  matchCount: number;
  lines: number[];
}

export interface TechnicalKnowledgeEntity {
  key: string;
  schema: string;
  name: string;
  type: string;
  description: string;
  columns: TechnicalCatalogColumn[];
  relationships: TechnicalCatalogRelationship[];
  codeReferences: TechnicalCodeReference[];
  relevanceScore: number;
  relevanceReasons: string[];
}

export interface TechnicalKnowledgeSnapshot {
  catalogRunId: number;
  schema: string;
  generatedAt: string;
  entities: TechnicalKnowledgeEntity[];
}

export interface TechnicalKnowledgeStatus {
  state: 'empty' | 'running' | 'ready' | 'failed';
  runId: number | null;
  schema: string;
  tableCount: number;
  relationshipCount: number;
  codeReferenceCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

interface CatalogTable {
  key: string;
  schema: string;
  name: string;
  type: string;
  columns: TechnicalCatalogColumn[];
  relationships: TechnicalCatalogRelationship[];
  codeReferences: TechnicalCodeReference[];
  description: string;
  searchTerms: string[];
}

interface CatalogEntityRow {
  entity_key: string;
  schema_name: string;
  table_name: string;
  table_type: string;
  description: string;
  columns: TechnicalCatalogColumn[];
  relationships: TechnicalCatalogRelationship[];
  code_references: TechnicalCodeReference[];
  search_terms: string[];
  last_seen_run_id: number;
  updated_at: string;
}

interface CatalogRunRow {
  id: number;
  status: string;
  schema_name: string;
  table_count: number;
  relationship_count: number;
  code_reference_count: number;
  error: string | null;
  started_at: string;
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class TechnicalKnowledgeService {
  private readonly logger = new Logger(TechnicalKnowledgeService.name);
  private readonly repoRoot = resolve(
    process.env.AI_TRIAGE_REPO_ROOT || join(process.cwd(), '..'),
  );
  private refreshPromise: Promise<TechnicalKnowledgeStatus> | null = null;

  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async getStatus(): Promise<TechnicalKnowledgeStatus> {
    const result = await this.db.query<CatalogRunRow>(
      `SELECT *
         FROM ai_technical_catalog_runs
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
    );
    const run = result.rows[0];
    if (!run) {
      return {
        state: 'empty',
        runId: null,
        schema: process.env.AI_DIAGNOSTIC_DB_SCHEMA?.trim() || 'public',
        tableCount: 0,
        relationshipCount: 0,
        codeReferenceCount: 0,
        startedAt: null,
        finishedAt: null,
        error: null,
      };
    }

    return {
      state:
        run.status === 'completed'
          ? 'ready'
          : run.status === 'failed'
            ? 'failed'
            : 'running',
      runId: run.id,
      schema: run.schema_name,
      tableCount: run.table_count,
      relationshipCount: run.relationship_count,
      codeReferenceCount: run.code_reference_count,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      error: run.error,
    };
  }

  refresh(): Promise<TechnicalKnowledgeStatus> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.rebuildCatalog().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async findRelevant(input: {
    terms: string[];
    sellerIds?: string[];
    eans?: string[];
    limit?: number;
  }): Promise<TechnicalKnowledgeSnapshot | null> {
    try {
      await this.ensureFresh();
      const result = await this.db.query<CatalogEntityRow>(
        `SELECT * FROM ai_technical_entities ORDER BY table_name`,
      );
      if (!result.rows.length) return null;

      const terms = unique(input.terms.map(normalize).filter(Boolean));
      const scored = result.rows
        .map((row) => this.scoreEntity(row, terms, input))
        .sort((left, right) => right.score - left.score);
      const maxEntities = Math.min(input.limit ?? 8, 12);
      const selected = scored
        .filter((item) => item.score > 0)
        .slice(0, Math.min(maxEntities, 8));
      const selectedKeys = new Set(selected.map((item) => item.row.entity_key));

      for (const item of [...selected]) {
        const outgoingKeys = (item.row.relationships ?? []).map(
          (relationship) =>
            `${relationship.targetSchema}.${relationship.targetTable}`,
        );
        const incomingKeys = scored
          .filter((candidate) =>
            (candidate.row.relationships ?? []).some(
              (relationship) =>
                `${relationship.targetSchema}.${relationship.targetTable}` ===
                item.row.entity_key,
            ),
          )
          .map((candidate) => candidate.row.entity_key);
        for (const relatedKey of unique([...outgoingKeys, ...incomingKeys])) {
          if (selected.length >= maxEntities) break;
          if (selectedKeys.has(relatedKey)) continue;
          const related = scored.find(
            (candidate) => candidate.row.entity_key === relatedKey,
          );
          if (!related) continue;
          selected.push({
            ...related,
            score: Math.max(related.score, item.score - 10),
            reasons: [
              ...related.reasons,
              `relacionada a ${item.row.entity_key}`,
            ],
          });
          selectedKeys.add(relatedKey);
        }
      }

      for (const item of scored) {
        if (selected.length >= maxEntities) break;
        if (item.score <= 0 || selectedKeys.has(item.row.entity_key)) continue;
        selected.push(item);
        selectedKeys.add(item.row.entity_key);
      }

      const latest = await this.getStatus();
      return {
        catalogRunId: latest.runId ?? result.rows[0].last_seen_run_id,
        schema: latest.schema,
        generatedAt:
          latest.finishedAt ??
          result.rows[0].updated_at ??
          new Date().toISOString(),
        entities: selected
          .sort((left, right) => right.score - left.score)
          .map(({ row, score, reasons }) => ({
            key: row.entity_key,
            schema: row.schema_name,
            name: row.table_name,
            type: row.table_type,
            description: row.description,
            columns: Array.isArray(row.columns) ? row.columns : [],
            relationships: Array.isArray(row.relationships)
              ? row.relationships
              : [],
            codeReferences: Array.isArray(row.code_references)
              ? row.code_references
              : [],
            relevanceScore: score,
            relevanceReasons: unique(reasons),
          })),
      };
    } catch (error) {
      this.logger.warn(
        `Catálogo técnico indisponível; a investigação continuará sem conhecimento persistente: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async ensureFresh() {
    const status = await this.getStatus();
    const ttlHours = Number(process.env.AI_TECHNICAL_CATALOG_TTL_HOURS || 24);
    const finishedAt = status.finishedAt
      ? new Date(status.finishedAt).getTime()
      : 0;
    const isFresh =
      status.state === 'ready' &&
      Date.now() - finishedAt < Math.max(ttlHours, 1) * 60 * 60 * 1_000;
    if (!isFresh) await this.refresh();
  }

  private async rebuildCatalog(): Promise<TechnicalKnowledgeStatus> {
    const connectionString = process.env.AI_DIAGNOSTIC_DB_URL?.trim();
    if (!connectionString) {
      throw new Error(
        'AI_DIAGNOSTIC_DB_URL não configurada para montar o catálogo técnico.',
      );
    }
    const schema = process.env.AI_DIAGNOSTIC_DB_SCHEMA?.trim() || 'public';
    const run = await this.db.query<{ id: number }>(
      `INSERT INTO ai_technical_catalog_runs (schema_name, repository_root)
       VALUES ($1, $2)
       RETURNING id`,
      [schema, this.repoRoot],
    );
    const runId = run.rows[0].id;
    const pool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 5_000,
    });

    try {
      const tables = await this.readDatabaseCatalog(pool, schema);
      await this.attachCodeReferences(tables);
      for (const table of tables) {
        table.description = this.describeTable(table);
        table.searchTerms = this.buildSearchTerms(table);
      }

      const client = await this.db.connect();
      try {
        await client.query('BEGIN');
        for (const table of tables) {
          const sourceHash = createHash('sha256')
            .update(
              JSON.stringify({
                columns: table.columns,
                relationships: table.relationships,
                codeReferences: table.codeReferences,
              }),
            )
            .digest('hex');
          await client.query(
            `INSERT INTO ai_technical_entities (
               entity_key, schema_name, table_name, table_type, description,
               columns, relationships, code_references, search_terms,
               source_hash, last_seen_run_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (entity_key) DO UPDATE
               SET table_type = EXCLUDED.table_type,
                   description = EXCLUDED.description,
                   columns = EXCLUDED.columns,
                   relationships = EXCLUDED.relationships,
                   code_references = EXCLUDED.code_references,
                   search_terms = EXCLUDED.search_terms,
                   source_hash = EXCLUDED.source_hash,
                   last_seen_run_id = EXCLUDED.last_seen_run_id,
                   updated_at = now()`,
            [
              table.key,
              table.schema,
              table.name,
              table.type,
              table.description,
              JSON.stringify(table.columns),
              JSON.stringify(table.relationships),
              JSON.stringify(table.codeReferences),
              table.searchTerms,
              sourceHash,
              runId,
            ],
          );
        }
        await client.query(
          `DELETE FROM ai_technical_entities WHERE last_seen_run_id <> $1`,
          [runId],
        );
        const relationshipCount = tables.reduce(
          (total, table) => total + table.relationships.length,
          0,
        );
        const codeReferenceCount = tables.reduce(
          (total, table) => total + table.codeReferences.length,
          0,
        );
        await client.query(
          `UPDATE ai_technical_catalog_runs
              SET status = 'completed',
                  table_count = $1,
                  relationship_count = $2,
                  code_reference_count = $3,
                  error = NULL,
                  finished_at = now()
            WHERE id = $4`,
          [tables.length, relationshipCount, codeReferenceCount, runId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      this.logger.log(
        `Catálogo técnico #${runId} atualizado: ${tables.length} tabela(s).`,
      );
      return this.getStatus();
    } catch (error) {
      await this.db.query(
        `UPDATE ai_technical_catalog_runs
            SET status = 'failed', error = $1, finished_at = now()
          WHERE id = $2`,
        [getErrorMessage(error).slice(0, 2_000), runId],
      );
      throw error;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private async readDatabaseCatalog(pool: Pool, schema: string) {
    const columnsResult = await pool.query<{
      table_name: string;
      table_type: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      ordinal_position: number;
    }>(
      `SELECT t.table_name, t.table_type, c.column_name, c.data_type,
              c.is_nullable, c.ordinal_position
         FROM information_schema.tables t
         JOIN information_schema.columns c
           ON c.table_schema = t.table_schema
          AND c.table_name = t.table_name
        WHERE t.table_schema = $1
          AND t.table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY t.table_name, c.ordinal_position`,
      [schema],
    );
    const relationshipsResult = await pool.query<{
      table_name: string;
      column_name: string;
      foreign_table_schema: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `SELECT tc.table_name,
              kcu.column_name,
              ccu.table_schema AS foreign_table_schema,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.constraint_schema = kcu.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.constraint_schema = tc.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1`,
      [schema],
    );
    const grouped = new Map<string, CatalogTable>();
    for (const row of columnsResult.rows) {
      const key = `${schema}.${row.table_name}`;
      const table = grouped.get(key) ?? {
        key,
        schema,
        name: row.table_name,
        type: row.table_type,
        columns: [],
        relationships: [],
        codeReferences: [],
        description: '',
        searchTerms: [],
      };
      table.columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        ordinal: row.ordinal_position,
      });
      grouped.set(key, table);
    }
    for (const row of relationshipsResult.rows) {
      grouped.get(`${schema}.${row.table_name}`)?.relationships.push({
        column: row.column_name,
        targetSchema: row.foreign_table_schema,
        targetTable: row.foreign_table_name,
        targetColumn: row.foreign_column_name,
      });
    }
    return Array.from(grouped.values());
  }

  private async attachCodeReferences(tables: CatalogTable[]) {
    const roots = await this.findCodeRoots();
    const files = (
      await Promise.all(roots.map((root) => this.listCodeFiles(root)))
    ).flat();

    for (const file of unique(files)) {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_SOURCE_BYTES) continue;
      const content = await fs.readFile(file, 'utf8').catch(() => '');
      if (!content) continue;
      const normalizedContent = normalize(content);
      const lines = content.split(/\r?\n/);

      for (const table of tables) {
        const tableName = normalize(table.name);
        if (!normalizedContent.includes(tableName)) continue;
        const matchingLines: number[] = [];
        let matchCount = 0;
        lines.forEach((line, index) => {
          const matches = normalize(line).match(
            new RegExp(`\\b${this.escapeRegExp(tableName)}\\b`, 'g'),
          );
          if (!matches?.length) return;
          matchCount += matches.length;
          if (matchingLines.length < 6) matchingLines.push(index + 1);
        });
        if (!matchCount) continue;
        table.codeReferences.push({
          path: relative(this.repoRoot, file),
          matchCount,
          lines: matchingLines,
        });
      }
    }

    for (const table of tables) {
      table.codeReferences.sort(
        (left, right) => right.matchCount - left.matchCount,
      );
      table.codeReferences = table.codeReferences.slice(0, 12);
    }
  }

  private async findCodeRoots() {
    const candidates = [
      join(this.repoRoot, 'backend', 'src'),
      join(this.repoRoot, 'src'),
      this.repoRoot,
    ];
    for (const candidate of candidates) {
      if ((await fs.stat(candidate).catch(() => null))?.isDirectory()) {
        return [candidate];
      }
    }
    return [this.repoRoot];
  }

  private async listCodeFiles(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        files.push(...(await this.listCodeFiles(join(root, entry.name))));
      } else if (CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(join(root, entry.name));
      }
    }
    return files;
  }

  private describeTable(table: CatalogTable) {
    const relationText = table.relationships.length
      ? ` Relaciona-se por FK com ${unique(
          table.relationships.map(
            (relationship) =>
              `${relationship.targetSchema}.${relationship.targetTable}`,
          ),
        ).join(', ')}.`
      : '';
    const codeText = table.codeReferences.length
      ? ` É referenciada no backend por ${table.codeReferences
          .slice(0, 4)
          .map((reference) => reference.path)
          .join(', ')}.`
      : ' Nenhuma referência textual direta foi encontrada no backend.';
    const importantColumns = table.columns
      .filter((column) =>
        /(^id$|^fk_|status|state|ean|sku|price|preco|created_at|updated_at)/i.test(
          column.name,
        ),
      )
      .slice(0, 12)
      .map((column) => column.name);
    return `${table.type === 'VIEW' ? 'View' : 'Tabela'} ${table.key} com ${table.columns.length} coluna(s).${
      importantColumns.length
        ? ` Campos técnicos relevantes: ${importantColumns.join(', ')}.`
        : ''
    }${relationText}${codeText}`;
  }

  private buildSearchTerms(table: CatalogTable) {
    return unique(
      [
        table.name,
        ...table.name.split('_'),
        ...table.columns.flatMap((column) => [
          column.name,
          ...column.name.split('_'),
        ]),
        ...table.relationships.flatMap((relationship) => [
          relationship.targetTable,
          ...relationship.targetTable.split('_'),
        ]),
        ...table.codeReferences.flatMap((reference) =>
          reference.path.split(/[^a-zA-Z0-9]+/),
        ),
      ]
        .map(normalize)
        .filter((term) => term.length >= 2),
    ).slice(0, 120);
  }

  private scoreEntity(
    row: CatalogEntityRow,
    terms: string[],
    input: { sellerIds?: string[]; eans?: string[] },
  ) {
    const tableName = normalize(row.table_name);
    const description = normalize(row.description);
    const columns = Array.isArray(row.columns) ? row.columns : [];
    const columnNames = columns.map((column) => normalize(column.name));
    const searchTerms = new Set(
      (Array.isArray(row.search_terms) ? row.search_terms : []).map(normalize),
    );
    const reasons: string[] = [];
    let score = 0;
    for (const [index, term] of terms.entries()) {
      const weight = Math.max(1, 8 - Math.floor(index / 4));
      if (tableName === term) {
        score += 40 * weight;
        reasons.push(`nome da tabela corresponde a "${term}"`);
      } else if (tableName.includes(term)) {
        score += 15 * weight;
        reasons.push(`nome da tabela contém "${term}"`);
      }
      if (columnNames.some((column) => column.includes(term))) {
        score += 6 * weight;
        reasons.push(`possui coluna relacionada a "${term}"`);
      }
      if (searchTerms.has(term)) score += 4 * weight;
      if (description.includes(term)) score += 2 * weight;
    }
    if (input.sellerIds?.length && columnNames.includes('fk_seller_id')) {
      score += 250;
      reasons.push('aceita o seller ID informado');
    }
    if (input.eans?.length && columnNames.includes('ean')) {
      score += 250;
      reasons.push('aceita o EAN informado');
    }
    if (row.code_references?.length) {
      score += Math.min(
        row.code_references.reduce(
          (total, reference) => total + reference.matchCount,
          0,
        ),
        30,
      );
      reasons.push('possui uso confirmado no backend');
    }
    return { row, score, reasons: unique(reasons).slice(0, 8) };
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
