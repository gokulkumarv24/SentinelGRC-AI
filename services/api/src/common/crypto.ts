import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../config/env.js';

/** 256-bit random token, URL safe. Only its hash is ever stored (spec §5.1 sessions/invitations). */
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256Hex = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** HMAC-signed, expiring token bound to a purpose and claims (used for short-lived download URLs). */
export function signToken(purpose: string, claims: Record<string, string | number>): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, p: purpose })).toString('base64url');
  const sig = createHmac('sha256', loadEnv().AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken<T extends Record<string, string | number>>(purpose: string, token: string): (T & { exp: number }) | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', loadEnv().AUTH_SECRET).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as T & { exp: number; p: string };
    if (claims.p !== purpose || typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}
