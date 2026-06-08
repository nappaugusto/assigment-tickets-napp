import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  Query,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { TicketsService } from './tickets.service';
import { SyncService } from '../sync/sync.service';

@Controller()
export class TicketsController {
  private readonly logger = new Logger(TicketsController.name);

  constructor(
    private readonly ticketsService: TicketsService,
    @Inject(forwardRef(() => SyncService))
    private readonly syncService: SyncService,
  ) {}

  @UseGuards(SessionGuard)
  @Get('tickets/refresh')
  async refresh(@Query('manual') manual?: string) {
    const force = manual === '1' || manual === 'true';
    try {
      await this.syncService.sync(force);
    } catch (error) {
      throw new BadGatewayException(
        `Não foi possível sincronizar com o Movidesk: ${(error as Error).message}`,
      );
    }

    const { tickets, newTickets, monthlyAnalytics } =
      await this.ticketsService.getDashboardSnapshot();
    const currentMonth = monthlyAnalytics.current_month;

    if (force && currentMonth) {
      this.logger.log(
        [
          'MONTHLY_ANALYTICS_SUMMARY',
          `month=${currentMonth.month}`,
          `on_time=${currentMonth.resolved_on_time}`,
          `late=${currentMonth.resolved_late}`,
        ].join(' | '),
      );
    }

    return {
      now: new Date().toISOString(),
      tickets,
      close_tickets: newTickets,
      count_tickets: tickets.length,
      close_count_tickets: newTickets.length,
      monthly_analytics: monthlyAnalytics,
    };
  }

  @UseGuards(SessionGuard)
  @Get('tickets/analytics/monthly')
  async monthlyAnalytics(
    @Query('months') months?: string,
    @Query('team') team?: string,
  ) {
    const parsedMonths = months ? Number(months) : undefined;
    return this.ticketsService.getMonthlyAnalytics(parsedMonths, team);
  }

  @Get('app-version')
  appVersion() {
    return { version: process.env.npm_package_version ?? '1.0.0' };
  }

  @UseGuards(SessionGuard)
  @Post('atribuir/:id')
  async assign(
    @Param('id', ParseIntPipe) id: number,
    @Body('responsavel') responsavel: string,
  ) {
    if (!responsavel?.trim()) {
      return { success: false, message: 'Responsável é obrigatório.' };
    }

    const ticket = await this.ticketsService.findById(id);
    if (!ticket) {
      throw new NotFoundException('Ticket não encontrado.');
    }

    const trimmedResponsavel = responsavel.trim();
    await this.ticketsService.assign(id, trimmedResponsavel);

    return {
      success: true,
      message: 'Ticket atribuído com sucesso.',
      ticket_id: id,
      responsavel: trimmedResponsavel,
      now: new Date().toISOString(),
    };
  }

  @UseGuards(SessionGuard)
  @Post('desatribuir/:id')
  async unassign(@Param('id', ParseIntPipe) id: number) {
    const ticket = await this.ticketsService.findById(id);
    if (!ticket) {
      throw new NotFoundException('Ticket não encontrado.');
    }

    await this.ticketsService.unassign(id);

    return {
      success: true,
      message: 'Atribuição removida com sucesso.',
      ticket_id: id,
      responsavel: null,
      now: new Date().toISOString(),
    };
  }
}
