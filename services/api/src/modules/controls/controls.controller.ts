import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, isoDate, requiredText, text, uuid, zod } from '../../common/validation.js';
import { ControlsService } from './controls.service.js';

const IMPL_STATUSES = ['not_assessed', 'planned', 'in_progress', 'implemented', 'partially_implemented', 'not_applicable', 'retired'] as const;
const RESULTS = ['pass', 'fail', 'unknown', 'error', 'not_applicable'] as const;

const createBody = z.object({
  controlCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, 'Use 2–40 letters, digits, dots, dashes or underscores'),
  title: requiredText(200),
  description: requiredText(5000),
  category: requiredText(80),
  reviewFrequencyDays: z.number().int().min(1).max(1095).default(90),
  ownerId: uuid.nullable().optional(),
});
const updateBody = z.object({
  version: z.number().int().positive(),
  title: requiredText(200).optional(),
  description: requiredText(5000).optional(),
  category: requiredText(80).optional(),
  reviewFrequencyDays: z.number().int().min(1).max(1095).optional(),
  active: z.boolean().optional(),
});
const implementationBody = z.object({
  version: z.number().int().positive(),
  status: z.enum(IMPL_STATUSES).optional(),
  ownerId: uuid.nullable().optional(),
  applicabilityRationale: text(5000).nullable().optional(),
  soaIncluded: z.boolean().optional(),
  soaJustification: text(5000).nullable().optional(),
  implementationNotes: text(10000).nullable().optional(),
  nextReviewAt: isoDate.nullable().optional(),
  markReviewed: z.boolean().optional(),
  rationale: text(2000).optional(),
});
const listSchema = listQuery(['controlCode', 'title', 'category', 'updatedAt'], {
  category: z.string().max(80).optional(),
  status: multi(IMPL_STATUSES),
  ownerId: uuid.optional(),
  frameworkId: uuid.optional(),
  requirementId: uuid.optional(),
  testResult: multi(RESULTS),
  evidence: z.enum(['missing', 'expired', 'expiring', 'current']).optional(),
  reviewDue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
}, 'controlCode');

@ApiTags('controls')
@Controller('controls')
export class ControlsController {
  constructor(private readonly controls: ControlsService) {}

  @Get()
  @RequirePermission('control.read')
  @ApiZodQuery(listSchema)
  list(@Query(zod(listSchema)) query: z.infer<typeof listSchema>) {
    return this.controls.list(query);
  }

  @Get('categories')
  @RequirePermission('control.read')
  categories() {
    return this.controls.categories();
  }

  @Get('statement-of-applicability')
  @RequirePermission('control.read')
  soa() {
    return this.controls.statementOfApplicability();
  }

  @Get('templates')
  @RequirePermission('control.read')
  templates() {
    return this.controls.templates();
  }

  @Post('templates/:id/adopt')
  @RequirePermission('control.create')
  adopt(@Param('id', ParseUUIDPipe) id: string) {
    return this.controls.adoptTemplate(id);
  }

  @Post()
  @RequirePermission('control.create')
  @ApiZodBody(createBody)
  create(@Body(zod(createBody)) body: z.infer<typeof createBody>) {
    return this.controls.create(body);
  }

  @Get(':id')
  @RequirePermission('control.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.controls.get(id);
  }

  @Patch(':id')
  @RequirePermission('control.update')
  @ApiZodBody(updateBody)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateBody)) body: z.infer<typeof updateBody>) {
    const { version, ...input } = body;
    return this.controls.update(id, version, input);
  }

  /** Owner and review-schedule changes additionally require control.assign (checked in the service). */
  @Patch(':id/implementation')
  @RequirePermission('control.update')
  @ApiZodBody(implementationBody)
  implementation(@Param('id', ParseUUIDPipe) id: string, @Body(zod(implementationBody)) body: z.infer<typeof implementationBody>) {
    return this.controls.updateImplementation(id, body);
  }
}
