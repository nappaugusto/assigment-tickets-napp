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
  getTicketsWithNotes(@Req() req: Request) {
    const user = (req as any).user as User;
    return { ticketIds: this.notesService.getTicketsWithNotes(user.id) };
  }

  @Get(':ticketId')
  getNote(@Param('ticketId', ParseIntPipe) ticketId: number, @Req() req: Request) {
    const user = (req as any).user as User;
    return { content: this.notesService.getNote(user.id, ticketId) };
  }

  @Put(':ticketId')
  saveNote(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: SaveNoteDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as User;
    this.notesService.saveNote(user.id, ticketId, dto.content);
    return { success: true };
  }
}
