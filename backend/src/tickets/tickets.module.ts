import { Module, forwardRef } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { MovideskTicketsClient } from './movidesk-tickets.client';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [forwardRef(() => SyncModule)],
  providers: [TicketsService, MovideskTicketsClient],
  controllers: [TicketsController],
  exports: [TicketsService],
})
export class TicketsModule {}
