import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { TeamsService } from './teams.service';
import { AddTeamMemberDto, CreateTeamDto } from './teams.dto';

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
  @Post(':id/members')
  addMember(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamsService.addMember(id, dto.userId, !!dto.isAdmin);
  }
}
