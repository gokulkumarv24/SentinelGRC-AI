import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Idempotent, RateLimit, RequirePermission } from '../../common/decorators.js';
import { assertPermission } from '../../common/request-context.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, requiredText, text, uuid, zod } from '../../common/validation.js';
import { ControlTestsService } from '../control-tests/control-tests.service.js';
import { ControlImportService } from '../controls/control-import.service.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { FrameworksService } from '../frameworks/frameworks.service.js';
import { MappingsService } from '../frameworks/mappings.service.js';
import { ComplianceService } from './compliance.service.js';

const MAPPING_TYPES = ['supports', 'partially_supports', 'related', 'requires_separate_evidence'] as const;
const REVIEW = ['unreviewed', 'pending_review', 'approved', 'rejected'] as const;
const RESULTS = ['pass', 'fail', 'unknown', 'error', 'not_applicable'] as const;

const mappingBody = z.object({
  sourceRequirementId: uuid,
  targetRequirementId: uuid.nullable().optional(),
  controlId: uuid.nullable().optional(),
  mappingType: z.enum(MAPPING_TYPES),
  rationale: requiredText(5000),
  confidence: z.number().int().min(0).max(100),
  sourceReference: text(1000).nullable().optional(),
});
const mappingUpdate = z.object({ version: z.number().int().positive(), mappingType: z.enum(MAPPING_TYPES).optional(), rationale: requiredText(5000).optional(), confidence: z.number().int().min(0).max(100).optional(), sourceReference: text(1000).nullable().optional(), changeRationale: text(2000).optional() });
const reviewBody = z.object({ decision: z.enum(['approved', 'rejected']), notes: requiredText(5000) });
const mappingQuery = listQuery(['createdAt', 'updatedAt', 'confidence'], {
  reviewStatus: multi(REVIEW),
  frameworkId: uuid.optional(),
  controlId: uuid.optional(),
  scope: z.enum(['organization', 'platform']).optional(),
  queue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
const requirementQuery = z.object({ q: z.string().max(100).optional(), frameworkId: uuid.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const scopeBody = z.object({ frameworkIds: z.array(uuid).max(50) });
const testBody = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('automated') }),
  z.object({ mode: z.literal('manual'), result: z.enum(['pass', 'fail', 'unknown', 'not_applicable']), summary: requiredText(1000), rationale: requiredText(5000), evidenceIds: z.array(uuid).max(20).optional() }),
]);
const configBody = z.object({ ruleKey: z.string().max(60), parameters: z.record(z.string(), z.unknown()).default({}), frequencyHours: z.number().int().min(1).max(24 * 90).default(24), enabled: z.boolean().default(true) });
const testsQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), result: multi(RESULTS), testType: z.enum(['automated', 'manual']).optional() });
const importBody = z.object({ csv: z.string().min(1).max(1_000_000), mode: z.enum(['create_only', 'upsert']).default('create_only') });

@ApiTags('compliance')
@Controller()
export class ComplianceController {
  constructor(
    private readonly frameworks: FrameworksService,
    private readonly mappings: MappingsService,
    private readonly tests: ControlTestsService,
    private readonly compliance: ComplianceService,
    private readonly dashboard: DashboardService,
    private readonly imports: ControlImportService,
  ) {}

  // ── Frameworks ──
  @Get('frameworks')
  @RequirePermission('framework.read')
  listFrameworks() {
    return this.frameworks.list();
  }

  @Get('frameworks/requirements')
  @RequirePermission('framework.read')
  @ApiZodQuery(requirementQuery)
  requirements(@Query(zod(requirementQuery)) query: z.infer<typeof requirementQuery>) {
    return this.frameworks.requirements(query);
  }

  @Put('frameworks/scope')
  @RequirePermission('framework.manage')
  @ApiZodBody(scopeBody)
  setScope(@Body(zod(scopeBody)) body: z.infer<typeof scopeBody>) {
    return this.frameworks.setScope(body.frameworkIds);
  }

  @Post('frameworks/import-preview')
  @RequirePermission('framework.manage')
  @HttpCode(200)
  frameworkImportPreview(@Body() body: unknown) {
    return this.frameworks.preview(body);
  }

  @Post('frameworks/import')
  @RequirePermission('framework.manage')
  @RateLimit('expensive')
  importFramework(@Body() body: unknown) {
    return this.frameworks.importForOrganization(body);
  }

  @Get('frameworks/:id')
  @RequirePermission('framework.read')
  getFramework(@Param('id', ParseUUIDPipe) id: string) {
    return this.frameworks.get(id);
  }

  @Delete('frameworks/:id')
  @RequirePermission('framework.manage')
  @HttpCode(204)
  archiveFramework(@Param('id', ParseUUIDPipe) id: string) {
    return this.frameworks.archive(id);
  }

  // ── Mappings ──
  @Get('control-mappings')
  @RequirePermission('mapping.read')
  @ApiZodQuery(mappingQuery)
  listMappings(@Query(zod(mappingQuery)) query: z.infer<typeof mappingQuery>) {
    return this.mappings.list(query);
  }

