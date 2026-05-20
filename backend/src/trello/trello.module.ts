import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { TicketsModule } from '../tickets/tickets.module';
import { TrelloController } from './trello.controller';
import { TrelloService } from './trello.service';

@Module({
  imports: [TicketsModule, McpModule],
  providers: [TrelloService],
  controllers: [TrelloController],
})
export class TrelloModule {}
