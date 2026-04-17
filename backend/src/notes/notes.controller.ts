import { Controller, Get, Put, Body, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/auth.guard';
import { NotesService } from './notes.service';
import { SaveNoteDto } from './notes.dto';
import { User } from '../users/user.entity';

@UseGuards(SessionGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get('tickets-with-notes')
  async getTicketsWithNotes(@Req() req: Request) {
    const user = (req as any).user as User;
    return { ticketIds: await this.notesService.getTicketsWithNotes(user.id) };
  }

  @Get(':ticketId')
  async getNote(@Param('ticketId', ParseIntPipe) ticketId: number, @Req() req: Request) {
    const user = (req as any).user as User;
    return { content: await this.notesService.getNote(user.id, ticketId) };
  }

  @Put(':ticketId')
  async saveNote(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: SaveNoteDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as User;
    await this.notesService.saveNote(user.id, ticketId, dto.content);
    return { success: true };
  }
}
