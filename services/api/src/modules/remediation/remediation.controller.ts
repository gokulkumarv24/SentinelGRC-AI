import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, isoDate, requiredText, text, uuid, zod } from '../../common/validation.js';
import { RemediationService } from './remediation.service.js';

const STATUSES = ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const createBody = z.object({
  findingId: uuid.nullable().optional(),
  title: requiredText(200),
  description: text(5000).nullable().optional(),
  ownerId: uuid.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: isoDate.nullable().optional(),
});
const updateBody = z.object({
  version: z.number().int().positive(),
  title: requiredText(200).optional(),
  description: text(5000).nullable().optional(),
  ownerId: uuid.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: isoDate.nullable().optional(),
  status: z.enum(['open', 'in_progress', 'blocked', 'cancelled']).optional(),
  vendorResponse: text(5000).nullable().optional(),
  internalReviewStatus: z.enum(['unreviewed', 'pending_review', 'approved', 'rejected']).optional(),
});
const completeBody = z.object({ version: z.number().int().positive(), completionNotes: requiredText(5000), completionEvidenceId: uuid.nullable().optional() });
const listSchema = listQuery(['dueDate', 'createdAt', 'updatedAt', 'priority', 'status'], {
  status: multi(STATUSES),
  priority: multi(PRIORITIES),
  ownerId: uuid.optional(),
  findingId: uuid.optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

@ApiTags('remediation')
@Controller('remediation-tasks')
export class RemediationController {
  constructor(private readonly tasks: RemediationService) {}

  @Get()
  @RequirePermission('remediation.read')
  @ApiZodQuery(listSchema)
  list(@Query(zod(listSchema)) query: z.infer<typeof listSchema>) {
    return this.tasks.list(query);
  }

  @Post()
  @RequirePermission('remediation.create')
  @ApiZodBody(createBody)
  create(@Body(zod(createBody)) body: z.infer<typeof createBody>) {
    return this.tasks.create(body);
  }

  @Get(':id')
  @RequirePermission('remediation.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(id);
  }

  @Patch(':id')
  @RequirePermission('remediation.update')
  @ApiZodBody(updateBody)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateBody)) body: z.infer<typeof updateBody>) {
    const { version, ...input } = body;
    return this.tasks.update(id, version, input);
  }

  @Post(':id/complete')
  @RequirePermission('remediation.update')
  @HttpCode(200)
  @ApiZodBody(completeBody)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body(zod(completeBody)) body: z.infer<typeof completeBody>) {
    return this.tasks.complete(id, body);
  }
}
