import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
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

  async createChannel(userId: number, dto: CreateApiChannelDto) {
    const result = await this.db.query<ChannelRow>(
      `
        INSERT INTO api_channels (user_id, name, description, updated_at)
        VALUES ($1, $2, $3, now())
        RETURNING *
      `,
      [userId, dto.name.trim(), dto.description?.trim() || null],
    );
    return toChannelDto(result.rows[0]);
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

  async createRequest(userId: number, channelId: number, dto: SaveApiRequestDto) {
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

  async updateRequest(userId: number, requestId: number, dto: SaveApiRequestDto) {
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
