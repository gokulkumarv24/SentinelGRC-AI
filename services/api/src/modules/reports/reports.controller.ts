import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { RateLimit, RequirePermission } from '../../common/decorators.js';
import { contentDisposition } from '../evidence/file-inspection.js';
import { listQuery } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, isoDate, uuid, zod } from '../../common/validation.js';
import { ReportsService } from './reports.service.js';

const filters = z
  .object({
    from: isoDate.transform((d) => d.toISOString()).optional(),
    to: isoDate.transform((d) => d.toISOString()).optional(),
    frameworkId: uuid.optional(),
    vendorId: uuid.optional(),
    assessmentId: uuid.optional(),
    aiSystemId: uuid.optional(),
  })
  .strict()
  .default({});
const FORMATS = ['pdf', 'csv', 'xlsx'] as const;
const requestBody = z.object({
  reportType: z.string().max(60),
  format: z.enum(FORMATS),
  reportStatus: z.enum(['draft', 'final']).default('draft'),
  filters,
  title: z.string().trim().max(200).optional(),
});
const reportList = listQuery(['createdAt'], { reportType: z.string().max(60).optional(), status: z.enum(['queued', 'generating', 'ready', 'failed', 'expired']).optional() });
const scheduleBody = z.object({
  reportType: z.string().max(60),
  format: z.enum(FORMATS),
  filters,
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  recipientUserIds: z.array(uuid).min(1).max(50),
});
const scheduleUpdate = z.object({ enabled: z.boolean().optional(), frequency: z.enum(['daily', 'weekly', 'monthly']).optional(), recipientUserIds: z.array(uuid).min(1).max(50).optional() });

@ApiTags('reports')
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/types')
  @RequirePermission('report.read')
  types() {
    return this.reports.types();
  }

  @Get('reports')
  @RequirePermission('report.read')
  @ApiZodQuery(reportList)
  list(@Query(zod(reportList)) q: z.infer<typeof reportList>) {
    return this.reports.list(q);
  }

  @Post('reports')
  @HttpCode(202)
  @RequirePermission('report.generate')
  @RateLimit('expensive')
  @ApiZodBody(requestBody)
  request(@Body(zod(requestBody)) b: z.infer<typeof requestBody>) {
    return this.reports.request(b);
  }

  @Get('reports/schedules')
  @RequirePermission('report.read')
  schedules() {
    return this.reports.listSchedules();
  }

  @Post('report-schedules')
  @RequirePermission('report.schedule')
  @ApiZodBody(scheduleBody)
  createSchedule(@Body(zod(scheduleBody)) b: z.infer<typeof scheduleBody>) {
    return this.reports.createSchedule(b);
  }

  @Patch('report-schedules/:id')
  @RequirePermission('report.schedule')
  @ApiZodBody(scheduleUpdate)
  updateSchedule(@Param('id', ParseUUIDPipe) id: string, @Body(zod(scheduleUpdate)) b: z.infer<typeof scheduleUpdate>) {
    return this.reports.updateSchedule(id, b);
  }

  @Delete('report-schedules/:id')
  @HttpCode(204)
  @RequirePermission('report.schedule')
  async deleteSchedule(@Param('id', ParseUUIDPipe) id: string) {
    await this.reports.deleteSchedule(id);
  }

  @Get('reports/:id')
  @RequirePermission('report.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id);
  }

  @Get('reports/:id/download')
  @RequirePermission('report.download')
  @RateLimit('expensive')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.reports.download(id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', contentDisposition('attachment', file.filename));
    return new StreamableFile(file.body);
  }
}
