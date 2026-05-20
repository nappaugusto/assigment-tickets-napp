import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { TrelloController } from './trello.controller';
import { TrelloService } from './trello.service';

@Module({
  imports: [TicketsModule],
  providers: [TrelloService],
  controllers: [TrelloController],
})
export class TrelloModule {}
