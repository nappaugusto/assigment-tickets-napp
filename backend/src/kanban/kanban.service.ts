import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';
import { KanbanBoardDto, SaveBoardDto, DEFAULT_BOARD } from './kanban.dto';

interface KanbanBoardRow {
  id: number;
  user_id: number;
  columns: string;
  positions: string;
  updated_at: string;
}

@Injectable()
export class KanbanService {
  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  getBoard(userId: number): KanbanBoardDto {
    const row = this.db
      .prepare('SELECT * FROM kanban_board WHERE user_id = ?')
      .get(userId) as KanbanBoardRow | undefined;

    if (!row) return { columns: [...DEFAULT_BOARD.columns], columnItems: {} };

    const parsedColumns = JSON.parse(row.columns);
    const parsedItems = JSON.parse(row.positions);
    return {
      columns: Array.isArray(parsedColumns) ? parsedColumns : [...DEFAULT_BOARD.columns],
      columnItems: parsedItems && typeof parsedItems === 'object' ? parsedItems : {},
    };
  }

  saveBoard(userId: number, dto: SaveBoardDto): void {
    const defaultCol = dto.columns.find((c) => c.isDefault);
    if (!defaultCol) {
      throw new BadRequestException('Board must have a default column.');
    }

    this.db
      .prepare(`
        INSERT INTO kanban_board (user_id, columns, positions, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          columns = excluded.columns,
          positions = excluded.positions,
          updated_at = excluded.updated_at
      `)
      .run(userId, JSON.stringify(dto.columns), JSON.stringify(dto.columnItems));
  }
}
