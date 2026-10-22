import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Idempotent, RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, isoDate, requiredText, text, zod } from '../../common/validation.js';
import { contentDisposition } from '../evidence/file-inspection.js';
import { TrustService } from './trust.service.js';

const createBody = z
  .object({
    title: requiredText(200),
    customerName: requiredText(200),
    dueDate: isoDate.nullable().optional(),
    notes: text(2000).nullable().optional(),
    questions: z.array(z.object({ section: text(200).nullable().optional(), questionText: requiredText(2000) })).max(500).optional(),
    /** Pasted questions: one per line ("Section | Question" allowed) or CSV with a "question" column. */
    text: z.string().max(400_000).optional(),
  })
  .refine((b) => b.questions?.length || b.text?.trim(), { message: 'Add questions or paste them as text', path: ['text'] });
const itemBody = z.object({
  action: z.enum(['save', 'approve', 'reopen']),
  finalAnswer: text(4000).nullable().optional(),
  shortAnswer: z.enum(['yes', 'no', 'partial', 'not_applicable', 'unknown']).nullable().optional(),
});
const listSchema = listQuery(['createdAt', 'updatedAt', 'dueDate', 'customerName'], { status: multi(['draft', 'answering', 'in_review', 'completed']) }, 'createdAt');
const librarySchema = listQuery(['updatedAt', 'usageCount', 'createdAt'], {}, 'updatedAt');

/** Trust desk: customer security questionnaires answered with the AI agent and the approved-answer library. */
@ApiTags('trust')
@Controller('trust')
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @Get('questionnaires')
  @RequirePermission('trust.read')
  @ApiZodQuery(listSchema)
  list(@Query(zod(listSchema)) q: z.infer<typeof listSchema>) {
    return this.trust.list(q);
  }

  @Post('questionnaires')
  @Idempotent('trust.questionnaires.create')
  @RequirePermission('trust.manage')
  @ApiZodBody(createBody)
  create(@Body(zod(createBody)) b: z.infer<typeof createBody>) {
    return this.trust.create(b);
  }

  @Get('questionnaires/:id')
  @RequirePermission('trust.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.trust.get(id);
  }

  @Post('questionnaires/:id/reanswer')
  @HttpCode(202)
  @RequirePermission('trust.manage')
  reanswer(@Param('id', ParseUUIDPipe) id: string) {
    return this.trust.reanswer(id);
  }

  @Post('questionnaires/:id/approve-drafted')
  @HttpCode(200)
  @RequirePermission('trust.manage')
  approveDrafted(@Param('id', ParseUUIDPipe) id: string) {
    return this.trust.approveDrafted(id);
  }

  @Patch('questionnaires/:id/items/:itemId')
  @RequirePermission('trust.manage')
  @ApiZodBody(itemBody)
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(zod(itemBody)) b: z.infer<typeof itemBody>) {
    return this.trust.updateItem(id, itemId, b);
  }

  @Get('questionnaires/:id/export.csv')
  @RequirePermission('trust.read')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async export(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.trust.exportCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition('attachment', file.filename));
    return new StreamableFile(Buffer.from(file.body, 'utf8'));
  }

  @Get('answers')
  @RequirePermission('trust.read')
  @ApiZodQuery(librarySchema)
  library(@Query(zod(librarySchema)) q: z.infer<typeof librarySchema>) {
    return this.trust.libraryList(q);
  }

  @Delete('answers/:id')
  @HttpCode(204)
  @RequirePermission('trust.manage')
  retire(@Param('id', ParseUUIDPipe) id: string) {
    return this.trust.retireLibraryAnswer(id);
  }
}
