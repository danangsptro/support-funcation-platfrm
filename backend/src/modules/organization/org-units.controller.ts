import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { RequestId } from '../../common/request-context';
import type { Actor } from '../access/actor';
import { CurrentActor, RequirePermission } from '../access/decorators';
import { Permission } from '../access/permissions';
import { ListOrgUnitsQuery, UpdateOrgUnitDto } from './org-units.dto';
import { OrgUnitsService } from './org-units.service';

@ApiTags('Organisasi')
@Controller('org-units')
export class OrgUnitsController {
  constructor(private readonly units: OrgUnitsService) {}

  @Get()
  @RequirePermission(Permission.OrgRead)
  list(@CurrentActor() actor: Actor, @Query() q: ListOrgUnitsQuery) {
    return this.units.list(actor, q);
  }

  @Get(':id')
  @RequirePermission(Permission.OrgRead)
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.units.detail(actor, id);
  }

  @Patch(':id')
  @RequirePermission(Permission.OrgManage)
  rename(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOrgUnitDto,
    @RequestId() requestId?: string,
  ) {
    return this.units.rename(actor, id, body.name, requestId);
  }
}
