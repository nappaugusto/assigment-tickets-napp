import { Module, forwardRef } from '@nestjs/common';
import { SyncService } from './sync.service';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [forwardRef(() => TicketsModule)],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
