import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators.js';
import { AgentService } from './agent.service.js';

@ApiTags('ai-agent')
@Controller('ai/agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  /** Usage against the daily budget, whether the agent can run, its jobs and drafts waiting for review. */
  @Get()
  @RequirePermission('assistant.use')
  overview() {
    return this.agent.overview();
  }

  /** Queues mapping suggestions for every unmapped requirement of a framework (into the review queue). */
  @Post('frameworks/:id/suggest-mappings')
  @HttpCode(202)
  @RequirePermission('mapping.manage')
  suggestMappings(@Param('id', ParseUUIDPipe) id: string) {
    return this.agent.suggestMappings(id);
  }
}
