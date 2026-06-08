import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { User } from '../users/user.entity';
import { CasesService } from './cases.service';
import {
  CreateCaseCommentDto,
  CreateCaseDto,
  UpdateCaseStatusDto,
  UpdateSlaPolicyDto,
} from './cases.dto';

@UseGuards(SessionGuard)
@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  async listCases() {
    return { cases: await this.casesService.listCases() };
  }

  @Get('dashboard')
  dashboard() {
    return this.casesService.dashboard();
  }

  @Get('sla-policies')
  async listSlaPolicies() {
    return { policies: await this.casesService.listSlaPolicies() };
  }

  @UseGuards(AdminGuard)
  @Patch('sla-policies')
  updateSlaPolicy(@Body() dto: UpdateSlaPolicyDto) {
    return this.casesService.updateSlaPolicy(
      dto.priority,
      dto.durationHours,
    );
  }

  @Post()
  createCase(@Req() req: Request, @Body() dto: CreateCaseDto) {
    const user = (req as any).user as User;
    return this.casesService.createCase(user, dto);
  }

  @Get(':id')
  getCase(@Param('id', ParseIntPipe) id: number) {
    return this.casesService.getCase(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCaseStatusDto,
  ) {
    return this.casesService.updateStatus(id, dto.status);
  }

  @Post(':id/comments')
  addComment(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCaseCommentDto,
  ) {
    const user = (req as any).user as User;
    return this.casesService.addComment(id, user, dto.content);
  }

  @Get(':id/attachments/:attachmentId')
  @Header('Cache-Control', 'private, max-age=300')
  async getAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ) {
    const attachment = await this.casesService.getAttachment(id, attachmentId);
    res.setHeader('Content-Type', attachment.content_type);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${attachment.file_name.replace(/"/g, '')}"`,
    );
    res.send(attachment.content);
  }
}
