import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guard';
import { PeopleService } from './people.service';

@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @UseGuards(SessionGuard)
  @Get('assignment')
  async assignmentPeople() {
    return {
      people: await this.peopleService.fetchAssignmentPeople(),
    };
  }

  @UseGuards(SessionGuard)
  @Get('assignment/details')
  async assignmentPeopleDetails() {
    return {
      people: await this.peopleService.fetchAssignmentPeopleDetails(),
    };
  }
}
