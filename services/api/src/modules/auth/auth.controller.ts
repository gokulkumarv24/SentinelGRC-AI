import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { csrfCookieName, csrfCookieOptions, sessionCookieName, sessionCookieOptions } from '../../common/cookies.js';
import { AuthenticatedOnly, Public, RateLimit } from '../../common/decorators.js';
import { ApiZodBody, requiredText, uuid, zod } from '../../common/validation.js';
import { AuthService } from './auth.service.js';
import { passwordPolicy } from './password.service.js';

const loginSchema = z.object({ email: z.email().max(320), password: z.string().min(1).max(200) });
const switchSchema = z.object({ organizationId: uuid });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordPolicy });
const acceptSchema = z.object({ displayName: requiredText(120), password: passwordPolicy });

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/login')
  @Public()
  @RateLimit('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@Body(zod(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const { token, csrfToken, maxAgeMs } = await this.auth.login(body.email, body.password);
    res.cookie(sessionCookieName(), token, sessionCookieOptions(maxAgeMs));
    res.cookie(csrfCookieName(), csrfToken, csrfCookieOptions(maxAgeMs));
    return { ok: true };
  }

  @Post('auth/logout')
  @AuthenticatedOnly()
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) res: Response) {
    await this.auth.logout();
    res.clearCookie(sessionCookieName(), { path: '/' });
    res.clearCookie(csrfCookieName(), { path: '/' });
    return { ok: true };
  }

  @Get('users/me')
  @AuthenticatedOnly()
  me() {
    return this.auth.me();
  }

  @Post('auth/switch-organization')
  @AuthenticatedOnly()
  @HttpCode(200)
  @ApiZodBody(switchSchema)
  async switchOrganization(@Body(zod(switchSchema)) body: z.infer<typeof switchSchema>) {
    await this.auth.switchOrganization(body.organizationId);
    return { ok: true };
  }

  @Post('auth/change-password')
  @AuthenticatedOnly()
  @RateLimit('login')
  @HttpCode(200)
  @ApiZodBody(changePasswordSchema)
  async changePassword(@Body(zod(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @Get('invitations/:token')
  @Public()
  @RateLimit('login')
  invitation(@Param('token') token: string) {
    return this.auth.invitationPreview(token);
  }

  @Post('invitations/:token/accept')
  @Public()
  @RateLimit('login')
  @HttpCode(200)
  @ApiZodBody(acceptSchema)
  accept(@Param('token') token: string, @Body(zod(acceptSchema)) body: z.infer<typeof acceptSchema>) {
    return this.auth.acceptInvitation(token, body.displayName, body.password);
  }
}
