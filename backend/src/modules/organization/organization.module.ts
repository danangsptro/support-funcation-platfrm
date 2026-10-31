import { Module } from '@nestjs/common';
import { OrgUnitsController } from './org-units.controller';
import { OrgUnitsService } from './org-units.service';

@Module({ controllers: [OrgUnitsController], providers: [OrgUnitsService] })
export class OrganizationModule {}
