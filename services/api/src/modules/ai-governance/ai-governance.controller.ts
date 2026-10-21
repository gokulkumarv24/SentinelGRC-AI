import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, isoDate, requiredText, text, uuid, zod } from '../../common/validation.js';
import { AiAssessmentsService } from './ai-assessments.service.js';
import { AiRecordsService } from './ai-records.service.js';
import { AiSystemsService } from './ai-systems.service.js';

const LIFECYCLE = ['proposed', 'under_assessment', 'approved_for_pilot', 'pilot', 'approved_for_production', 'production', 'suspended', 'retired'] as const;
const TIERS = ['minimal', 'limited', 'high', 'unacceptable', 'undetermined'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const list = (max = 30) => z.array(text(120)).max(max).default([]);

const systemBody = z.object({
  name: requiredText(200),
  description: requiredText(5000),
  businessPurpose: requiredText(2000),
  businessJustification: text(2000).nullable().optional(),
  businessOwnerId: uuid.nullable().optional(),
  technicalOwnerId: uuid.nullable().optional(),
  riskOwnerId: uuid.nullable().optional(),
  providerVendorId: uuid.nullable().optional(),
  modelName: text(200).nullable().optional(),
  modelVersion: text(100).nullable().optional(),
  deploymentType: z.enum(['internal_build', 'third_party_api', 'embedded_in_product', 'saas_feature']),
  deploymentEnvironment: text(200).nullable().optional(),
  intendedUsers: text(2000).nullable().optional(),
  affectedPeople: text(2000).nullable().optional(),
  inputDataCategories: list(),
  outputDataCategories: list(),
  personalDataProcessed: z.boolean().default(false),
  sensitiveDataProcessed: z.boolean().default(false),
  dataRetention: text(1000).nullable().optional(),
  dataLocation: text(500).nullable().optional(),
  automatedDecisionMaking: z.boolean().default(false),
  influencesDecisionsAboutPeople: z.boolean().default(false),
  humanOversight: text(5000).nullable().optional(),
  overrideAndAppeal: text(5000).nullable().optional(),
  escalationPath: text(2000).nullable().optional(),
  externalDependencies: text(2000).nullable().optional(),
  knownLimitations: text(5000).nullable().optional(),
  foreseeableMisuse: text(5000).nullable().optional(),
  rollbackPlan: text(5000).nullable().optional(),
  deploymentDate: isoDate.nullable().optional(),
  retirementDate: isoDate.nullable().optional(),
  nextReviewAt: isoDate.nullable().optional(),
  documentationUri: z.url().max(1000).nullable().optional(),
});
const systemUpdate = systemBody.partial().extend({ version: z.number().int().positive(), rationale: text(2000).optional() });
const systemList = listQuery(['name', 'updatedAt', 'createdAt', 'nextReviewAt'], { lifecycleStatus: multi(LIFECYCLE), riskTier: multi(TIERS), reviewDue: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }, 'name');
const transitionBody = z.object({ to: z.enum(LIFECYCLE), rationale: requiredText(2000) });
const deployBody = z.object({ target: z.enum(['pilot', 'production']), rationale: requiredText(5000), nextReviewAt: isoDate });
const euBody = z.object({
  organizationRole: z.enum(['provider', 'deployer', 'importer', 'distributor', 'unknown']).nullable().optional(),
  systemRole: text(200).nullable().optional(),
  intendedPurpose: text(2000).nullable().optional(),
  geographicScope: text(500).nullable().optional(),
  placedOnEuMarket: z.boolean().nullable().optional(),
  checklist: z.record(z.string(), z.unknown()).default({}),
  potentialProhibitedPractice: z.boolean().nullable().optional(),
  potentialHighRisk: z.boolean().nullable().optional(),
  transparencyObligations: z.boolean().nullable().optional(),
  preliminaryClassification: z.enum(TIERS),
  rationale: text(5000).nullable().optional(),
  evidenceIds: z.array(uuid).max(20).optional(),
  legalReviewStatus: z.enum(['not_started', 'preliminary', 'under_legal_review', 'reviewed']),
  sourceUrl: z.url().max(1000).nullable().optional(),
  sourceCheckedAt: isoDate.nullable().optional(),
});
const assessmentBody = z.object({ templateId: uuid, frameworkId: uuid.nullable().optional(), assessorId: uuid.nullable().optional() });
const assessmentList = listQuery(['createdAt', 'submittedAt', 'approvedAt'], { status: multi(['draft', 'in_progress', 'submitted', 'approved', 'rejected', 'superseded']), aiSystemId: uuid.optional() });
const itemsBody = z.object({ items: z.array(z.object({ itemId: uuid, response: z.unknown().optional(), result: z.enum(['not_answered', 'satisfactory', 'needs_improvement', 'unsatisfactory', 'not_applicable']), rationale: text(5000).nullable().optional(), evidenceId: uuid.nullable().optional() })).min(1).max(200) });
const submitBody = z.object({ riskTier: z.enum(TIERS), rationale: requiredText(5000), residualRiskNotes: text(5000).nullable().optional() });
const decideBody = z.object({ decision: z.enum(['approved', 'rejected']), rationale: requiredText(5000), nextReviewAt: isoDate.nullable().optional() });
const evaluationBody = z.object({
  evaluationType: z.enum(['security', 'quality_reliability', 'fairness', 'privacy', 'explainability', 'human_review', 'drift_monitoring']),
  methodology: requiredText(5000),
  datasetOrMethodDescription: requiredText(5000),
  version: requiredText(100),
  result: z.enum(['pass', 'fail', 'inconclusive', 'informational']),
  metrics: z.record(z.string(), z.unknown()).default({}),
  limitations: requiredText(5000),
  executedAt: isoDate,
  evidenceId: uuid.nullable().optional(),
});
const recordsQuery = listQuery(['createdAt', 'executedAt', 'detectedAt'], {
  aiSystemId: uuid.optional(),
  evaluationType: z.string().max(40).optional(),
  status: multi(['open', 'investigating', 'mitigated', 'resolved', 'closed']),
  severity: multi(SEVERITIES),
  reviewStatus: multi(['unreviewed', 'pending_review', 'approved', 'rejected']),
});
const reviewBody = z.object({ decision: z.enum(['approved', 'rejected']), notes: requiredText(5000) });
const incidentBody = z.object({ title: requiredText(200), severity: z.enum(SEVERITIES), description: requiredText(5000), detectedAt: isoDate, impact: text(5000).nullable().optional() });
const incidentUpdate = z.object({ status: z.enum(['open', 'investigating', 'mitigated', 'resolved', 'closed']).optional(), impact: text(5000).nullable().optional(), rootCause: text(5000).nullable().optional(), responseActions: text(5000).nullable().optional(), lessonsLearned: text(5000).nullable().optional() });
const changeBody = z.object({ changeType: z.enum(['model_version', 'provider', 'intended_purpose', 'data', 'other']), changeDescription: requiredText(5000), previousVersion: text(100).nullable().optional(), newVersion: text(100).nullable().optional(), changeRisk: z.enum(SEVERITIES), requiresReassessment: z.boolean().default(true) });

@ApiTags('ai-governance')
@Controller()
export class AiGovernanceController {
  constructor(
    private readonly systems: AiSystemsService,
    private readonly assessments: AiAssessmentsService,
    private readonly records: AiRecordsService,
  ) {}

  @Get('ai-systems')
  @RequirePermission('ai_system.read')
  @ApiZodQuery(systemList)
  list(@Query(zod(systemList)) q: z.infer<typeof systemList>) {
    return this.systems.list(q);
  }

  @Get('ai-systems/eu-ai-act-schedule')
  @RequirePermission('ai_system.read')
  schedule() {
    return this.systems.euAiActSchedule();
  }

  @Post('ai-systems')
  @RequirePermission('ai_system.create')
  @ApiZodBody(systemBody)
  create(@Body(zod(systemBody)) b: z.infer<typeof systemBody>) {
    return this.systems.create(b);
  }

  @Get('ai-systems/:id')
  @RequirePermission('ai_system.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.systems.get(id);
  }

  @Patch('ai-systems/:id')
  @RequirePermission('ai_system.update')
  @ApiZodBody(systemUpdate)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(systemUpdate)) b: z.infer<typeof systemUpdate>) {
    const { version, rationale, ...input } = b;
    return this.systems.update(id, version, input, rationale);
  }

  @Post('ai-systems/:id/transition')
  @RequirePermission('ai_system.lifecycle')
  @HttpCode(200)
  @ApiZodBody(transitionBody)
  transition(@Param('id', ParseUUIDPipe) id: string, @Body(zod(transitionBody)) b: z.infer<typeof transitionBody>) {
    return this.systems.transition(id, b.to, b.rationale);
  }

  @Get('ai-systems/:id/readiness')
  @RequirePermission('ai_system.read')
  readiness(@Param('id', ParseUUIDPipe) id: string) {
    return this.systems.readiness(id);
  }

  @Post('ai-systems/:id/approve-deployment')
  @RequirePermission('ai_assessment.decide')
  @HttpCode(200)
  @ApiZodBody(deployBody)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body(zod(deployBody)) b: z.infer<typeof deployBody>) {
    return this.systems.approveDeployment(id, b);
  }

  @Put('ai-systems/:id/eu-ai-act')
  @RequirePermission('ai_assessment.manage')
  @ApiZodBody(euBody)
  eu(@Param('id', ParseUUIDPipe) id: string, @Body(zod(euBody)) b: z.infer<typeof euBody>) {
    return this.systems.saveEuAiAct(id, b);
  }

  // ── Assessments ──
  @Post('ai-systems/:id/assessments')
  @RequirePermission('ai_assessment.manage')
  @ApiZodBody(assessmentBody)
  createAssessment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(assessmentBody)) b: z.infer<typeof assessmentBody>) {
    return this.assessments.create(id, b);
  }

  @Get('ai-assessments')
  @RequirePermission('ai_system.read')
  @ApiZodQuery(assessmentList)
  listAssessments(@Query(zod(assessmentList)) q: z.infer<typeof assessmentList>) {
    return this.assessments.list(q);
  }

  @Get('ai-assessments/:id')
  @RequirePermission('ai_system.read')
  getAssessment(@Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.get(id);
  }

  @Post('ai-assessments/:id/items')
  @RequirePermission('ai_assessment.manage')
  @HttpCode(200)
  @ApiZodBody(itemsBody)
  items(@Param('id', ParseUUIDPipe) id: string, @Body(zod(itemsBody)) b: z.infer<typeof itemsBody>) {
    return this.assessments.saveItems(id, b.items);
  }

  @Post('ai-assessments/:id/submit')
  @RequirePermission('ai_assessment.manage')
  @HttpCode(200)
  @ApiZodBody(submitBody)
  submit(@Param('id', ParseUUIDPipe) id: string, @Body(zod(submitBody)) b: z.infer<typeof submitBody>) {
    return this.assessments.submit(id, b);
  }

  @Post('ai-assessments/:id/decision')
  @RequirePermission('ai_assessment.decide')
  @HttpCode(200)
  @ApiZodBody(decideBody)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(zod(decideBody)) b: z.infer<typeof decideBody>) {
    return this.assessments.decide(id, b);
  }

  // ── Evaluations / incidents / changes ──
  @Get('ai-evaluations')
  @RequirePermission('ai_system.read')
  @ApiZodQuery(recordsQuery)
  evaluations(@Query(zod(recordsQuery)) q: z.infer<typeof recordsQuery>) {
    return this.records.listEvaluations(q);
  }

  @Post('ai-systems/:id/evaluations')
  @RequirePermission('ai_evaluation.manage')
  @ApiZodBody(evaluationBody)
  evaluate(@Param('id', ParseUUIDPipe) id: string, @Body(zod(evaluationBody)) b: z.infer<typeof evaluationBody>) {
    return this.records.createEvaluation(id, b);
  }

  @Post('ai-evaluations/:id/review')
  @RequirePermission('ai_assessment.decide')
  @HttpCode(200)
  @ApiZodBody(reviewBody)
  reviewEvaluation(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reviewBody)) b: z.infer<typeof reviewBody>) {
    return this.records.reviewEvaluation(id, b.decision, b.notes);
  }

  @Get('ai-incidents')
  @RequirePermission('ai_system.read')
  @ApiZodQuery(recordsQuery)
  incidents(@Query(zod(recordsQuery)) q: z.infer<typeof recordsQuery>) {
    return this.records.listIncidents(q);
  }

  @Post('ai-systems/:id/incidents')
  @RequirePermission('ai_incident.manage')
  @ApiZodBody(incidentBody)
  incident(@Param('id', ParseUUIDPipe) id: string, @Body(zod(incidentBody)) b: z.infer<typeof incidentBody>) {
    return this.records.createIncident(id, b);
  }

  @Patch('ai-incidents/:id')
  @RequirePermission('ai_incident.manage')
  @ApiZodBody(incidentUpdate)
  updateIncident(@Param('id', ParseUUIDPipe) id: string, @Body(zod(incidentUpdate)) b: z.infer<typeof incidentUpdate>) {
    return this.records.updateIncident(id, b);
  }

  @Get('ai-model-changes')
  @RequirePermission('ai_system.read')
  @ApiZodQuery(recordsQuery)
  changes(@Query(zod(recordsQuery)) q: z.infer<typeof recordsQuery>) {
    return this.records.listChanges(q);
  }

  @Post('ai-systems/:id/changes')
  @RequirePermission('ai_change.manage')
  @ApiZodBody(changeBody)
  change(@Param('id', ParseUUIDPipe) id: string, @Body(zod(changeBody)) b: z.infer<typeof changeBody>) {
    return this.records.createChange(id, b);
  }

  @Post('ai-model-changes/:id/review')
  @RequirePermission('ai_change.review')
  @HttpCode(200)
  @ApiZodBody(reviewBody)
  reviewChange(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reviewBody)) b: z.infer<typeof reviewBody>) {
    return this.records.reviewChange(id, b.decision, b.notes);
  }
}
