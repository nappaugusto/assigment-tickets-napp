import { Module } from '@nestjs/common';
import { PubsubToolsController } from './pubsub-tools.controller';
import { PubsubToolsService } from './pubsub-tools.service';

@Module({
  controllers: [PubsubToolsController],
  providers: [PubsubToolsService],
})
export class PubsubToolsModule {}
