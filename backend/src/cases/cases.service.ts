import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import { User } from '../users/user.entity';
import { CreateCaseDto } from './cases.dto';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

interface CaseRow {
  id: number;
  title: string;
  description: string;
  category: string | null;
  priority: string;
  status: string;
  requester_id: number;
  requester_name: string;
  team_id: number | null;
  team_name: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  attachment_count: string | number;
}

interface AttachmentRow {
  id: number;
  case_id: number;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_id: number;
  uploaded_by_name: string;
  created_at: string;
}

interface AttachmentContentRow extends AttachmentRow {
  content: Buffer;
}

function toCaseDto(row: CaseRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    requester: {
      id: row.requester_id,
      name: row.requester_name,
    },
    team: row.team_id
      ? {
          id: row.team_id,
          name: row.team_name,
        }
      : null,
    assignee: row.assignee_id
      ? {
          id: row.assignee_id,
          name: row.assignee_name,
        }
      : null,
    attachmentCount: Number(row.attachment_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttachmentDto(row: AttachmentRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedBy: {
      id: row.uploaded_by_id,
      name: row.uploaded_by_name,
    },
    createdAt: row.created_at,
  };
}

@Injectable()
export class CasesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async listCases() {
    await this.promoteOldNewCases();
    const result = await this.db.query<CaseRow>(
      `
        SELECT c.*, COUNT(a.id) AS attachment_count
          FROM internal_cases c
          LEFT JOIN internal_case_attachments a ON a.case_id = c.id
         GROUP BY c.id
         ORDER BY
           CASE c.status
             WHEN 'Novo' THEN 1
             WHEN 'Em atendimento' THEN 2
             WHEN 'Resolvido' THEN 3
             ELSE 4
           END,
           c.created_at DESC
      `,
    );

    const cases = result.rows.map(toCaseDto);
    const attachmentsByCase = await this.listAttachmentsForCases(
      cases.map((item) => item.id),
    );

    return cases.map((item) => ({
      ...item,
      attachments: attachmentsByCase.get(item.id) ?? [],
    }));
  }

  async getCase(id: number) {
    await this.promoteOldNewCases();
    const result = await this.db.query<CaseRow>(
      `
        SELECT c.*, COUNT(a.id) AS attachment_count
          FROM internal_cases c
          LEFT JOIN internal_case_attachments a ON a.case_id = c.id
         WHERE c.id = $1
         GROUP BY c.id
         LIMIT 1
      `,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chamado não encontrado.');

    const attachments = await this.listAttachments(id);
    return { ...toCaseDto(row), attachments };
  }

  async createCase(user: User, dto: CreateCaseDto) {
    const attachments = dto.attachments ?? [];
    this.validateAttachments(attachments);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<CaseRow>(
        `
          INSERT INTO internal_cases (
            title, description, category, priority, status,
            requester_id, requester_name, team_id, team_name,
            assignee_id, assignee_name, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4, 'Novo', $5, $6,
            $7,
            (SELECT name FROM internal_teams WHERE id = $7),
            $8,
            (SELECT name FROM users WHERE id = $8),
            now(), now()
          )
          RETURNING *, 0 AS attachment_count
        `,
        [
          dto.title.trim(),
          dto.description.trim(),
          dto.category?.trim() || null,
          dto.priority || 'Normal',
          user.id,
          user.name,
          dto.teamId ?? null,
          dto.assigneeId ?? null,
        ],
      );
      const created = result.rows[0];

      for (const attachment of attachments) {
        await client.query(
          `
            INSERT INTO internal_case_attachments (
              case_id, file_name, content_type, size_bytes, content,
              uploaded_by_id, uploaded_by_name
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            created.id,
            attachment.fileName.trim(),
            attachment.contentType,
            attachment.sizeBytes,
            Buffer.from(attachment.dataBase64, 'base64'),
            user.id,
            user.name,
          ],
        );
      }

      await client.query('COMMIT');
      return this.getCase(created.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: number, status: string) {
    const result = await this.db.query<CaseRow>(
      `
        UPDATE internal_cases
           SET status = $1,
               updated_at = now()
         WHERE id = $2
         RETURNING *, (
           SELECT COUNT(*) FROM internal_case_attachments WHERE case_id = internal_cases.id
         ) AS attachment_count
      `,
      [status, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chamado não encontrado.');
    return toCaseDto(row);
  }

  async listAttachments(caseId: number) {
    const result = await this.db.query<AttachmentRow>(
      `
        SELECT id, case_id, file_name, content_type, size_bytes,
               uploaded_by_id, uploaded_by_name, created_at
          FROM internal_case_attachments
         WHERE case_id = $1
         ORDER BY created_at ASC, id ASC
      `,
      [caseId],
    );
    return result.rows.map(toAttachmentDto);
  }

  private async listAttachmentsForCases(caseIds: number[]) {
    const byCase = new Map<number, ReturnType<typeof toAttachmentDto>[]>();
    if (caseIds.length === 0) return byCase;

    const result = await this.db.query<AttachmentRow>(
      `
        SELECT id, case_id, file_name, content_type, size_bytes,
               uploaded_by_id, uploaded_by_name, created_at
          FROM internal_case_attachments
         WHERE case_id = ANY($1::int[])
         ORDER BY created_at ASC, id ASC
      `,
      [caseIds],
    );

    for (const row of result.rows) {
      const current = byCase.get(row.case_id) ?? [];
      current.push(toAttachmentDto(row));
      byCase.set(row.case_id, current);
    }

    return byCase;
  }

  async getAttachment(caseId: number, attachmentId: number) {
    const result = await this.db.query<AttachmentContentRow>(
      `
        SELECT *
          FROM internal_case_attachments
         WHERE case_id = $1 AND id = $2
         LIMIT 1
      `,
      [caseId, attachmentId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Anexo não encontrado.');
    return row;
  }

  private validateAttachments(attachments: CreateCaseDto['attachments']) {
    for (const attachment of attachments ?? []) {
      if (!IMAGE_CONTENT_TYPES.has(attachment.contentType)) {
        throw new BadRequestException('Somente imagens podem ser anexadas.');
      }

      if (attachment.sizeBytes > MAX_ATTACHMENT_BYTES) {
        throw new BadRequestException(
          'Cada imagem deve ter no máximo 5 MB.',
        );
      }

      const buffer = Buffer.from(attachment.dataBase64, 'base64');
      if (!buffer.length || buffer.length !== attachment.sizeBytes) {
        throw new BadRequestException('Anexo inválido.');
      }
    }
  }

  private async promoteOldNewCases() {
    await this.db.query(
      `
        UPDATE internal_cases
           SET status = 'Em atendimento',
               updated_at = now()
         WHERE status = 'Novo'
           AND created_at < date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
      `,
    );
  }
}
