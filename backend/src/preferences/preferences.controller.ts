import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { SaveMonthlyAnalyticsPreferenceDto } from './preferences.dto';
import { PreferencesService } from './preferences.service';

@UseGuards(SessionGuard)
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get('monthly-analytics')
  getMonthlyAnalytics(@Req() req: Request) {
    const user = (req as any).user as User;
    return this.preferencesService.getMonthlyAnalytics(user.id);
  }

  @Put('monthly-analytics')
  saveMonthlyAnalytics(
    @Req() req: Request,
    @Body() dto: SaveMonthlyAnalyticsPreferenceDto,
  ) {
    const user = (req as any).user as User;
    this.preferencesService.saveMonthlyAnalytics(user.id, dto);
    return { success: true };
  }
}
