export interface KanbanColumn {
  id: string;
  title: string;
  isDefault: boolean;
}

export interface KanbanBoardDto {
  columns: KanbanColumn[];
  positions: Record<string, string>;
}

export class SaveBoardDto {
  columns: KanbanColumn[];
  positions: Record<string, string>;
}

export const DEFAULT_BOARD: KanbanBoardDto = {
  columns: [{ id: 'entrada', title: 'Entrada', isDefault: true }],
  positions: {},
};
