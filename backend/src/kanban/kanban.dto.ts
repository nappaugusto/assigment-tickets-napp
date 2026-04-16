import { IsArray, IsObject } from 'class-validator';

export interface KanbanColumn {
  id: string;
  title: string;
  isDefault: boolean;
}

export interface KanbanBoardDto {
  columns: KanbanColumn[];
  columnItems: Record<string, string[]>;
}

export class SaveBoardDto {
  @IsArray()
  columns: KanbanColumn[];

  @IsObject()
  columnItems: Record<string, string[]>;
}

export const DEFAULT_BOARD: KanbanBoardDto = {
  columns: [{ id: 'entrada', title: 'Entrada', isDefault: true }],
  columnItems: {},
};
