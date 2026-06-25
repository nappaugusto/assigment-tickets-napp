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
import {
  CodeAnalysisContextDto,
  TriageDecisionDto,
  TriageFollowUpDto,
} from './ai-triage.dto';

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

  @Get('triage/claude/status')
  claudeStatus() {
    return {
      claude: this.aiTriageService.getClaudeStatus(),
    };
  }

  @Post('triage/claude/status/refresh')
  async refreshClaudeStatus() {
    return {
      claude: await this.aiTriageService.refreshClaudeCliStatus(),
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

  @Post('tickets/:ticketId/triage/code-analysis')
  analyzeCode(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() context: CodeAnalysisContextDto,
  ) {
    return this.aiTriageService.start(ticketId, 'code_analysis', context);
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

  @Post('triage/:id/messages')
  async followUp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TriageFollowUpDto,
  ) {
    const triage = await this.aiTriageService.sendFollowUp(id, dto.message);
    if (!triage) throw new NotFoundException('Triagem não encontrada.');
    return { triage };
  }
}
