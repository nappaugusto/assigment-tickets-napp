import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import { KanbanBoardDto, SaveBoardDto, DEFAULT_BOARD } from './kanban.dto';

interface KanbanBoardRow {
  id: number;
  user_id: number;
  columns: unknown;
  positions: unknown;
  updated_at: string;
}

@Injectable()
export class KanbanService {
  constructor(@Inject(DB_TOKEN) private readonly db: Pool) {}

  async getBoard(userId: number): Promise<KanbanBoardDto> {
    const result = await this.db.query<KanbanBoardRow>(
      'SELECT * FROM kanban_board WHERE user_id = $1',
      [userId],
    );
    const row = result.rows[0];

    if (!row) return { columns: [...DEFAULT_BOARD.columns], columnItems: {} };

    const parsedColumns =
      typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns;
    const parsedItems =
      typeof row.positions === 'string'
        ? JSON.parse(row.positions)
        : row.positions;
    return {
      columns: Array.isArray(parsedColumns)
        ? parsedColumns
        : [...DEFAULT_BOARD.columns],
      columnItems:
        parsedItems && typeof parsedItems === 'object' ? parsedItems : {},
    };
  }

  async saveBoard(userId: number, dto: SaveBoardDto): Promise<void> {
    const defaultCol = dto.columns.find((c) => c.isDefault);
    if (!defaultCol) {
      throw new BadRequestException('Board must have a default column.');
    }

    await this.db.query(
      `
        INSERT INTO kanban_board (user_id, columns, positions, updated_at)
        VALUES ($1, $2::jsonb, $3::jsonb, now())
        ON CONFLICT(user_id) DO UPDATE SET
          columns = excluded.columns,
          positions = excluded.positions,
          updated_at = excluded.updated_at
      `,
      [userId, JSON.stringify(dto.columns), JSON.stringify(dto.columnItems)],
    );
  }
}