  @Post('control-mappings')
  @RequirePermission('mapping.manage')
  @ApiZodBody(mappingBody)
  createMapping(@Body(zod(mappingBody)) body: z.infer<typeof mappingBody>) {
    return this.mappings.create(body);
  }

  @Get('control-mappings/:id')
  @RequirePermission('mapping.read')
  getMapping(@Param('id', ParseUUIDPipe) id: string) {
    return this.mappings.get(id);
  }

  @Patch('control-mappings/:id')
  @RequirePermission('mapping.manage')
  @ApiZodBody(mappingUpdate)
  updateMapping(@Param('id', ParseUUIDPipe) id: string, @Body(zod(mappingUpdate)) body: z.infer<typeof mappingUpdate>) {
    const { version, changeRationale, ...input } = body;
    return this.mappings.update(id, version, input, changeRationale);
  }

  @Post('control-mappings/:id/review')
  @RequirePermission('mapping.review')
  @HttpCode(200)
  @ApiZodBody(reviewBody)
  reviewMapping(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reviewBody)) body: z.infer<typeof reviewBody>) {
    return this.mappings.review(id, body.decision, body.notes);
  }

  @Post('control-mappings/:id/adopt')
  @RequirePermission('mapping.manage')
  adoptMapping(@Param('id', ParseUUIDPipe) id: string) {
    return this.mappings.adopt(id);
  }

  // ── Control tests ──
  @Get('control-tests/rules')
  @RequirePermission('control_test.read')
  rules() {
    return this.tests.ruleCatalog();
  }

  @Get('control-tests')
  @RequirePermission('control_test.read')
  @ApiZodQuery(testsQuery)
  allTests(@Query(zod(testsQuery)) query: z.infer<typeof testsQuery>) {
    return this.tests.listAll(query);
  }

  @Get('controls/:id/tests')
  @RequirePermission('control_test.read')
  controlTests(@Param('id', ParseUUIDPipe) id: string, @Query(zod(testsQuery)) query: z.infer<typeof testsQuery>) {
    return this.tests.list(id, query);
  }

  /** mode=automated needs control_test.run; mode=manual needs control_test.manual (checked here). */
  @Post('controls/:id/tests')
  @Idempotent('controls.tests.run')
  @RequirePermission('control_test.read')
  @RateLimit('expensive')
  @HttpCode(200)
  @ApiZodBody(testBody)
  async runTests(@Param('id', ParseUUIDPipe) id: string, @Body(zod(testBody)) body: z.infer<typeof testBody>) {
    if (body.mode === 'automated') {
      assertPermission('control_test.run');
      return { results: await this.tests.runForControl(id) };
    }
    assertPermission('control_test.manual');
    return { results: [await this.tests.recordManual(id, body)] };
  }

  @Get('controls/:id/test-configs')
  @RequirePermission('control_test.read')
  configs(@Param('id', ParseUUIDPipe) id: string) {
    return this.tests.configs(id);
  }

  @Put('controls/:id/test-configs')
  @RequirePermission('control.update')
  @ApiZodBody(configBody)
  saveConfig(@Param('id', ParseUUIDPipe) id: string, @Body(zod(configBody)) body: z.infer<typeof configBody>) {
    return this.tests.upsertConfig(id, body);
  }

  // ── Bulk control import / export ──
  @Post('controls/import-preview')
  @RequirePermission('control.create')
  @HttpCode(200)
  @ApiZodBody(importBody)
  async importPreview(@Body(zod(importBody)) body: z.infer<typeof importBody>) {
    const { internal: _internal, ...preview } = await this.imports.preview(body.csv, body.mode);
    return preview;
  }

  @Post('controls/import')
  @RequirePermission('control.create')
  @RateLimit('expensive')
  @ApiZodBody(importBody)
  importControls(@Body(zod(importBody)) body: z.infer<typeof importBody>) {
    return this.imports.import(body.csv, body.mode);
  }

  @Get('controls/export.csv')
  @RequirePermission('control.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="controls.csv"')
  exportControls() {
    return this.imports.export();
  }

  // ── Compliance & dashboard ──
  @Get('compliance/summary')
  @RequirePermission('control.read')
  complianceSummary() {
    return this.compliance.summary();
  }

  @Get('compliance/frameworks/:id')
  @RequirePermission('control.read')
  complianceFramework(@Param('id', ParseUUIDPipe) id: string) {
    return this.compliance.framework(id);
  }

  @Get('dashboard/summary')
  @RequirePermission('dashboard.read')
  dashboardSummary() {
    return this.dashboard.summary();
  }

  @Get('dashboard/risk-trends')
  @RequirePermission('dashboard.read')
  riskTrends(@Query('months') months?: string) {
    const n = Math.min(24, Math.max(3, Number(months) || 12));
    return this.dashboard.riskTrends(n);
  }

  @Get('dashboard/compliance')
  @RequirePermission('dashboard.read')
  dashboardCompliance() {
    return this.dashboard.compliancePosture();
  }

  @Get('dashboard/recent-events')
  @RequirePermission('dashboard.read')
  recentEvents() {
    return this.dashboard.recentEvents();
  }
}
