import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { OpsService } from './ops.service';

@UseGuards(SessionGuard)
@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get('k8s/overview')
  overview() {
    return this.opsService.getOverview();
  }

  @Get('k8s/logs')
  logs(
    @Query('pod') pod?: string,
    @Query('namespace') namespace?: string,
    @Query('container') container?: string,
    @Query('tail') tail?: string,
    @Query('previous') previous?: string,
  ) {
    return this.opsService.getLogs({ pod, namespace, container, tail, previous });
  }
}
