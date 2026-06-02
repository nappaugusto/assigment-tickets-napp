import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const ALLOWED_PRIORITIES = ['Baixa', 'Normal', 'Alta', 'Urgente'] as const;
const ALLOWED_STATUSES = ['Novo', 'Em atendimento', 'Resolvido', 'Cancelado'] as const;

export class CreateCaseAttachmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  contentType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsString()
  @MinLength(1)
  dataBase64!: string;
}

export class CreateCaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(8000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsIn(ALLOWED_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CreateCaseAttachmentDto)
  attachments?: CreateCaseAttachmentDto[];
}

export class UpdateCaseStatusDto {
  @IsIn(ALLOWED_STATUSES)
  status!: string;
}
