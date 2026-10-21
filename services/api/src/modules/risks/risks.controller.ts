import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, isoDate, requiredText, score1to5, text, uuid, zod } from '../../common/validation.js';
import { LINKABLE_TYPES } from '../shared/entity-resolver.service.js';
import { RisksService } from './risks.service.js';
import { ScoringPolicyService } from './scoring-policy.service.js';

const STATUSES = ['identified', 'assessed', 'treatment_planned', 'in_treatment', 'monitoring', 'accepted', 'closed'] as const;
const RATINGS = ['low', 'medium', 'high', 'critical'] as const;
const TREATMENTS = ['undecided', 'mitigate', 'transfer', 'avoid', 'accept'] as const;

const riskBody = z.object({
  title: requiredText(200),
  description: requiredText(5000),
  category: requiredText(80),
  likelihood: score1to5,
  impact: score1to5,
  residualLikelihood: score1to5.nullable().optional(),
  residualImpact: score1to5.nullable().optional(),
  residualRationale: text(2000).nullable().optional(),
  riskOwnerId: uuid.nullable().optional(),
  treatment: z.enum(TREATMENTS.filter((t) => t !== 'accept') as unknown as ['undecided', 'mitigate', 'transfer', 'avoid']).optional(),
  treatmentPlan: text(5000).nullable().optional(),
  reviewDate: isoDate.nullable().optional(),
});
const updateBody = riskBody.partial().extend({
  version: z.number().int().positive(),
  status: z.enum(STATUSES).optional(),
  rationale: text(2000).optional(),
});
const listSchema = listQuery(['updatedAt', 'createdAt', 'inherentScore', 'residualScore', 'riskKey', 'title', 'reviewDate'], {
  status: multi(STATUSES),
  rating: multi(RATINGS),
  category: z.string().max(80).optional(),
  ownerId: uuid.optional(),
  sourceType: z.string().max(40).optional(),
  linkedType: z.enum(LINKABLE_TYPES).optional(),
  linkedId: uuid.optional(),
  likelihood: score1to5.optional(),
  impact: score1to5.optional(),
  residualLikelihood: score1to5.optional(),
  residualImpact: score1to5.optional(),
});
const controlLink = z.object({
  controlId: uuid,
  relationship: z.enum(['mitigates', 'detects', 'related']).default('mitigates'),
  effectivenessRating: z.enum(['not_assessed', 'ineffective', 'partially_effective', 'effective']).default('not_assessed'),
  rationale: text(2000).optional(),
});
const entityLink = z.object({ entityType: z.enum(LINKABLE_TYPES), entityId: uuid });
const acceptanceRequest = z.object({ rationale: requiredText(5000), scope: text(2000).optional(), expiryDate: isoDate });
const acceptanceDecision = z.object({ decision: z.enum(['approved', 'rejected']), rationale: requiredText(5000) });
const acceptanceQuery = listQuery(['requestedAt', 'expiryDate', 'decidedAt'], { decision: multi(['pending', 'approved', 'rejected', 'expired', 'withdrawn']) });
const archiveBody = z.object({ rationale: requiredText(2000) });
const policyBody = z.object({ kind: z.enum(['risk', 'vendor']), config: z.record(z.string(), z.unknown()), rationale: requiredText(2000) });

@ApiTags('risks')
@Controller()
export class RisksController {
  constructor(
    private readonly risks: RisksService,
    private readonly policies: ScoringPolicyService,
  ) {}

  @Get('risks')
  @RequirePermission('risk.read')
  @ApiZodQuery(listSchema)
  list(@Query(zod(listSchema)) query: z.infer<typeof listSchema>) {
    return this.risks.list(query);
  }

  @Get('risks/heatmap')
  @RequirePermission('risk.read')
  heatmap(@Query('basis') basis?: string) {
    return this.risks.heatmap(basis === 'residual' ? 'residual' : 'inherent');
  }

  @Post('risks')
  @RequirePermission('risk.create')
  @ApiZodBody(riskBody)
  create(@Body(zod(riskBody)) body: z.infer<typeof riskBody>) {
    return this.risks.create(body);
  }

  @Get('risks/:id')
  @RequirePermission('risk.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.risks.get(id);
  }

  @Patch('risks/:id')
  @RequirePermission('risk.update')
  @ApiZodBody(updateBody)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateBody)) body: z.infer<typeof updateBody>) {
    const { version, rationale, ...input } = body;
    return this.risks.update(id, version, input, rationale);
  }

  @Post('risks/:id/archive')
  @RequirePermission('risk.update')
  @HttpCode(204)
  @ApiZodBody(archiveBody)
  archive(@Param('id', ParseUUIDPipe) id: string, @Body(zod(archiveBody)) body: z.infer<typeof archiveBody>) {
    return this.risks.archive(id, body.rationale);
  }

  @Put('risks/:id/controls')
  @RequirePermission('risk.update')
  @ApiZodBody(controlLink)
  linkControl(@Param('id', ParseUUIDPipe) id: string, @Body(zod(controlLink)) body: z.infer<typeof controlLink>) {
    return this.risks.linkControl(id, body);
  }

  @Delete('risks/:id/controls/:controlId')
  @RequirePermission('risk.update')
  @HttpCode(204)
  unlinkControl(@Param('id', ParseUUIDPipe) id: string, @Param('controlId', ParseUUIDPipe) controlId: string) {
    return this.risks.unlinkControl(id, controlId);
  }

  @Post('risks/:id/links')
  @RequirePermission('risk.update')
  @ApiZodBody(entityLink)
  linkEntity(@Param('id', ParseUUIDPipe) id: string, @Body(zod(entityLink)) body: z.infer<typeof entityLink>) {
    return this.risks.linkEntity(id, body.entityType, body.entityId);
  }

  @Post('risks/:id/acceptance-requests')
  @RequirePermission('risk.acceptance.request')
  @ApiZodBody(acceptanceRequest)
  requestAcceptance(@Param('id', ParseUUIDPipe) id: string, @Body(zod(acceptanceRequest)) body: z.infer<typeof acceptanceRequest>) {
    return this.risks.requestAcceptance(id, body);
  }

  @Get('risk-acceptances')
  @RequirePermission('risk.read')
  @ApiZodQuery(acceptanceQuery)
  acceptances(@Query(zod(acceptanceQuery)) query: z.infer<typeof acceptanceQuery>) {
    return this.risks.listAcceptances(query);
  }

  @Post('risk-acceptances/:id/decision')
  @RequirePermission('risk.acceptance.decide')
  @HttpCode(200)
  @ApiZodBody(acceptanceDecision)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(zod(acceptanceDecision)) body: z.infer<typeof acceptanceDecision>) {
    return this.risks.decideAcceptance(id, body.decision, body.rationale);
  }

  @Post('risk-acceptances/:id/withdraw')
  @RequirePermission('risk.acceptance.request')
  @HttpCode(204)
  withdraw(@Param('id', ParseUUIDPipe) id: string) {
    return this.risks.withdrawAcceptance(id);
  }

  @Get('scoring-policies')
  @RequirePermission('risk.read')
  listPolicies() {
    return this.policies.list();
  }

  @Post('scoring-policies')
  @RequirePermission('risk_policy.manage')
  @ApiZodBody(policyBody)
  updatePolicy(@Body(zod(policyBody)) body: z.infer<typeof policyBody>) {
    return this.policies.update(body.kind, body.config, body.rationale);
  }
}
