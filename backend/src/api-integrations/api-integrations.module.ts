import { Module } from '@nestjs/common';
import { ApiIntegrationsController } from './api-integrations.controller';
import { ApiIntegrationsService } from './api-integrations.service';

@Module({
  controllers: [ApiIntegrationsController],
  providers: [ApiIntegrationsService],
})
export class ApiIntegrationsModule {}
