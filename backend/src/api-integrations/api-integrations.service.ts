import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parse } from 'yaml';
import { DB_TOKEN } from '../database/database.module';
import {
  CreateApiChannelDto,
  SaveApiRequestDto,
  UpdateApiChannelDto,
} from './api-integrations.dto';

interface ChannelRow {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface RequestRow {
  id: number;
  channel_id: number;
  user_id: number;
  name: string;
  description: string | null;
  method: string;
  url: string;
  auth_type: string;
  auth_config: Record<string, string> | string | null;
  query_params: string | null;
  headers: Record<string, string> | string | null;
  variables: Record<string, string> | string | null;
  body: string | null;
  last_response: Record<string, unknown> | string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface InsomniaItem {
  name?: string;
  url?: string;
  method?: string;
  children?: InsomniaItem[];
  body?: { text?: string };
  headers?: Array<{ name?: string; value?: string; disabled?: boolean }>;
  parameters?: Array<{ name?: string; value?: string; disabled?: boolean }>;
  authentication?: Record<string, unknown>;
  meta?: { description?: string };
}

interface InsomniaExport {
  type?: string;
  name?: string;
  collection?: InsomniaItem[];
  environments?: { data?: Record<string, unknown> };
}

function stringValue(value: unknown, fallback = ''): string {
  return ['string', 'number', 'boolean'].includes(typeof value)
    ? String(value)
    : fallback;
}

function parseJsonObject(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return value as Record<string, string>;
}

function toChannelDto(row: ChannelRow, requests: RequestRow[] = []) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requests: requests.map(toRequestDto),
  };
}

function toRequestDto(row: RequestRow) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    description: row.description ?? '',
    method: row.method,
    url: row.url,
    authType: row.auth_type,
    authConfig: parseJsonObject(row.auth_config),
    queryParams: row.query_params ?? '',
    headers: parseJsonObject(row.headers),
    variables: parseJsonObject(row.variables),
    body: row.body ?? '',
    lastResponse: parseUnknownJson(row.last_response),
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseUnknownJson(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value;
}

function applyVariables(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    return variables[key] ?? '';
  });
}

function applyVariablesToRecord(
  value: Record<string, string>,
  variables: Record<string, string>,
) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      applyVariables(key, variables),
      applyVariables(String(entryValue), variables),
    ]),
  );
}

function redactHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      const isSensitive =
        normalizedKey.includes('authorization') ||
        normalizedKey.includes('token') ||
        normalizedKey.includes('key') ||
        normalizedKey.includes('secret');

      return [key, isSensitive ? '••••••' : value];
    }),
  );
}

function buildUrl(rawUrl: string, rawParams: string | null) {
  const url = new URL(rawUrl);

  (rawParams ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [key, ...valueParts] = line.split('=');
      if (!key.trim()) return;
      url.searchParams.set(key.trim(), valueParts.join('=').trim());
    });

  return url.toString();
}

