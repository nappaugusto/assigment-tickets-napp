import { Module } from '@nestjs/common';
import { PeopleService } from './people.service';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [TicketsModule],
  providers: [PeopleService],
  exports: [PeopleService],
})
export class PeopleModule {}
