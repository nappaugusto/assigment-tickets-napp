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
  due_at: string | null;
  resolved_at: string | null;
  requester_id: number;
  requester_name: string;
  team_id: number | null;
  team_name: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  attachment_count: string | number;
  comment_count?: string | number;
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

interface CommentRow {
  id: number;
  case_id: number;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
}

interface SlaPolicyRow {
  priority: string;
  duration_hours: number;
  updated_at: string;
}

const OPEN_STATUSES = [
  'Novo',
  'Em atendimento',
  'Aguardando solicitante',
  'Aguardando terceiro',
  'Reaberto',
];

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
    commentCount: Number(row.comment_count ?? 0),
    dueAt: row.due_at,
    resolvedAt: row.resolved_at,
    isOverdue:
      !!row.due_at &&
      OPEN_STATUSES.includes(row.status) &&
      new Date(row.due_at).getTime() < Date.now(),
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

function toCommentDto(row: CommentRow) {
  return {
    id: row.id,
    caseId: row.case_id,
    author: {
      id: row.author_id,
      name: row.author_name,
    },
    content: row.content,
    createdAt: row.created_at,
  };
}

function toSlaPolicyDto(row: SlaPolicyRow) {
  return {
    priority: row.priority,
    durationHours: row.duration_hours,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class CasesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async listCases() {
    await this.promoteOldNewCases();
    const result = await this.db.query<CaseRow>(
      `
        SELECT c.*,
               COUNT(DISTINCT a.id) AS attachment_count,
               COUNT(DISTINCT cm.id) AS comment_count
          FROM internal_cases c
          LEFT JOIN internal_case_attachments a ON a.case_id = c.id
          LEFT JOIN internal_case_comments cm ON cm.case_id = c.id
         GROUP BY c.id
         ORDER BY
           CASE c.status
             WHEN 'Novo' THEN 1
             WHEN 'Em atendimento' THEN 2
             WHEN 'Reaberto' THEN 3
             WHEN 'Aguardando solicitante' THEN 4
             WHEN 'Aguardando terceiro' THEN 5
             WHEN 'Resolvido' THEN 6
             ELSE 7
           END,
           c.due_at ASC NULLS LAST,
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
        SELECT c.*,
               COUNT(DISTINCT a.id) AS attachment_count,
               COUNT(DISTINCT cm.id) AS comment_count
          FROM internal_cases c
          LEFT JOIN internal_case_attachments a ON a.case_id = c.id
          LEFT JOIN internal_case_comments cm ON cm.case_id = c.id
         WHERE c.id = $1
         GROUP BY c.id
         LIMIT 1
      `,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chamado não encontrado.');

    const attachments = await this.listAttachments(id);
    const comments = await this.listComments(id);
    return { ...toCaseDto(row), attachments, comments };
  }

  async createCase(user: User, dto: CreateCaseDto) {
    const attachments = dto.attachments ?? [];
    this.validateAttachments(attachments);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const dueAt = await this.getDueAtForPriority(dto.priority || 'Normal');
      const result = await client.query<CaseRow>(
        `
          INSERT INTO internal_cases (
            title, description, category, priority, status, due_at,
            requester_id, requester_name, team_id, team_name,
            assignee_id, assignee_name, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4, 'Novo', $5, $6, $7,
            $8,
            (SELECT name FROM internal_teams WHERE id = $8),
            $9,
            (SELECT name FROM users WHERE id = $9),
            now(), now()
          )
          RETURNING *, 0 AS attachment_count, 0 AS comment_count
        `,
        [
          dto.title.trim(),
          dto.description.trim(),
          dto.category?.trim() || null,
          dto.priority || 'Normal',
          dueAt,
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
               resolved_at = CASE
                 WHEN $1 = 'Resolvido' THEN COALESCE(resolved_at, now())
                 WHEN $1 IN ('Reaberto', 'Em atendimento', 'Novo') THEN NULL
                 ELSE resolved_at
               END,
               updated_at = now()
         WHERE id = $2
         RETURNING *, (
           SELECT COUNT(*) FROM internal_case_attachments WHERE case_id = internal_cases.id
         ) AS attachment_count, (
           SELECT COUNT(*) FROM internal_case_comments WHERE case_id = internal_cases.id
         ) AS comment_count
      `,
      [status, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Chamado não encontrado.');
    return toCaseDto(row);
  }

  async listComments(caseId: number) {
    const result = await this.db.query<CommentRow>(
      `
        SELECT id, case_id, author_id, author_name, content, created_at
          FROM internal_case_comments
         WHERE case_id = $1
         ORDER BY created_at ASC, id ASC
      `,
      [caseId],
    );
    return result.rows.map(toCommentDto);
  }

  async addComment(caseId: number, user: User, content: string) {
    await this.ensureCaseExists(caseId);
    const result = await this.db.query<CommentRow>(
      `
        INSERT INTO internal_case_comments (
          case_id, author_id, author_name, content
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [caseId, user.id, user.name, content.trim()],
    );

    await this.db.query(
      `UPDATE internal_cases SET updated_at = now() WHERE id = $1`,
      [caseId],
    );

    return toCommentDto(result.rows[0]);
  }

  async listSlaPolicies() {
    const result = await this.db.query<SlaPolicyRow>(
      `
        SELECT priority, duration_hours, updated_at
          FROM internal_case_sla_policies
         ORDER BY
           CASE priority
             WHEN 'Urgente' THEN 1
             WHEN 'Alta' THEN 2
             WHEN 'Normal' THEN 3
             WHEN 'Baixa' THEN 4
             ELSE 5
           END
      `,
    );
    return result.rows.map(toSlaPolicyDto);
  }

  async updateSlaPolicy(priority: string, durationHours: number) {
    const result = await this.db.query<SlaPolicyRow>(
      `
        INSERT INTO internal_case_sla_policies (
          priority, duration_hours, updated_at
        )
        VALUES ($1, $2, now())
        ON CONFLICT(priority) DO UPDATE SET
          duration_hours = excluded.duration_hours,
          updated_at = now()
        RETURNING *
      `,
      [priority, durationHours],
    );

    await this.db.query(
      `
        UPDATE internal_cases
           SET due_at = created_at + make_interval(hours => $2),
               updated_at = now()
         WHERE priority = $1
           AND status = ANY($3::text[])
      `,
      [priority, durationHours, OPEN_STATUSES],
    );

    return toSlaPolicyDto(result.rows[0]);
  }

  async dashboard() {
    const [summary, byTeam, byPriority, oldest, weekly] = await Promise.all([
      this.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Novo') AS new_count,
          COUNT(*) FILTER (WHERE status IN ('Em atendimento', 'Reaberto')) AS in_service_count,
          COUNT(*) FILTER (WHERE status IN ('Aguardando solicitante', 'Aguardando terceiro')) AS waiting_count,
          COUNT(*) FILTER (WHERE status = 'Resolvido') AS resolved_count,
          COUNT(*) FILTER (
            WHERE status = ANY($1::text[])
              AND due_at IS NOT NULL
              AND due_at < now()
          ) AS overdue_count,
          ROUND(EXTRACT(EPOCH FROM AVG(resolved_at - created_at)) / 3600, 1) AS avg_resolution_hours
        FROM internal_cases
      `, [OPEN_STATUSES]),
      this.db.query(`
        SELECT COALESCE(team_name, 'Sem time') AS label, COUNT(*)::int AS total
          FROM internal_cases
         WHERE status = ANY($1::text[])
         GROUP BY COALESCE(team_name, 'Sem time')
         ORDER BY total DESC, label ASC
         LIMIT 8
      `, [OPEN_STATUSES]),
      this.db.query(`
        SELECT priority AS label, COUNT(*)::int AS total
          FROM internal_cases
         WHERE status = ANY($1::text[])
         GROUP BY priority
         ORDER BY
           CASE priority
             WHEN 'Urgente' THEN 1
             WHEN 'Alta' THEN 2
             WHEN 'Normal' THEN 3
             WHEN 'Baixa' THEN 4
             ELSE 5
           END
      `, [OPEN_STATUSES]),
      this.db.query(`
        SELECT id, title, priority, status, due_at, created_at
          FROM internal_cases
         WHERE status = ANY($1::text[])
         ORDER BY created_at ASC
         LIMIT 5
      `, [OPEN_STATUSES]),
      this.db.query(`
        SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
               COUNT(*)::int AS opened,
               COUNT(*) FILTER (WHERE status = 'Resolvido')::int AS resolved
          FROM internal_cases
         WHERE created_at >= now() - interval '8 weeks'
         GROUP BY date_trunc('week', created_at)
         ORDER BY date_trunc('week', created_at) ASC
      `),
    ]);

    const row = summary.rows[0] ?? {};
    return {
      summary: {
        newCount: Number(row.new_count ?? 0),
        inServiceCount: Number(row.in_service_count ?? 0),
        waitingCount: Number(row.waiting_count ?? 0),
        resolvedCount: Number(row.resolved_count ?? 0),
        overdueCount: Number(row.overdue_count ?? 0),
        avgResolutionHours:
          row.avg_resolution_hours === null || row.avg_resolution_hours === undefined
            ? null
            : Number(row.avg_resolution_hours),
      },
      byTeam: byTeam.rows,
      byPriority: byPriority.rows,
      oldestOpen: oldest.rows.map((item) => ({
        id: item.id,
        title: item.title,
        priority: item.priority,
        status: item.status,
        dueAt: item.due_at,
        createdAt: item.created_at,
      })),
      weekly: weekly.rows,
    };
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

  private async ensureCaseExists(caseId: number) {
    const result = await this.db.query(
      `SELECT id FROM internal_cases WHERE id = $1 LIMIT 1`,
      [caseId],
    );
    if (!result.rows[0]) throw new NotFoundException('Chamado não encontrado.');
  }

  private async getDueAtForPriority(priority: string) {
    const result = await this.db.query<SlaPolicyRow>(
      `
        SELECT duration_hours
          FROM internal_case_sla_policies
         WHERE priority = $1
         LIMIT 1
      `,
      [priority],
    );
    const durationHours = result.rows[0]?.duration_hours ?? 48;
    return new Date(Date.now() + durationHours * 60 * 60 * 1000);
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
