import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Liveness/readiness without leaking versions, hosts, env or stack traces (spec §24). */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @Public()
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @HttpCode(200)
  async ready(@Res({ passthrough: true }) res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', checks: { database: 'ok' } };
    } catch {
      res.status(503);
      return { status: 'not_ready', checks: { database: 'unavailable' } };
    }
  }
}
