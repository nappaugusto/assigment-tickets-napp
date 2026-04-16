import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { DatabaseInitService } from './database/database-init.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { TicketsModule } from './tickets/tickets.module';
import { SyncModule } from './sync/sync.module';
import { PeopleModule } from './people/people.module';
import { EmailModule } from './email/email.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { KanbanModule } from './kanban/kanban.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    TicketsModule,
    SyncModule,
    PeopleModule,
    EmailModule,
    PasswordResetModule,
    KanbanModule,
  ],
  providers: [DatabaseInitService],
})
export class AppModule {}
