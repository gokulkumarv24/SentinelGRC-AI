import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission } from '../permissions/catalog.js';
import { AppError } from './errors.js';

export interface ContextUser {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

export interface ContextMembership {
  id: string;
  organizationId: string;
  organizationName: string;
  roleKeys: string[];
  permissions: Set<Permission>;
}

/** Per-request (or per-job) security context. Services read tenant scope only from here. */
export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  actorType: 'user' | 'system' | 'vendor_respondent';
  user?: ContextUser;
  sessionId?: string;
  membership?: ContextMembership;
  /** For vendor-portal requests: the single assessment the respondent may touch. */
  vendorPortal?: { invitationId: string; organizationId: string; vendorId: string; assessmentId: string };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('No request context — call runWithContext() first');
  return ctx;
}

export function maybeContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Organization id of the authenticated membership. Throws 401 if absent (deny by default). */
export function requireOrgId(): string {
  const ctx = currentContext();
  if (ctx.membership) return ctx.membership.organizationId;
  // Worker jobs always run with an explicit organization scope; a missing one is a bug, not a user error.
  if (ctx.actorType === 'system') throw new Error('System context without organization scope');
  throw new AppError(401, 'unauthenticated', 'Authentication required');
}

export function requireUserId(): string {
  const ctx = currentContext();
  if (!ctx.user) throw new AppError(401, 'unauthenticated', 'Authentication required');
  return ctx.user.id;
}

/** Actor id for created_by/updated_by columns; null for system jobs. */
export function actorId(): string | null {
  return maybeContext()?.user?.id ?? null;
}

export function hasPermission(permission: Permission): boolean {
  return currentContext().membership?.permissions.has(permission) ?? false;
}

export function assertPermission(permission: Permission): void {
  if (!hasPermission(permission)) {
    throw new AppError(403, 'forbidden', 'You do not have permission to perform this action', { permission });
  }
}