function buildAuthHeaders(
  authType: string,
  authConfig: Record<string, string>,
): Record<string, string> {
  if (authType === 'bearer' && authConfig.token?.trim()) {
    return { Authorization: `Bearer ${authConfig.token.trim()}` };
  }

  if (authType === 'basic' && authConfig.username?.trim()) {
    const encoded = Buffer.from(
      `${authConfig.username}:${authConfig.password ?? ''}`,
    ).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  if (
    authType === 'apiKey' &&
    authConfig.headerName?.trim() &&
    authConfig.value?.trim()
  ) {
    return { [authConfig.headerName.trim()]: authConfig.value.trim() };
  }

  return {};
}

@Injectable()
export class ApiIntegrationsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async list(userId: number) {
    const channels = await this.db.query<ChannelRow>(
      `
        SELECT *
          FROM api_channels
         WHERE user_id = $1
         ORDER BY updated_at DESC, name ASC
      `,
      [userId],
    );
    const requests = await this.db.query<RequestRow>(
      `
        SELECT *
          FROM api_requests
         WHERE user_id = $1
         ORDER BY updated_at DESC, name ASC
      `,
      [userId],
    );

    return channels.rows.map((channel) =>
      toChannelDto(
        channel,
        requests.rows.filter((request) => request.channel_id === channel.id),
      ),
    );
  }

  async importInsomnia(userId: number, content: string) {
    let exported: InsomniaExport;
    try {
      exported = parse(content) as InsomniaExport;
    } catch {
      throw new BadRequestException('O arquivo YAML do Insomnia é inválido.');
    }

    if (
      !exported ||
      exported.type !== 'collection.insomnia.rest/5.0' ||
      !Array.isArray(exported.collection)
    ) {
      throw new BadRequestException(
        'Formato não suportado. Exporte uma coleção Insomnia YAML v5.',
      );
    }

    const client = await this.db.connect();
    let channelsCreated = 0;
    let channelsUpdated = 0;
    let requestsCreated = 0;
    let requestsUpdated = 0;

    try {
      await client.query('BEGIN');
      const rootName = exported.name?.trim() || 'Insomnia';
      const environment = Object.fromEntries(
        Object.entries(exported.environments?.data ?? {}).map(
          ([key, value]) => [
            key,
            typeof value === 'string' ? value : JSON.stringify(value),
          ],
        ),
      );

      const importItems = async (items: InsomniaItem[], path: string[]) => {
        const directRequests = items.filter((item) => item.url && item.method);
        const folders = items.filter((item) => !item.url && !item.method);
        const channelName = path.length ? path.join(' / ') : rootName;

        if (directRequests.length > 0 || path.length > 0) {
          const channelResult = await client.query<ChannelRow>(
            `
              INSERT INTO api_channels (user_id, name, description, updated_at)
              VALUES ($1, $2, $3, now())
              ON CONFLICT (user_id, name) DO UPDATE SET
                description = excluded.description,
                updated_at = now()
              RETURNING *, (xmax = 0) AS inserted
            `,
            [userId, channelName.slice(0, 80), 'Importado do Insomnia'],
          );
          const channel = channelResult.rows[0] as ChannelRow & {
            inserted: boolean;
          };
          if (channel.inserted) channelsCreated += 1;
          else channelsUpdated += 1;

          for (const item of directRequests) {
            const request = this.convertInsomniaRequest(item, environment);
            const existing = await client.query<{ id: number }>(
              `SELECT id FROM api_requests
                WHERE channel_id = $1 AND user_id = $2
                  AND name = $3 AND method = $4 AND url = $5
                ORDER BY id LIMIT 1`,
              [channel.id, userId, request.name, request.method, request.url],
            );

            const values = [
              channel.id,
              userId,
              request.name,
              request.description,
              request.method,
              request.url,
              request.authType,
              JSON.stringify(request.authConfig),
              request.queryParams,
              JSON.stringify(request.headers),
              JSON.stringify(request.variables),
              request.body,
            ];

            if (existing.rows[0]) {
              await client.query(
                `UPDATE api_requests SET description=$4, method=$5, url=$6,
                   auth_type=$7, auth_config=$8::jsonb, query_params=$9,
                   headers=$10::jsonb, variables=$11::jsonb, body=$12,
                   updated_at=now() WHERE id=$13 AND user_id=$2`,
                [...values, existing.rows[0].id],
              );
              requestsUpdated += 1;
            } else {
              await client.query(
                `INSERT INTO api_requests (
                   channel_id,user_id,name,description,method,url,auth_type,
                   auth_config,query_params,headers,variables,body,updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12,now())`,
                values,
              );
              requestsCreated += 1;
            }
          }
        }

        for (const folder of folders) {
          await importItems(folder.children ?? [], [
            ...path,
            folder.name?.trim() || 'Sem nome',
          ]);
        }
      };

      await importItems(exported.collection, []);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `Não foi possível importar a coleção: ${(error as Error).message}`,
      );
    } finally {
      client.release();
    }

    return {
      success: true,
      channelsCreated,
      channelsUpdated,
      requestsCreated,
      requestsUpdated,
    };
  }

  private convertInsomniaRequest(
    item: InsomniaItem,
    environment: Record<string, string>,
  ) {
    const method = String(item.method).toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new BadRequestException(`Método não suportado: ${method}`);
    }

    const rawUrl = String(item.url);
    const questionMark = rawUrl.indexOf('?');
    const url = questionMark >= 0 ? rawUrl.slice(0, questionMark) : rawUrl;
    const query = new URLSearchParams(
      questionMark >= 0 ? rawUrl.slice(questionMark + 1) : '',
    );
    for (const parameter of item.parameters ?? []) {
      if (!parameter.disabled && parameter.name) {
        query.set(parameter.name, parameter.value ?? '');
      }
    }

    const headers = Object.fromEntries(
      (item.headers ?? [])
        .filter((header) => !header.disabled && header.name)
        .map((header) => [header.name as string, header.value ?? '']),
    );
    const authentication = item.authentication ?? {};
    let authType = 'none';
    let authConfig: Record<string, string> = {};

    if (authentication.disabled !== true && authentication.type === 'bearer') {
      authType = 'bearer';
      authConfig = { token: stringValue(authentication.token) };
    } else if (
      authentication.disabled !== true &&
      authentication.type === 'basic'
    ) {
      authType = 'basic';
      authConfig = {
        username: stringValue(authentication.username),
        password: stringValue(authentication.password),
      };
    } else if (
      authentication.disabled !== true &&
      authentication.type === 'apikey'
    ) {
      authType = 'apiKey';
      authConfig = {
        headerName: stringValue(authentication.key, 'x-api-key'),
        value: stringValue(authentication.value),
      };
    }

    return {
      name: (item.name?.trim() || 'Nova requisição').slice(0, 100),
      description: item.meta?.description?.trim() || null,
      method,
      url,
      authType,
      authConfig,
      queryParams: [...query.entries()]
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      headers,
      variables: environment,
      body: item.body?.text ?? '',
    };
  }

  async createChannel(userId: number, dto: CreateApiChannelDto) {
    const baseName = dto.name.trim();
    const description = dto.description?.trim() || null;

    // The UI starts new channels with a placeholder name. Resolve collisions
    // here so stale clients and concurrent requests cannot turn them into 500s.
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const name = suffix === 1 ? baseName : `${baseName} ${suffix}`;
      const result = await this.db.query<ChannelRow>(
        `
          INSERT INTO api_channels (user_id, name, description, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (user_id, name) DO NOTHING
          RETURNING *
        `,
        [userId, name, description],
      );

      if (result.rows[0]) return toChannelDto(result.rows[0]);
    }

    throw new ConflictException(
      'Não foi possível gerar um nome disponível para o canal.',
    );
  }

  async updateChannel(
    userId: number,
    channelId: number,
    dto: UpdateApiChannelDto,
  ) {
    await this.assertChannelOwner(userId, channelId);
    const result = await this.db.query<ChannelRow>(
      `
        UPDATE api_channels
           SET name = COALESCE($3, name),
               description = COALESCE($4, description),
               updated_at = now()
         WHERE id = $1
           AND user_id = $2
         RETURNING *
      `,
      [
        channelId,
        userId,
        dto.name?.trim() || null,
        dto.description?.trim() || null,
      ],
    );
    return toChannelDto(result.rows[0]);
  }

  async deleteChannel(userId: number, channelId: number) {
    await this.assertChannelOwner(userId, channelId);
    await this.db.query(
      `DELETE FROM api_channels WHERE id = $1 AND user_id = $2`,
      [channelId, userId],
    );
    return { success: true };
  }

  async createRequest(
    userId: number,
    channelId: number,
    dto: SaveApiRequestDto,
  ) {
    await this.assertChannelOwner(userId, channelId);
    const result = await this.db.query<RequestRow>(
      `
        INSERT INTO api_requests (
          channel_id, user_id, name, description, method, url, auth_type,
          auth_config, query_params, headers, variables, body, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11::jsonb, $12, now())
        RETURNING *
      `,
      [
        channelId,
        userId,
        dto.name.trim(),
        dto.description?.trim() || null,
        dto.method,
        dto.url.trim(),
        dto.authType,
        JSON.stringify(dto.authConfig ?? {}),
        dto.queryParams ?? '',
        JSON.stringify(dto.headers ?? {}),
        JSON.stringify(dto.variables ?? {}),
        dto.body ?? '',
      ],
    );
    return toRequestDto(result.rows[0]);
  }

  async updateRequest(
    userId: number,
    requestId: number,
    dto: SaveApiRequestDto,
  ) {
    await this.assertRequestOwner(userId, requestId);
    const result = await this.db.query<RequestRow>(
      `
        UPDATE api_requests
           SET name = $3,
               description = $4,
               method = $5,
               url = $6,
               auth_type = $7,
               auth_config = $8::jsonb,
               query_params = $9,
               headers = $10::jsonb,
               variables = $11::jsonb,
               body = $12,
               updated_at = now()
         WHERE id = $1
           AND user_id = $2
         RETURNING *
      `,
      [
        requestId,
        userId,
        dto.name.trim(),
        dto.description?.trim() || null,
        dto.method,
        dto.url.trim(),
        dto.authType,
        JSON.stringify(dto.authConfig ?? {}),
        dto.queryParams ?? '',
        JSON.stringify(dto.headers ?? {}),
        JSON.stringify(dto.variables ?? {}),
        dto.body ?? '',
      ],
    );
    return toRequestDto(result.rows[0]);
  }

  async deleteRequest(userId: number, requestId: number) {
    await this.assertRequestOwner(userId, requestId);
    await this.db.query(
      `DELETE FROM api_requests WHERE id = $1 AND user_id = $2`,
      [requestId, userId],
    );
    return { success: true };
  }

  async runRequest(userId: number, requestId: number) {
    const request = await this.findRequest(userId, requestId);
    const variables = parseJsonObject(request.variables);
    const authConfig = applyVariablesToRecord(
      parseJsonObject(request.auth_config),
      variables,
    );
    const headers = {
      ...applyVariablesToRecord(parseJsonObject(request.headers), variables),
      ...buildAuthHeaders(request.auth_type, authConfig),
    };
    const url = applyVariables(request.url, variables);
    const queryParams = applyVariables(request.query_params ?? '', variables);
    const body = applyVariables(request.body ?? '', variables);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const startedAt = performance.now();

    try {
      const hasBody =
        !['GET', 'DELETE'].includes(request.method) && !!body.trim();
      const resolvedUrl = buildUrl(url, queryParams);
      const response = await fetch(resolvedUrl, {
        method: request.method,
        headers,
        body: hasBody ? body : undefined,
        signal: controller.signal,
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const text = await response.text();

      const result = {
        status: response.status,
        statusText: response.statusText,
        durationMs,
        headers: Object.fromEntries(response.headers.entries()),
        body: this.formatBody(text),
        ok: response.ok,
        request: {
          method: request.method,
          url: resolvedUrl,
          headers: redactHeaders(headers),
        },
      };

      await this.saveLastResponse(userId, requestId, result);
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadRequestException('Tempo limite de 30s excedido.');
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Erro ao consultar API.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async saveLastResponse(
    userId: number,
    requestId: number,
    response: Record<string, unknown>,
  ) {
    await this.db.query(
      `
        UPDATE api_requests
           SET last_response = $3::jsonb,
               last_run_at = now()
         WHERE id = $1
           AND user_id = $2
      `,
      [requestId, userId, JSON.stringify(response)],
    );
  }

  private formatBody(text: string) {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  private async assertChannelOwner(userId: number, channelId: number) {
    const result = await this.db.query<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM api_channels WHERE id = $1`,
      [channelId],
    );
    const channel = result.rows[0];
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    if (channel.user_id !== userId) throw new ForbiddenException();
  }

  private async assertRequestOwner(userId: number, requestId: number) {
    await this.findRequest(userId, requestId);
  }

  private async findRequest(userId: number, requestId: number) {
    const result = await this.db.query<RequestRow>(
      `
        SELECT *
          FROM api_requests
         WHERE id = $1
           AND user_id = $2
      `,
      [requestId, userId],
    );
    const request = result.rows[0];
    if (!request) throw new NotFoundException('API não encontrada.');
    return request;
  }
}
