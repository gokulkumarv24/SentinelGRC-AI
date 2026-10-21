import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Idempotent, RateLimit, RequirePermission } from '../../common/decorators.js';
import { listQuery } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, uuid, zod } from '../../common/validation.js';
import { AssistantService } from './assistant.service.js';
import { ARTIFACT_TYPES, draftOutput } from './tasks.js';

const generateBody = z.object({ artifactType: z.enum(ARTIFACT_TYPES), targetId: uuid, controlId: uuid.optional() });
const reviewBody = z.object({ decision: z.enum(['accepted', 'edited_and_accepted', 'rejected']), edits: draftOutput.optional(), rationale: z.string().trim().max(2000).optional() });
const useBody = z.object({ recordType: z.string().max(60), recordId: uuid });
const artifactList = listQuery(['createdAt'], {
  artifactType: z.enum(ARTIFACT_TYPES).optional(),
  decision: z.enum(['pending', 'accepted', 'edited_and_accepted', 'rejected']).optional(),
  recordId: uuid.optional(),
  mine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

@ApiTags('ai-assistant')
@Controller('ai')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('status')
  @RequirePermission('assistant.use')
  status() {
    return this.assistant.status();
  }

  @Post('drafts')
  @Idempotent('ai.drafts.generate')
  @RequirePermission('assistant.use')
  @RateLimit('expensive')
  @ApiZodBody(generateBody)
  generate(@Body(zod(generateBody)) b: z.infer<typeof generateBody>) {
    return this.assistant.generate(b);
  }

  @Get('drafts')
  @RequirePermission('assistant.use')
  @ApiZodQuery(artifactList)
  list(@Query(zod(artifactList)) q: z.infer<typeof artifactList>) {
    return this.assistant.list(q);
  }

  @Get('drafts/:id')
  @RequirePermission('assistant.use')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.assistant.get(id);
  }

  @Post('drafts/:id/review')
  @HttpCode(200)
  @RequirePermission('assistant.review')
  @ApiZodBody(reviewBody)
  review(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reviewBody)) b: z.infer<typeof reviewBody>) {
    return this.assistant.review(id, b);
  }

  @Post('drafts/:id/use')
  @HttpCode(200)
  @RequirePermission('assistant.use')
  @ApiZodBody(useBody)
  use(@Param('id', ParseUUIDPipe) id: string, @Body(zod(useBody)) b: z.infer<typeof useBody>) {
    return this.assistant.markUsed(id, b);
  }
}
