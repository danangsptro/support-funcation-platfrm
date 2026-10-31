import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { Actor } from '../access/actor';
import { CurrentActor, RequirePermission } from '../access/decorators';
import { Permission } from '../access/permissions';
import { EmployeeSummaryQuery, ListEmployeesQuery } from './employees.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Karyawan')
@Controller('employees')
@RequirePermission(Permission.EmployeeRead)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: ListEmployeesQuery) {
    return this.employees.list(actor, q);
  }

  @Get('summary')
  summary(@CurrentActor() actor: Actor, @Query() q: EmployeeSummaryQuery) {
    return this.employees.summary(actor, q.asOf);
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.detail(actor, id);
  }
}
