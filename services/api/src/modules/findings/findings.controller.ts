import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, isoDate, requiredText, text, uuid, zod } from '../../common/validation.js';
import { FindingsService } from './findings.service.js';

const STATUSES = ['open', 'triaged', 'in_remediation', 'pending_validation', 'closed', 'accepted', 'reopened'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const bool = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

const createBody = z
  .object({
    title: requiredText(200),
    description: requiredText(5000),
    severity: z.enum(SEVERITIES),
    severityRationale: text(2000).optional(),
    category: text(80).optional(),
    controlId: uuid.nullable().optional(),
    riskId: uuid.nullable().optional(),
    assignedTo: uuid.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    noDueDateReason: text(1000).nullable().optional(),
  })
  .refine((f) => f.dueDate !== null || !!f.noDueDateReason, { message: 'Provide a due date or a reason for none', path: ['dueDate'] });
const updateBody = z.object({
  version: z.number().int().positive(),
  title: requiredText(200).optional(),
  description: requiredText(5000).optional(),
  severity: z.enum(SEVERITIES).optional(),
  severityRationale: text(2000).optional(),
  category: text(80).optional(),
  assignedTo: uuid.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  noDueDateReason: text(1000).nullable().optional(),
  controlId: uuid.nullable().optional(),
  riskId: uuid.nullable().optional(),
});
const transitionBody = z.object({
  toStatus: z.enum(STATUSES),
  rationale: requiredText(5000),
  closureEvidenceId: uuid.nullable().optional(),
  version: z.number().int().positive().optional(),
});
const listSchema = listQuery(['createdAt', 'updatedAt', 'dueDate', 'severity', 'lastDetectedAt', 'findingKey'], {
  status: multi(STATUSES),
  severity: multi(SEVERITIES),
  sourceType: z.string().max(40).optional(),
  assignedTo: uuid.optional(),
  controlId: uuid.optional(),
  overdue: bool,
  openOnly: bool,
});

@ApiTags('findings')
@Controller('findings')
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get()
  @RequirePermission('finding.read')
  @ApiZodQuery(listSchema)
  list(@Query(zod(listSchema)) query: z.infer<typeof listSchema>) {
    return this.findings.list(query);
  }

  @Post()
  @RequirePermission('finding.create')
  @ApiZodBody(createBody)
  create(@Body(zod(createBody)) body: z.infer<typeof createBody>) {
    return this.findings.create(body);
  }

  @Get(':id')
  @RequirePermission('finding.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.findings.get(id);
  }

  @Patch(':id')
  @RequirePermission('finding.update')
  @ApiZodBody(updateBody)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateBody)) body: z.infer<typeof updateBody>) {
    const { version, ...input } = body;
    return this.findings.update(id, version, input);
  }

  /** Closing/accepting additionally requires finding.close (checked in the service). */
  @Post(':id/transition')
  @RequirePermission('finding.update')
  @HttpCode(200)
  @ApiZodBody(transitionBody)
  transition(@Param('id', ParseUUIDPipe) id: string, @Body(zod(transitionBody)) body: z.infer<typeof transitionBody>) {
    return this.findings.transition(id, body);
  }
}
