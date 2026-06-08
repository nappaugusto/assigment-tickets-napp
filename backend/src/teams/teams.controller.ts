import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { TeamsService } from './teams.service';
import { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './teams.dto';

@UseGuards(SessionGuard)
@Controller('internal-teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  async listTeams() {
    return { teams: await this.teamsService.listTeams() };
  }

  @Get('users')
  async listUsers() {
    return { users: await this.teamsService.listUsers() };
  }

  @UseGuards(AdminGuard)
  @Post()
  createTeam(@Body() dto: CreateTeamDto) {
    return this.teamsService.createTeam(dto.name, dto.description);
  }

  @UseGuards(AdminGuard)
  @Post('sync-movidesk')
  syncFromMovidesk() {
    return this.teamsService.syncFromMovidesk();
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  updateTeam(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.updateTeam(id, dto.name, dto.description);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  deleteTeam(@Param('id', ParseIntPipe) id: number) {
    return this.teamsService.deleteTeam(id);
  }

  @UseGuards(AdminGuard)
  @Post(':id/members')
  addMember(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamsService.addMember(id, dto.userId, !!dto.isAdmin);
  }

  @UseGuards(AdminGuard)
  @Delete(':id/members/:userId')
  removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.teamsService.removeMember(id, userId);
  }
}
