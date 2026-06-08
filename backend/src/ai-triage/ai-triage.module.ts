import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AiTriageController } from './ai-triage.controller';
import { AiTriageService } from './ai-triage.service';

@Module({
  imports: [DatabaseModule, TicketsModule],
  controllers: [AiTriageController],
  providers: [AiTriageService],
})
export class AiTriageModule {}
