import { Controller, Get, Put, Body, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/auth.guard';
import { KanbanService } from './kanban.service';
import { SaveBoardDto } from './kanban.dto';
import { User } from '../users/user.entity';

@UseGuards(SessionGuard)
@Controller('kanban')
export class KanbanController {
  constructor(private readonly kanbanService: KanbanService) {}

  @Get('board')
  getBoard(@Req() req: Request) {
    const user = (req as any).user as User;
    return this.kanbanService.getBoard(user.id);
  }

  @Put('board')
  saveBoard(@Req() req: Request, @Body() dto: SaveBoardDto) {
    const user = (req as any).user as User;
    this.kanbanService.saveBoard(user.id, dto);
    return { success: true };
  }
}
