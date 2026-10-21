import type { CookieOptions, Request, Response } from 'express';
import { loadEnv } from '../config/env.js';

/**
 * In production the `__Host-` prefix forces Secure, Path=/ and no Domain attribute,
 * so a sibling subdomain cannot plant or read these cookies.
 */
const secure = () => loadEnv().APP_ENV === 'production';
export const sessionCookieName = () => (secure() ? '__Host-sg_session' : 'sg_session');
export const csrfCookieName = () => (secure() ? '__Host-sg_csrf' : 'sg_csrf');
export const CSRF_HEADER = 'x-csrf-token';

export function sessionCookieOptions(maxAgeMs: number): CookieOptions {
  return { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: maxAgeMs };
}

/** Readable by the web app's JavaScript so it can echo it in the X-CSRF-Token header (double submit). */
export function csrfCookieOptions(maxAgeMs: number): CookieOptions {
  return { httpOnly: false, secure: secure(), sameSite: 'strict', path: '/', maxAge: maxAgeMs };
}

export function readCookie(req: Request, name: string): string | undefined {
  const value = (req.cookies as Record<string, string> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 && value.length < 512 ? value : undefined;
}

/**
 * Removes the session and CSRF cookies. The attributes must match how they were set:
 * browsers ignore a `__Host-` cookie deletion that lacks `Secure`.
 */
export function clearSessionCookies(res: Response): void {
  res.clearCookie(sessionCookieName(), { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/' });
  res.clearCookie(csrfCookieName(), { httpOnly: false, secure: secure(), sameSite: 'strict', path: '/' });
}
