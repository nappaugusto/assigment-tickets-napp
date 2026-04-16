import { IsString } from 'class-validator';

export class SaveNoteDto {
  @IsString()
  content: string;
}
