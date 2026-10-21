import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { listQuery } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, zod } from '../../common/validation.js';
import { NOTIFICATION_EVENT_TYPES, NotificationsService } from './notifications.service.js';

const listSchema = listQuery(['createdAt'], { unreadOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
const prefBody = z.object({ eventType: z.enum(NOTIFICATION_EVENT_TYPES), inApp: z.boolean(), email: z.boolean() });

/** Every member can see their own notifications; dashboard.read is held by all roles. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('dashboard.read')
  @ApiZodQuery(listSchema)
  list(@Query(zod(listSchema)) query: z.infer<typeof listSchema>) {
    return this.notifications.listMine(query);
  }

  @Post(':id/read')
  @RequirePermission('dashboard.read')
  @HttpCode(204)
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  @RequirePermission('dashboard.read')
  @HttpCode(200)
  readAll() {
    return this.notifications.markAllRead();
  }

  @Get('preferences')
  @RequirePermission('dashboard.read')
  preferences() {
    return this.notifications.preferences();
  }

  @Put('preferences')
  @RequirePermission('dashboard.read')
  @ApiZodBody(prefBody)
  setPreference(@Body(zod(prefBody)) body: z.infer<typeof prefBody>) {
    return this.notifications.setPreference(body.eventType, body.inApp, body.email);
  }
}
