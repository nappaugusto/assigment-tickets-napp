import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { AiTriageService } from './ai-triage.service';
import { TriageDecisionDto } from './ai-triage.dto';

@UseGuards(SessionGuard)
@Controller()
export class AiTriageController {
  constructor(private readonly aiTriageService: AiTriageService) {}

  @Get('tickets/:ticketId/triage')
  async latest(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return {
      triage: await this.aiTriageService.getLatestForTicket(ticketId),
    };
  }

  @Post('tickets/:ticketId/triage')
  start(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.aiTriageService.start(ticketId);
  }

  @Post('tickets/:ticketId/triage/reanalyze')
  reanalyze(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.aiTriageService.start(ticketId);
  }

  @Patch('triage/:id/decision')
  async decision(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TriageDecisionDto,
  ) {
    const triage = await this.aiTriageService.setDecision(id, dto.decision);
    if (!triage) throw new NotFoundException('Triagem não encontrada.');
    return { triage };
  }
}
