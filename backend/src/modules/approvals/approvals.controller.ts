import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequestId } from '../../common/request-context';
import type { Actor } from '../access/actor';
import { CurrentActor, RequirePermission } from '../access/decorators';
import { Permission } from '../access/permissions';
import { ApprovalsService } from './approvals.service';
import { CreateRequestBody, DecisionBody, DelegateBody, ListRequestsQuery, RejectBody, UpdateRequestBody } from './dto';

/**
 * Baca (list/detail/audit) hanya butuh login: visibilitas ditentukan per pengajuan oleh service
 * (pengaju sendiri / oversight eksplisit / reviewer ber-role+scope); tanpa salah satunya hasilnya kosong/404.
 */
@ApiTags('Persetujuan anggaran')
@Controller('approval-requests')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('options')
  @RequirePermission(Permission.ApprovalRequestCreate)
  options(@CurrentActor() actor: Actor) {
    return this.approvals.options(actor);
  }

  @Post()
  @RequirePermission(Permission.ApprovalRequestCreate)
  create(@CurrentActor() actor: Actor, @Body() body: CreateRequestBody, @RequestId() requestId?: string) {
    return this.approvals.create(actor, body, requestId);
  }

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: ListRequestsQuery) {
    return this.approvals.list(actor, q);
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.detail(actor, id);
  }

  @Patch(':id')
  @RequirePermission(Permission.ApprovalRequestCreate)
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateRequestBody, @RequestId() requestId?: string) {
    return this.approvals.update(actor, id, body, requestId);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission(Permission.ApprovalRequestCreate)
  submit(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @RequestId() requestId?: string) {
    return this.approvals.submit(actor, id, requestId);
  }

  @Get(':id/audit')
  audit(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.auditTrail(actor, id);
  }

  @Post(':id/steps/:stepId/approve')
  @HttpCode(200)
  @RequirePermission(Permission.ApprovalDecide)
  approve(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() body: DecisionBody,
    @RequestId() requestId?: string,
  ) {
    return this.approvals.approve(actor, id, stepId, body.comment, requestId);
  }

  @Post(':id/steps/:stepId/reject')
  @HttpCode(200)
  @RequirePermission(Permission.ApprovalDecide)
  reject(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() body: RejectBody,
    @RequestId() requestId?: string,
  ) {
    return this.approvals.reject(actor, id, stepId, body.comment, requestId);
  }

  @Post(':id/steps/:stepId/delegate')
  @HttpCode(200)
  @RequirePermission(Permission.ApprovalDecide)
  delegate(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() body: DelegateBody,
    @RequestId() requestId?: string,
  ) {
    return this.approvals.delegate(actor, id, stepId, body, requestId);
  }

  @Get(':id/steps/:stepId/delegates')
  @RequirePermission(Permission.ApprovalDecide)
  delegates(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('stepId', ParseUUIDPipe) stepId: string) {
    return this.approvals.delegates(actor, id, stepId);
  }
}
