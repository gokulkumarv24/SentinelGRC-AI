import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { loadEnv } from '../config/env.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import type { Permission } from '../permissions/catalog.js';
import { clearSessionCookies, CSRF_HEADER, csrfCookieName, readCookie, sessionCookieName } from './cookies.js';
import {
  AUTH_ONLY_KEY,
  CSRF_EXEMPT_KEY,
  PERMISSION_KEY,
  PLATFORM_ADMIN_KEY,
  PUBLIC_KEY,
  RATE_LIMIT_KEY,
} from './decorators.js';
import { AppError } from './errors.js';
import { limitFor, rateLimiter } from './rate-limiter.js';
import { currentContext } from './request-context.js';
import { safeEqual } from './crypto.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global guard, in this order: rate limit → session → CSRF/origin → permission.
 * Deny by default: a route must declare @Public, @AuthenticatedOnly, @PlatformAdmin or @RequirePermission.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
    const ctx = currentContext();

    // 1. Rate limiting (per IP for anonymous buckets, per user afterwards)
    const bucket = meta<'login' | 'expensive'>(RATE_LIMIT_KEY) ?? 'default';
    this.applyRateLimit(`${bucket}:ip:${req.ip}`, bucket);

    const mutating = MUTATING.has(req.method);
    if (mutating && !meta<boolean>(CSRF_EXEMPT_KEY)) this.checkOrigin(req);

    if (meta<boolean>(PUBLIC_KEY)) return true;

    // 2. Session
    const token = readCookie(req, sessionCookieName());
    const resolved = token ? await this.sessions.resolve(token) : null;
    if (!resolved) {
      // A stale cookie would make the web app believe the user is still signed in (redirect loop), so drop it.
      if (token) clearSessionCookies(context.switchToHttp().getResponse<Response>());
      throw new AppError(401, 'unauthenticated', token ? 'Your session has expired. Please sign in again.' : 'Please sign in to continue.');
    }
    ctx.user = resolved.user;
    ctx.sessionId = resolved.sessionId;
    ctx.membership = resolved.membership;
    if (bucket === 'expensive') this.applyRateLimit(`expensive:user:${resolved.user.id}`, 'expensive');

    // 3. CSRF (double submit: header must match the session's CSRF token)
    if (mutating && !meta<boolean>(CSRF_EXEMPT_KEY)) {
      const header = req.header(CSRF_HEADER);
      const cookie = readCookie(req, csrfCookieName());
      const valid = !!header && !!cookie && safeEqual(header, cookie) && (await this.sessions.verifyCsrf(resolved.sessionId, header));
      if (!valid) throw new AppError(403, 'csrf_failed', 'Security token missing or invalid. Reload the page and try again.');
    }

    // 4. Authorization
    if (meta<boolean>(AUTH_ONLY_KEY)) return true;
    if (meta<boolean>(PLATFORM_ADMIN_KEY)) {
      if (resolved.user.isPlatformAdmin) return true;
      return await this.deny(req, 'platform_admin');
    }
    const permission = meta<Permission>(PERMISSION_KEY);
    if (!permission) return await this.deny(req, 'route_without_permission');
    if (!resolved.membership) throw new AppError(403, 'no_organization', 'Select an organization to continue.');
    if (resolved.user.mustChangePassword) {
      throw new AppError(403, 'password_change_required', 'You must change your password before continuing.');
    }
    if (!resolved.membership.permissions.has(permission)) return await this.deny(req, permission);
    return true;
  }

  private applyRateLimit(key: string, bucket: 'login' | 'expensive' | 'default'): void {
    const retryAfter = rateLimiter.hit(key, limitFor(bucket));
    if (retryAfter !== null) {
      throw new AppError(429, 'rate_limited', 'Too many requests. Please wait and try again.', { retryAfterSeconds: retryAfter });
    }
  }

  /** Rejects cross-site state changes even before cookies are considered. */
  private checkOrigin(req: Request): void {
    const origin = req.header('origin');
    if (!origin) return; // non-browser clients; CSRF token still required for cookie sessions
    const env = loadEnv();
    const allowed = new Set([new URL(env.PUBLIC_APP_URL).origin, ...env.CORS_ORIGINS]);
    if (!allowed.has(origin)) throw new AppError(403, 'origin_not_allowed', 'Request origin is not allowed');
  }

  /** Records the denial before responding, so the audit trail never lags the response. */
  private async deny(req: Request, required: string): Promise<never> {
    await this.audit.recordQuietlyAwait({
      action: 'authz.denied',
      entityType: 'route',
      entityId: null,
      after: { method: req.method, route: req.route?.path ?? req.path, required },
      outcome: 'denied',
    });
    throw new AppError(403, 'forbidden', 'You do not have permission to perform this action');
  }
}
