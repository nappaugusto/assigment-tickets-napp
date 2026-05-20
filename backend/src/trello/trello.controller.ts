import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { CreateTrelloCardDto } from './trello.dto';
import { TrelloService } from './trello.service';

@UseGuards(SessionGuard)
@Controller('trello')
export class TrelloController {
  constructor(private readonly trelloService: TrelloService) {}

  @Get('status')
  status() {
    return this.trelloService.getStatus();
  }

  @Get('boards')
  boards() {
    return this.trelloService.listBoards();
  }

  @Get('lists')
  lists(@Query('boardId') boardId?: string) {
    return this.trelloService.listBoardLists(boardId);
  }

  @Post('tickets/:ticketId/cards')
  createCard(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() dto: CreateTrelloCardDto,
  ) {
    return this.trelloService.createCardFromTicket(ticketId, dto);
  }
}
