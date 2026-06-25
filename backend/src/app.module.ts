import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'path';
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
import { NotesModule } from './notes/notes.module';
import { McpModule } from './mcp/mcp.module';
import { PreferencesModule } from './preferences/preferences.module';
import { TrelloModule } from './trello/trello.module';
import { CasesModule } from './cases/cases.module';
import { TeamsModule } from './teams/teams.module';
import { AiTriageModule } from './ai-triage/ai-triage.module';
import { ApiIntegrationsModule } from './api-integrations/api-integrations.module';
import { PubsubToolsModule } from './pubsub-tools/pubsub-tools.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '..', '.env'),
      ],
    }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    TicketsModule,
    SyncModule,
    PeopleModule,
    EmailModule,
    PasswordResetModule,
    KanbanModule,
    NotesModule,
    McpModule,
    PreferencesModule,
    TrelloModule,
    CasesModule,
    TeamsModule,
    AiTriageModule,
    ApiIntegrationsModule,
    PubsubToolsModule,
  ],
  providers: [DatabaseInitService],
})
export class AppModule {}
