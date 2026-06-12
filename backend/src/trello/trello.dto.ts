import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export interface TrelloBoardDto {
  id: string;
  name: string;
  url: string;
}

export interface TrelloListDto {
  id: string;
  name: string;
  closed: boolean;
}

export interface TrelloStatusDto {
  configured: boolean;
  defaultBoardId: string | null;
  defaultListId: string | null;
}

export class CreateTrelloCardDto {
  @IsOptional()
  @IsString()
  boardId?: string;

  @IsOptional()
  @IsString()
  listId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  extraDescription?: string;

  @IsOptional()
  @IsArray()
  labels?: string[];

  @IsOptional()
  @IsBoolean()
  forceNew?: boolean;
}
