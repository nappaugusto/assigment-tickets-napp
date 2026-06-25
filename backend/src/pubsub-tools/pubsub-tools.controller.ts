import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { PublishTrierOrderDto } from './pubsub-tools.dto';
import { PubsubToolsService } from './pubsub-tools.service';

@UseGuards(SessionGuard)
@Controller('pubsub-tools')
export class PubsubToolsController {
  constructor(private readonly pubsubToolsService: PubsubToolsService) {}

  @Post('trier-order')
  publishTrierOrder(@Body() dto: PublishTrierOrderDto) {
    return this.pubsubToolsService.publishTrierOrder(dto);
  }
}
