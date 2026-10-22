import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { signToken, verifyToken } from '../../common/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, currentContext, requireOrgId, requireUserId } from '../../common/request-context.js';
import { loadEnv } from '../../config/env.js';
import type { EvidenceClassification, EvidenceSourceType, Prisma, ReviewStatus } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { API_PREFIX } from '../../bootstrap-app.js';
import { AuditService } from '../audit/audit.service.js';
import { EXPIRING_SOON_DAYS, evidenceState } from '../controls/controls.service.js';
import { EntityResolver, LINKABLE_TYPES } from '../shared/entity-resolver.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';
import { inspectFile, PREVIEWABLE } from './file-inspection.js';
import { StorageService, type StoredObject } from './storage.js';

export interface EvidenceMetadata {
  title: string;
  description?: string | null;
  classification?: EvidenceClassification;
  sourceType?: EvidenceSourceType;
  sourceUri?: string | null;
  collectedAt?: Date | null;
  validFrom?: Date | null;
  expiresAt?: Date | null;
  ownerId?: string | null;
}

export interface EvidenceListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q?: string;
  reviewStatus?: ReviewStatus[];
  classification?: EvidenceClassification[];
  state?: 'expired' | 'expiring' | 'current' | 'no_expiry';
  entityType?: string;
  entityId?: string;
  includeArchived?: boolean;
  ownerId?: string;
}

