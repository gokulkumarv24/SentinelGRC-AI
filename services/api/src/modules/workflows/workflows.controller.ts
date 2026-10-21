import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, uuid, zod } from '../../common/validation.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { WorkflowsService } from './workflows.service.js';

const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'partially_succeeded', 'cancelled'] as const;
const definitionUpdate = z.object({
  enabled: z.boolean().optional(),
  intervalHours: z.number().int().min(1).max(24 * 31).optional(),
  warnDays: z.number().int().min(0).max(365).optional(),
  version: z.number().int().positive(),
});
const runList = listQuery(['createdAt', 'completedAt'], {
  status: multi(RUN_STATUSES),
  workflowDefinitionId: uuid.optional(),
  triggerSource: z.enum(['schedule', 'event', 'manual', 'retry']).optional(),
});
const pageQuery = listQuery(['createdAt'], { recordType: z.string().max(60).optional() });
const configuration = z.record(z.string().max(60), z.string().max(200));
const integrationBody = z.object({
  provider: z.string().max(60),
  displayName: z.string().trim().max(200).optional(),
  configuration: configuration.default({}),
  configurationReference: z.string().max(80).nullable().optional(),
});
const integrationUpdate = z.object({
  displayName: z.string().trim().max(200).optional(),
  configuration: configuration.optional(),
  configurationReference: z.string().max(80).nullable().optional(),
  enabled: z.boolean().optional(),
});

@ApiTags('workflows')
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('workflows')
  @RequirePermission('workflow.read')
  list() {
    return this.workflows.listDefinitions();
  }

  @Patch('workflows/:id')
  @RequirePermission('workflow.manage')
  @ApiZodBody(definitionUpdate)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(definitionUpdate)) b: z.infer<typeof definitionUpdate>) {
    return this.workflows.updateDefinition(id, b);
  }

  @Post('workflows/:id/run')
  @HttpCode(202)
  @RequirePermission('workflow.run')
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.runNow(id);
  }

  @Get('workflow-runs')
  @RequirePermission('workflow.read')
  @ApiZodQuery(runList)
  runs(@Query(zod(runList)) q: z.infer<typeof runList>) {
    return this.workflows.listRuns(q);
  }

  @Get('workflow-runs/:id')
  @RequirePermission('workflow.read')
  getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.getRun(id);
  }

  @Post('workflow-runs/:id/retry')
  @HttpCode(202)
  @RequirePermission('workflow.retry')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.retry(id);
  }
}

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @RequirePermission('integration.read')
  list() {
    return this.integrations.list();
  }

  @Get('providers')
  @RequirePermission('integration.read')
  providers() {
    return this.integrations.providers();
  }

  @Post()
  @RequirePermission('integration.manage')
  @ApiZodBody(integrationBody)
  create(@Body(zod(integrationBody)) b: z.infer<typeof integrationBody>) {
    return this.integrations.create(b);
  }

  @Get(':id')
  @RequirePermission('integration.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.get(id);
  }

  @Patch(':id')
  @RequirePermission('integration.manage')
  @ApiZodBody(integrationUpdate)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(integrationUpdate)) b: z.infer<typeof integrationUpdate>) {
    return this.integrations.update(id, b);
  }

  @Post(':id/test')
  @HttpCode(200)
  @RequirePermission('integration.sync')
  test(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.testConnection(id);
  }

  @Post(':id/sync')
  @HttpCode(202)
  @RequirePermission('integration.sync')
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.requestSync(id);
  }

  @Get(':id/sync-runs')
  @RequirePermission('integration.read')
  @ApiZodQuery(pageQuery)
  syncRuns(@Param('id', ParseUUIDPipe) id: string, @Query(zod(pageQuery)) q: z.infer<typeof pageQuery>) {
    return this.integrations.syncRuns(id, q);
  }

  @Get(':id/records')
  @RequirePermission('integration.read')
  @ApiZodQuery(pageQuery)
  records(@Param('id', ParseUUIDPipe) id: string, @Query(zod(pageQuery)) q: z.infer<typeof pageQuery>) {
    return this.integrations.records(id, q);
  }
}
