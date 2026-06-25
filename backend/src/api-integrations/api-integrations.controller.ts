import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import {
  CreateApiChannelDto,
  SaveApiRequestDto,
  UpdateApiChannelDto,
} from './api-integrations.dto';
import { ApiIntegrationsService } from './api-integrations.service';

@UseGuards(SessionGuard)
@Controller('api-integrations')
export class ApiIntegrationsController {
  constructor(private readonly apiIntegrationsService: ApiIntegrationsService) {}

  @Get()
  async list(@Req() req: Request) {
    const user = (req as any).user as User;
    return { channels: await this.apiIntegrationsService.list(user.id) };
  }

  @Post('channels')
  async createChannel(@Req() req: Request, @Body() dto: CreateApiChannelDto) {
    const user = (req as any).user as User;
    return this.apiIntegrationsService.createChannel(user.id, dto);
  }

  @Patch('channels/:channelId')
  async updateChannel(
    @Req() req: Request,
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() dto: UpdateApiChannelDto,
  ) {
    const user = (req as any).user as User;
    return this.apiIntegrationsService.updateChannel(user.id, channelId, dto);
  }

  @Delete('channels/:channelId')
  async deleteChannel(
    @Req() req: Request,
    @Param('channelId', ParseIntPipe) channelId: number,
  ) {
    const user = (req as any).user as User;
    return this.apiIntegrationsService.deleteChannel(user.id, channelId);
  }

  @Post('channels/:channelId/requests')
  async createRequest(
    @Req() req: Request,
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() dto: SaveApiRequestDto,
  ) {
    const user = (req as any).user as User;
    return this.apiIntegrationsService.createRequest(user.id, channelId, dto);
  }

  @Patch('requests/:requestId')
  async updateRequest(
    @Req() req: Request,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() dto: SaveApiRequestDto,
  ) {
    const user = (req as any).user as User;
    return this.apiIntegrationsService.updateRequest(user.id, requestId, dto);
  }

  @Delete('requests/:requestId')
  async deleteRequest(
    @Req() req: Request,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    const user = (req as any).user as User;
    return this.apiIntegrationsService.deleteRequest(user.id, requestId);
  }

  @Post('requests/:requestId/run')
  async runRequest(
    @Req() req: Request,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    const user = (req as any).user as User;
    return this.apiIntegrationsService.runRequest(user.id, requestId);
  }
}