/** Hook for a malware scanner. Not enabled until one is configured (spec §8.4). */
export interface MalwareScanner {
  scan(buffer: Buffer): Promise<'clean' | 'infected'>;
}

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  scanner: MalwareScanner | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly entities: EntityResolver,
    private readonly events: EventQueue,
  ) {}

  async list(query: EvidenceListQuery) {
    const organizationId = requireOrgId();
    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000);
    const stateWhere: Prisma.EvidenceWhereInput =
      query.state === 'expired'
        ? { expiresAt: { lte: now } }
        : query.state === 'expiring'
          ? { expiresAt: { gt: now, lte: soon } }
          : query.state === 'current'
            ? { OR: [{ expiresAt: null }, { expiresAt: { gt: soon } }] }
            : query.state === 'no_expiry'
              ? { expiresAt: null }
              : {};
    const where: Prisma.EvidenceWhereInput = {
      organizationId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.reviewStatus ? { reviewStatus: { in: query.reviewStatus } } : {}),
      ...(query.classification ? { classification: { in: query.classification } } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.entityType && query.entityId ? { links: { some: { entityType: query.entityType, entityId: query.entityId } } } : {}),
      ...(query.q ? { AND: [{ OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }, { originalFilename: { contains: query.q, mode: 'insensitive' } }] }] } : {}),
      ...stateWhere,
    };
    const [items, total] = await Promise.all([
      this.prisma.evidence.findMany({
        where,
        ...pageArgs(query),
        include: { ownerRef: { select: { id: true, displayName: true } }, _count: { select: { links: true } } },
      }),
      this.prisma.evidence.count({ where }),
    ]);
    return toPage(items.map((e) => this.present(e, now)), total, query);
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const evidence = await this.prisma.evidence.findFirst({
      where: { id, organizationId },
      include: { ownerRef: { select: { id: true, displayName: true } }, uploadedByRef: { select: { id: true, displayName: true } }, links: { orderBy: { createdAt: 'desc' } } },
    });
    if (!evidence) throw notFound('Evidence');
    const links = await Promise.all(
      evidence.links.map(async (l) => ({ ...l, label: await this.entities.resolve(l.entityType, l.entityId).then((e) => e.label).catch(() => '(unavailable)') })),
    );
    const [history, accessLog] = await Promise.all([
      this.prisma.auditEvent.findMany({ where: { organizationId, entityType: 'evidence', entityId: id }, orderBy: { timestamp: 'desc' }, take: 50, include: { actorUserRef: { select: { displayName: true } } } }),
      this.prisma.evidenceAccessLog.findMany({ where: { organizationId, evidenceId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return { ...this.present(evidence, new Date()), uploadedBy: evidence.uploadedByRef, links, history, accessLog };
  }

  /** Stores a file with server-generated key, verified type and SHA-256 checksum. */
  async upload(file: { buffer: Buffer; originalname: string; size: number }, meta: EvidenceMetadata, link?: { entityType: string; entityId: string; purpose?: string }) {
    const organizationId = requireOrgId();
    const env = loadEnv();
    if (!file?.buffer?.length) throw badRequest('file_required', 'Choose a file to upload.');
    if (file.size > env.MAX_UPLOAD_SIZE_MB * 1024 * 1024) throw new AppError(413, 'file_too_large', `Files may be at most ${env.MAX_UPLOAD_SIZE_MB} MB.`);
    const { mediaType, safeName } = await inspectFile(file.buffer, file.originalname, env.ALLOWED_UPLOAD_MIME_TYPES);
    let scanStatus = 'not_scanned';
    if (this.scanner) {
      scanStatus = await this.scanner.scan(file.buffer);
      if (scanStatus === 'infected') throw badRequest('malware_detected', 'The file was rejected by the malware scanner.');
    }
    this.validateDates(meta);
    await this.entities.assertMember(meta.ownerId);
    if (link) await this.entities.resolve(link.entityType, link.entityId);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = `${organizationId}/evidence/${randomUUID()}`;
    await this.storage.adapter.put(storageKey, file.buffer, mediaType);
    try {
      return await this.prisma.tx(async (tx) => {
        const evidence = await tx.evidence.create({
          data: {
            organizationId,
            ...this.metaData(meta),
            sourceType: meta.sourceType ?? 'upload',
            storageKey,
            originalFilename: safeName,
            mediaType,
            sizeBytes: BigInt(file.size),
            sha256Checksum: sha256,
            scanStatus,
            uploadedBy: actorId(),
            ownerId: meta.ownerId ?? actorId(),
          },
        });
        await this.audit.record({ action: 'evidence.uploaded', entityType: 'evidence', entityId: evidence.id, after: { title: evidence.title, mediaType, sizeBytes: file.size, sha256, classification: evidence.classification } }, tx);
        if (link) await this.createLink(tx, evidence.id, link);
        await this.events.emit(tx, organizationId, 'evidence.uploaded', { evidenceId: evidence.id }, `evidence-uploaded:${evidence.id}`);
        return this.present(evidence, new Date());
      });
    } catch (error) {
      await this.storage.adapter.delete(storageKey).catch((e: unknown) => this.logger.warn({ err: e }, 'Failed to clean up orphaned upload'));
      throw error;
    }
  }

  /** Metadata-only evidence (e.g. a record that a review happened, or a missing-evidence placeholder). */
  async createRecord(meta: EvidenceMetadata, link?: { entityType: string; entityId: string; purpose?: string }) {
    const organizationId = requireOrgId();
    this.validateDates(meta);
    await this.entities.assertMember(meta.ownerId);
    return this.prisma.tx(async (tx) => {
      if (link) await this.entities.resolve(link.entityType, link.entityId, tx);
      const evidence = await tx.evidence.create({
        data: { organizationId, ...this.metaData(meta), sourceType: meta.sourceType ?? 'manual_record', uploadedBy: actorId(), ownerId: meta.ownerId ?? actorId() },
      });
      await this.audit.record({ action: 'evidence.recorded', entityType: 'evidence', entityId: evidence.id, after: { title: evidence.title } }, tx);
      if (link) await this.createLink(tx, evidence.id, link);
      return this.present(evidence, new Date());
    });
  }

  async update(id: string, meta: Partial<EvidenceMetadata>) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const evidence = await tx.evidence.findFirst({ where: { id, organizationId, archivedAt: null } });
      if (!evidence) throw notFound('Evidence');
      this.validateDates({ ...evidence, ...meta } as EvidenceMetadata);
      await this.entities.assertMember(meta.ownerId, tx);
      const data = this.metaData(meta as EvidenceMetadata, true);
      const updated = await tx.evidence.update({ where: { id }, data });
      await this.audit.record({ action: 'evidence.updated', entityType: 'evidence', entityId: id, before: Object.fromEntries(Object.keys(data).map((k) => [k, (evidence as Record<string, unknown>)[k]])), after: data }, tx);
      return this.present(updated, new Date());
    });
  }

  /** Approve or reject; rejection needs a reason (spec §8.4). */
  async review(id: string, decision: 'approved' | 'rejected', notes?: string) {
    const organizationId = requireOrgId();
    if (decision === 'rejected' && !notes?.trim()) throw badRequest('rationale_required', 'Explain why the evidence is rejected.');
    return this.prisma.tx(async (tx) => {
      const evidence = await tx.evidence.findFirst({ where: { id, organizationId, archivedAt: null } });
      if (!evidence) throw notFound('Evidence');
      const updated = await tx.evidence.update({
        where: { id },
        data: { reviewStatus: decision, reviewedBy: requireUserId(), reviewedAt: new Date(), reviewNotes: notes ?? null },
      });
      await this.audit.record({ action: `evidence.${decision}`, entityType: 'evidence', entityId: id, before: { reviewStatus: evidence.reviewStatus }, after: { reviewStatus: decision }, rationale: notes }, tx);
      return this.present(updated, new Date());
    });
  }

  async addLink(evidenceId: string, link: { entityType: string; entityId: string; purpose?: string; relevanceNotes?: string }) {
    return this.prisma.tx(async (tx) => {
      const evidence = await tx.evidence.findFirst({ where: { id: evidenceId, organizationId: requireOrgId(), archivedAt: null } });
      if (!evidence) throw notFound('Evidence');
      return this.createLink(tx, evidenceId, link);
    });
  }

  async removeLink(evidenceId: string, linkId: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const link = await tx.evidenceLink.findFirst({ where: { id: linkId, evidenceId, organizationId } });
      if (!link) throw notFound('Evidence link');
      if (link.purpose === 'closure' || link.purpose === 'completion') {
        throw conflict('Evidence that supports a closed finding or completed task cannot be unlinked.');
      }
      await tx.evidenceLink.delete({ where: { id: linkId } });
      await this.audit.record({ action: 'evidence.unlinked', entityType: 'evidence', entityId: evidenceId, before: { entityType: link.entityType, entityId: link.entityId } }, tx);
    });
  }

  async reviewLink(evidenceId: string, linkId: string, reviewStatus: ReviewStatus, notes?: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const link = await tx.evidenceLink.findFirst({ where: { id: linkId, evidenceId, organizationId } });
      if (!link) throw notFound('Evidence link');
      const updated = await tx.evidenceLink.update({ where: { id: linkId }, data: { reviewStatus, relevanceNotes: notes ?? link.relevanceNotes } });
      await this.audit.record({ action: 'evidence.link_reviewed', entityType: 'evidence', entityId: evidenceId, after: { linkId, reviewStatus }, rationale: notes }, tx);
      return updated;
    });
  }

  async archive(id: string, rationale: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const evidence = await tx.evidence.findFirst({ where: { id, organizationId, archivedAt: null } });
      if (!evidence) throw notFound('Evidence');
      await tx.evidence.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.record({ action: 'evidence.archived', entityType: 'evidence', entityId: id, rationale }, tx);
    });
  }

  /**
   * Issues a short-lived download URL bound to this user, organization and evidence (spec §8.4, §20.3).
   * Local storage, and inline previews on any backend: an API URL with an HMAC token that also requires the
   * same session user. It is same-origin, so the web app's CSP can frame/load it without allowing the bucket host.
   * S3 attachments: a presigned object URL with the same short expiry.
   */
  async downloadUrl(id: string, disposition: 'inline' | 'attachment' = 'attachment') {
    const organizationId = requireOrgId();
    const evidence = await this.prisma.evidence.findFirst({ where: { id, organizationId } });
    if (!evidence) throw notFound('Evidence');
    if (!evidence.storageKey) throw badRequest('no_file', 'This evidence record has no file.');
    const ttl = loadEnv().DOWNLOAD_URL_TTL_SECONDS;
    const mode = disposition === 'inline' && PREVIEWABLE.has(evidence.mediaType ?? '') ? 'inline' : 'attachment';
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.logAccess(evidence.id, 'download_url_issued');
    await this.audit.record({ action: 'evidence.download_url_issued', entityType: 'evidence', entityId: id, after: { disposition: mode, classification: evidence.classification } });
    if (this.storage.adapter.presignedUrl && mode === 'attachment') {
      return { url: await this.storage.adapter.presignedUrl(evidence.storageKey, ttl, evidence.originalFilename ?? 'evidence', mode), expiresAt, disposition: mode };
    }
    const token = signToken('evidence-download', { e: evidence.id, o: organizationId, u: requireUserId(), d: mode === 'inline' ? 1 : 0, exp: Math.floor(expiresAt.getTime() / 1000) });
    return { url: `/${API_PREFIX}/evidence/download/${token}`, expiresAt, disposition: mode };
  }

  /** Validates a download token against the current session; returns the stream and headers. */
  async openDownload(token: string): Promise<{ object: StoredObject; filename: string; mediaType: string; disposition: 'inline' | 'attachment' }> {
    const claims = verifyToken<{ e: string; o: string; u: string; d: number }>('evidence-download', token);
    const ctx = currentContext();
    // The token alone is not enough: it must be presented by the same signed-in user in the same organization.
    if (!claims || claims.u !== ctx.user?.id || claims.o !== ctx.membership?.organizationId) {
      throw new AppError(403, 'download_link_invalid', 'This download link is invalid or has expired.');
    }
    const evidence = await this.prisma.evidence.findFirst({ where: { id: claims.e, organizationId: claims.o } });
    if (!evidence?.storageKey) throw notFound('Evidence');
    const object = await this.storage.adapter.get(evidence.storageKey);
    await this.logAccess(evidence.id, 'downloaded');
    await this.audit.record({ action: 'evidence.downloaded', entityType: 'evidence', entityId: evidence.id });
    return { object, filename: evidence.originalFilename ?? 'evidence', mediaType: evidence.mediaType ?? 'application/octet-stream', disposition: claims.d ? 'inline' : 'attachment' };
  }

  private async createLink(tx: Tx, evidenceId: string, link: { entityType: string; entityId: string; purpose?: string; relevanceNotes?: string }) {
    if (!LINKABLE_TYPES.includes(link.entityType as never) || link.entityType === 'evidence') throw badRequest('invalid_entity_type', 'Evidence cannot be linked to this kind of record.');
    const target = await this.entities.resolve(link.entityType, link.entityId, tx);
    const existing = await tx.evidenceLink.findUnique({ where: { evidenceId_entityType_entityId: { evidenceId, entityType: link.entityType, entityId: link.entityId } } });
    if (existing) throw conflict('This evidence is already linked to that record.');
    const created = await tx.evidenceLink.create({
      data: { organizationId: requireOrgId(), evidenceId, entityType: link.entityType, entityId: link.entityId, purpose: link.purpose, relevanceNotes: link.relevanceNotes, linkedBy: actorId() },
    });
    await this.audit.record({ action: 'evidence.linked', entityType: 'evidence', entityId: evidenceId, after: { entityType: link.entityType, entityId: link.entityId, label: target.label } }, tx);
    return created;
  }

  private async logAccess(evidenceId: string, action: string) {
    const ctx = currentContext();
    await this.prisma.evidenceAccessLog.create({
      data: { organizationId: requireOrgId(), evidenceId, userId: ctx.user?.id, action, requestId: ctx.requestId },
    });
  }

  private validateDates(meta: { validFrom?: Date | null; expiresAt?: Date | null; collectedAt?: Date | null }) {
    if (meta.validFrom && meta.expiresAt && meta.expiresAt <= meta.validFrom) throw badRequest('invalid_dates', 'Expiry must be after the validity start date.');
    if (meta.collectedAt && meta.collectedAt.getTime() > Date.now() + 86_400_000) throw badRequest('invalid_dates', 'Collection date cannot be in the future.');
  }

  private metaData(meta: Partial<EvidenceMetadata>, partial = false) {
    const data = {
      title: meta.title,
      description: meta.description,
      classification: meta.classification,
      sourceUri: meta.sourceUri,
      collectedAt: meta.collectedAt,
      validFrom: meta.validFrom,
      expiresAt: meta.expiresAt,
      ownerId: meta.ownerId,
    };
    const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (!partial && !cleaned.title) throw badRequest('title_required', 'Title is required.');
    return cleaned as unknown as { title: string } & Partial<Omit<Prisma.EvidenceUncheckedCreateInput, 'organizationId' | 'title'>>;
  }

  private present<T extends { sizeBytes: bigint | null; storageKey: string | null; expiresAt: Date | null; reviewStatus: string; ownerRef?: unknown }>(e: T, now: Date) {
    const { storageKey, ownerRef, ...rest } = e;
    return {
      ...rest,
      sizeBytes: e.sizeBytes === null ? null : Number(e.sizeBytes),
      hasFile: !!storageKey,
      owner: ownerRef,
      state: e.expiresAt ? evidenceState(e.expiresAt, e.reviewStatus, now) : e.reviewStatus === 'rejected' ? 'missing' : 'no_expiry',
    };
  }
}
