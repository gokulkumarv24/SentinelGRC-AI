import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions/catalog.js';

export const PUBLIC_KEY = 'sg:public';
export const PERMISSION_KEY = 'sg:permission';
export const AUTH_ONLY_KEY = 'sg:auth-only';
export const PLATFORM_ADMIN_KEY = 'sg:platform-admin';
export const CSRF_EXEMPT_KEY = 'sg:csrf-exempt';
export const RATE_LIMIT_KEY = 'sg:rate-limit';

/** Route needs no session (login, health, vendor portal token routes). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Route requires this permission in the active organization. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

/** Route needs a valid session but no organization permission (e.g. /users/me, logout). */
export const AuthenticatedOnly = () => SetMetadata(AUTH_ONLY_KEY, true);

/** Route needs the platform super-admin flag (organization management). */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

/** Route is a public, non-cookie flow (vendor portal token) where CSRF does not apply. */
export const CsrfExempt = () => SetMetadata(CSRF_EXEMPT_KEY, true);

/** Rate-limit bucket for sensitive or costly endpoints. */
export const RateLimit = (bucket: 'login' | 'expensive') => SetMetadata(RATE_LIMIT_KEY, bucket);

export const IDEMPOTENT_KEY = 'sg:idempotent';
/**
 * Create/trigger route that honours an optional `Idempotency-Key` header (spec §13.2): a retry with
 * the same key and body replays the first response instead of acting twice.
 */
export const Idempotent = (scope: string) => SetMetadata(IDEMPOTENT_KEY, scope);
