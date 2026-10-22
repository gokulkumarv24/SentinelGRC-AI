import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { RateLimit, RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, httpUrl, isoDate, requiredText, text, uuid, zod } from '../../common/validation.js';
import { loadEnv } from '../../config/env.js';
import { LINKABLE_TYPES } from '../shared/entity-resolver.service.js';
import { EvidenceService } from './evidence.service.js';
import { contentDisposition } from './file-inspection.js';

const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
const emptyToUndefined = (v: unknown) => (v === '' || v === 'null' ? undefined : v);

const metadata = z.object({
  title: requiredText(200),
  description: text(5000).nullable().optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  sourceUri: httpUrl(2000).nullable().optional(),
  collectedAt: z.preprocess(emptyToUndefined, isoDate.nullable().optional()),
  validFrom: z.preprocess(emptyToUndefined, isoDate.nullable().optional()),
  expiresAt: z.preprocess(emptyToUndefined, isoDate.nullable().optional()),
  ownerId: z.preprocess(emptyToUndefined, uuid.nullable().optional()),
});
const linkFields = z.object({
  linkEntityType: z.preprocess(emptyToUndefined, z.enum(LINKABLE_TYPES).optional()),
  linkEntityId: z.preprocess(emptyToUndefined, uuid.optional()),
  linkPurpose: z.preprocess(emptyToUndefined, text(200).optional()),
});
const uploadBody = metadata.extend(linkFields.shape);
const recordBody = metadata.extend(linkFields.shape);
const updateBody = metadata.partial();
const linkBody = z.object({ entityType: z.enum(LINKABLE_TYPES), entityId: uuid, purpose: text(200).optional(), relevanceNotes: text(2000).optional() });
const reviewBody = z.object({ decision: z.enum(['approved', 'rejected']), notes: text(5000).optional() });
const linkReviewBody = z.object({ reviewStatus: z.enum(['unreviewed', 'pending_review', 'approved', 'rejected']), notes: text(2000).optional() });
const archiveBody = z.object({ rationale: requiredText(2000) });
const downloadBody = z.object({ disposition: z.enum(['inline', 'attachment']).default('attachment') });
const listSchema = listQuery(['createdAt', 'updatedAt', 'expiresAt', 'title', 'collectedAt'], {
  reviewStatus: multi(['unreviewed', 'pending_review', 'approved', 'rejected']),
  classification: multi(CLASSIFICATIONS),
  state: z.enum(['expired', 'expiring', 'current', 'no_expiry']).optional(),
  entityType: z.enum(LINKABLE_TYPES).optional(),
  entityId: uuid.optional(),
  ownerId: uuid.optional(),
  includeArchived: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const link = (b: z.infer<typeof linkFields>) => (b.linkEntityType && b.linkEntityId ? { entityType: b.linkEntityType, entityId: b.linkEntityId, purpose: b.linkPurpose } : undefined);

@ApiTags('evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  @RequirePermission('evidence.read')
  @ApiZodQuery(listSchema)
  list(@Query(zod(listSchema)) query: z.infer<typeof listSchema>) {
    return this.evidence.list(query);
  }

  @Post()
  @RequirePermission('evidence.upload')
  @RateLimit('expensive')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: loadEnv().MAX_UPLOAD_SIZE_MB * 1024 * 1024, files: 1, fields: 20, fieldSize: 10_000 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @Body(zod(uploadBody)) body: z.infer<typeof uploadBody>) {
    const { linkEntityType: _a, linkEntityId: _b, linkPurpose: _c, ...meta } = body;
    return this.evidence.upload(file, meta, link(body));
  }

  @Post('records')
  @RequirePermission('evidence.upload')
  @ApiZodBody(recordBody)
  record(@Body(zod(recordBody)) body: z.infer<typeof recordBody>) {
    const { linkEntityType: _a, linkEntityId: _b, linkPurpose: _c, ...meta } = body;
    return this.evidence.createRecord(meta, link(body));
  }

  /** Streams a file for a valid, unexpired token presented by the same signed-in user. */
  @Get('download/:token')
  @RequirePermission('evidence.download')
  async download(@Param('token') token: string, @Res() res: Response) {
    const { object, filename, mediaType, disposition } = await this.evidence.openDownload(token);
    res.setHeader('Content-Type', mediaType.startsWith('text/') ? `${mediaType}; charset=utf-8` : mediaType);
    res.setHeader('Content-Disposition', contentDisposition(disposition, filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Browsers cannot render PDFs inside a CSP sandbox, so inline PDFs get a strict no-script policy instead.
    const pdfInline = disposition === 'inline' && mediaType === 'application/pdf';
    res.setHeader('Content-Security-Policy', pdfInline ? "default-src 'none'; frame-ancestors 'self'" : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    res.setHeader('Cache-Control', 'private, no-store');
    if (object.size) res.setHeader('Content-Length', String(object.size));
    object.stream.pipe(res);
  }

  @Get(':id')
  @RequirePermission('evidence.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.evidence.get(id);
  }

  @Patch(':id')
  @RequirePermission('evidence.update')
  @ApiZodBody(updateBody)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateBody)) body: z.infer<typeof updateBody>) {
    return this.evidence.update(id, body);
  }

  @Post(':id/review')
  @RequirePermission('evidence.review')
  @HttpCode(200)
  @ApiZodBody(reviewBody)
  review(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reviewBody)) body: z.infer<typeof reviewBody>) {
    return this.evidence.review(id, body.decision, body.notes);
  }

  @Post(':id/links')
  @RequirePermission('evidence.link')
  @ApiZodBody(linkBody)
  addLink(@Param('id', ParseUUIDPipe) id: string, @Body(zod(linkBody)) body: z.infer<typeof linkBody>) {
    return this.evidence.addLink(id, body);
  }

  @Delete(':id/links/:linkId')
  @RequirePermission('evidence.link')
  @HttpCode(204)
  removeLink(@Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.evidence.removeLink(id, linkId);
  }

  @Patch(':id/links/:linkId')
  @RequirePermission('evidence.review')
  @ApiZodBody(linkReviewBody)
  reviewLink(@Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string, @Body(zod(linkReviewBody)) body: z.infer<typeof linkReviewBody>) {
    return this.evidence.reviewLink(id, linkId, body.reviewStatus, body.notes);
  }

  @Post(':id/archive')
  @RequirePermission('evidence.archive')
  @HttpCode(204)
  @ApiZodBody(archiveBody)
  archive(@Param('id', ParseUUIDPipe) id: string, @Body(zod(archiveBody)) body: z.infer<typeof archiveBody>) {
    return this.evidence.archive(id, body.rationale);
  }

  @Post(':id/download-url')
  @RequirePermission('evidence.download')
  @HttpCode(200)
  @ApiZodBody(downloadBody)
  downloadUrl(@Param('id', ParseUUIDPipe) id: string, @Body(zod(downloadBody)) body: z.infer<typeof downloadBody>) {
    return this.evidence.downloadUrl(id, body.disposition);
  }
}
