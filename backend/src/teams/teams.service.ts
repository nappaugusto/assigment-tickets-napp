import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_TOKEN } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { PeopleService } from '../people/people.service';

interface TeamRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  user_id: number;
  name: string;
  email: string | null;
  role: string;
  is_admin: boolean;
}

function toTeamDto(team: TeamRow, members: MemberRow[] = []) {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    createdAt: team.created_at,
    updatedAt: team.updated_at,
    members: members.map((member) => ({
      userId: member.user_id,
      name: member.name,
      email: member.email,
      role: member.role,
      isAdmin: member.is_admin,
    })),
  };
}

@Injectable()
export class TeamsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Pool,
    private readonly usersService: UsersService,
    private readonly peopleService: PeopleService,
  ) {}

  async listTeams() {
    const teams = await this.db.query<TeamRow>(
      `SELECT * FROM internal_teams ORDER BY name`,
    );
    const members = await this.db.query<MemberRow & { team_id: number }>(
      `
        SELECT tm.team_id, tm.user_id, tm.is_admin, u.name, u.email, u.role
          FROM internal_team_members tm
          JOIN users u ON u.id = tm.user_id
         ORDER BY u.name
      `,
    );

    return teams.rows.map((team) =>
      toTeamDto(
        team,
        members.rows.filter((member) => member.team_id === team.id),
      ),
    );
  }

  async listUsers() {
    return this.usersService.getAllPublic();
  }

  async createTeam(name: string, description?: string) {
    const result = await this.db.query<TeamRow>(
      `
        INSERT INTO internal_teams (name, description, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          updated_at = now()
        RETURNING *
      `,
      [name.trim(), description?.trim() || null],
    );
    return toTeamDto(result.rows[0]);
  }

  async syncFromMovidesk() {
    const movideskTeams = await this.peopleService.fetchAssignmentTeams();
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      for (const team of movideskTeams) {
        await client.query(
          `
            INSERT INTO internal_teams (name, description, updated_at)
            VALUES ($1, 'Sincronizado do Movidesk', now())
            ON CONFLICT(name) DO UPDATE SET
              updated_at = now()
          `,
          [team],
        );
      }

      if (movideskTeams.length > 0) {
        await client.query(
          `
            UPDATE internal_cases
               SET team_id = NULL,
                   team_name = NULL
             WHERE team_id IN (
               SELECT id
                 FROM internal_teams
                WHERE NOT (name = ANY($1::text[]))
             )
          `,
          [movideskTeams],
        );

        await client.query(
          `
            DELETE FROM internal_teams
             WHERE NOT (name = ANY($1::text[]))
          `,
          [movideskTeams],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      teams: await this.listTeams(),
      syncedCount: movideskTeams.length,
    };
  }

  async updateTeam(teamId: number, name?: string, description?: string) {
    await this.findTeam(teamId);
    const result = await this.db.query<TeamRow>(
      `
        UPDATE internal_teams
           SET name = COALESCE($2, name),
               description = COALESCE($3, description),
               updated_at = now()
         WHERE id = $1
         RETURNING *
      `,
      [teamId, name?.trim() || null, description?.trim() || null],
    );

    const team = result.rows[0];
    await this.db.query(
      `
        UPDATE internal_cases
           SET team_name = $2
         WHERE team_id = $1
      `,
      [team.id, team.name],
    );

    return this.getTeam(team.id);
  }

  async deleteTeam(teamId: number) {
    await this.findTeam(teamId);
    await this.db.query(
      `
        UPDATE internal_cases
           SET team_id = NULL,
               team_name = NULL
         WHERE team_id = $1
      `,
      [teamId],
    );
    await this.db.query(`DELETE FROM internal_teams WHERE id = $1`, [teamId]);
    return { success: true };
  }

  async addMember(teamId: number, userId: number, isAdmin = false) {
    const team = await this.findTeam(teamId);
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    await this.db.query(
      `
        INSERT INTO internal_team_members (team_id, user_id, is_admin)
        VALUES ($1, $2, $3)
        ON CONFLICT(team_id, user_id) DO UPDATE SET
          is_admin = excluded.is_admin
      `,
      [teamId, userId, isAdmin],
    );

    return this.getTeam(team.id);
  }

  async removeMember(teamId: number, userId: number) {
    const team = await this.findTeam(teamId);
    await this.db.query(
      `
        DELETE FROM internal_team_members
         WHERE team_id = $1
           AND user_id = $2
      `,
      [teamId, userId],
    );

    return this.getTeam(team.id);
  }

  async getTeam(teamId: number) {
    const team = await this.findTeam(teamId);
    const members = await this.db.query<MemberRow>(
      `
        SELECT tm.user_id, tm.is_admin, u.name, u.email, u.role
          FROM internal_team_members tm
          JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = $1
         ORDER BY u.name
      `,
      [teamId],
    );
    return toTeamDto(team, members.rows);
  }

  private async findTeam(teamId: number) {
    const result = await this.db.query<TeamRow>(
      `SELECT * FROM internal_teams WHERE id = $1 LIMIT 1`,
      [teamId],
    );
    const team = result.rows[0];
    if (!team) throw new NotFoundException('Time não encontrado.');
    return team;
  }
}
