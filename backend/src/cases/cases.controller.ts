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
import { User } from '../users/user.entity';
import { CasesService } from './cases.service';
import { CreateCaseDto, UpdateCaseStatusDto } from './cases.dto';

@UseGuards(SessionGuard)
@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  async listCases() {
    return { cases: await this.casesService.listCases() };
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
