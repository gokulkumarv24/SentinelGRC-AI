import { Injectable } from '@nestjs/common';
import { badRequest, conflict, invalidTransition, notFound, versionConflict } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, hasPermission, requireOrgId } from '../../common/request-context.js';
import type { AccessLevel, Criticality, EvidenceClassification, Prisma, Severity, VendorStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ScoringPolicyService } from '../risks/scoring-policy.service.js';
import { EntityResolver } from '../shared/entity-resolver.service.js';
import { inherentVendorRisk } from './vendor-scoring.js';

export interface VendorInput {
  name: string;
  legalName?: string | null;
  externalReference?: string | null;
  serviceDescription: string;
  website?: string | null;
  businessOwnerId?: string | null;
  criticality: Criticality;
  dataClassification: EvidenceClassification;
  dataTypes: string[];
  personalDataAccess: boolean;
  accessLevel: AccessLevel;
  businessDependency: number;
  serviceImpact: number;
  regions: string[];
  dependencies?: string | null;
  notes?: string | null;
  reassessmentFrequencyDays?: number;
}

/** Manual lifecycle moves. Approval/rejection happen only through an assessment decision (spec §9.1). */
const LIFECYCLE: Record<VendorStatus, VendorStatus[]> = {
  draft: ['onboarding', 'archived'],
  onboarding: ['assessment_required', 'draft', 'archived'],
  assessment_required: ['under_review', 'onboarding', 'archived'],
  under_review: ['assessment_required'],
  approved: ['active', 'assessment_required', 'offboarding'],
  approved_with_conditions: ['active', 'assessment_required', 'offboarding'],
  rejected: ['assessment_required', 'archived'],
  active: ['assessment_required', 'offboarding'],
  offboarding: ['archived', 'active'],
  archived: [],
};

/** Changes that are "material" and trigger a reassessment (spec §9.4). */
const MATERIAL = ['criticality', 'dataClassification', 'personalDataAccess', 'accessLevel', 'dataTypes', 'regions'] as const;

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntityResolver,
    private readonly policies: ScoringPolicyService,
  ) {}

  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; q?: string; status?: VendorStatus[]; criticality?: Criticality[]; tier?: string[]; reassessmentDue?: boolean }) {
    const now = new Date();
    const where: Prisma.VendorWhereInput = {
      organizationId: requireOrgId(),
      ...(query.status ? { status: { in: query.status } } : { status: { not: 'archived' } }),
      ...(query.criticality ? { criticality: { in: query.criticality } } : {}),
      ...(query.tier ? { OR: query.tier.map((t) => (t === 'not_assessed' ? { riskTier: null } : { riskTier: t as Severity })) } : {}),
      ...(query.reassessmentDue ? { nextAssessmentAt: { lte: new Date(now.getTime() + 30 * 86_400_000) } } : {}),
      ...(query.q ? { AND: [{ OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { legalName: { contains: query.q, mode: 'insensitive' } }, { serviceDescription: { contains: query.q, mode: 'insensitive' } }] }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.vendor.findMany({ where, ...pageArgs(query), include: { businessOwnerRef: { select: { id: true, displayName: true } }, _count: { select: { assessments: true } } } }),
      this.prisma.vendor.count({ where }),
    ]);
    return toPage(items.map(({ businessOwnerRef, ...v }) => ({ ...v, businessOwner: businessOwnerRef })), total, query);
  }

  async get(id: string) {
    const organizationId = requireOrgId();
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, organizationId },
      include: {
        businessOwnerRef: { select: { id: true, displayName: true, email: true } },
        assessments: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, assessmentVersion: true, score: true, inherentRisk: true, residualRisk: true, riskTier: true, decision: true, dueDate: true, submittedAt: true, decidedAt: true, reportStatus: true, createdAt: true } },
        riskHistory: { orderBy: { recordedAt: 'asc' } },
      },
    });
    if (!vendor) throw notFound('Vendor');
    const assessmentIds = vendor.assessments.map((a) => a.id);
    const [contacts, risks, findings, aiSystems, evidence] = await Promise.all([
      hasPermission('vendor.contacts.read') ? this.prisma.vendorContact.findMany({ where: { organizationId, vendorId: id }, orderBy: { name: 'asc' } }) : Promise.resolve(null),
      this.prisma.riskLink.findMany({ where: { organizationId, entityType: 'vendor', entityId: id }, include: { risk: { select: { id: true, riskKey: true, title: true, inherentRating: true, residualRating: true, status: true } } } }),
      this.prisma.finding.findMany({ where: { organizationId, sourceType: 'vendor_assessment', sourceId: { in: assessmentIds } }, select: { id: true, findingKey: true, title: true, severity: true, status: true, dueDate: true } }),
      this.prisma.aiSystem.findMany({ where: { organizationId, providerVendorId: id }, select: { id: true, name: true, lifecycleStatus: true, riskTier: true } }),
      this.prisma.evidenceLink.findMany({ where: { organizationId, entityType: 'vendor', entityId: id }, include: { evidence: { select: { id: true, title: true, expiresAt: true, reviewStatus: true } } } }),
    ]);
    const { policy } = await this.policies.activeVendor(undefined, organizationId);
    const { businessOwnerRef, ...rest } = vendor;
    return {
      ...rest,
      businessOwner: businessOwnerRef,
      contacts, // null when the member lacks vendor.contacts.read (spec §9.1 restricted contacts)
      inherent: inherentVendorRisk(vendor, policy),
      risks: risks.map((r) => r.risk),
      findings,
      aiSystems,
      evidence: evidence.map((e) => ({ linkId: e.id, ...e.evidence })),
      allowedTransitions: LIFECYCLE[vendor.status],
    };
  }

  async create(input: VendorInput) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      await this.entities.assertMember(input.businessOwnerId, tx);
      if (await tx.vendor.findFirst({ where: { organizationId, name: { equals: input.name, mode: 'insensitive' } } })) throw conflict('A vendor with this name already exists.');
      const { policy, version: policyVersion } = await this.policies.activeVendor(tx, organizationId);
      const inherent = inherentVendorRisk(input, policy);
      const vendor = await tx.vendor.create({
        data: { organizationId, ...input, status: 'draft', inherentRiskScore: inherent.score, createdBy: actorId() },
      });
      await tx.vendorRiskHistory.create({ data: { organizationId, vendorId: vendor.id, inherentScore: inherent.score, policyVersion } });
      await this.audit.record({ action: 'vendor.created', entityType: 'vendor', entityId: vendor.id, after: { name: vendor.name, criticality: vendor.criticality, inherentRiskScore: inherent.score } }, tx);
      return vendor;
    });
  }

  async update(id: string, version: number, input: Partial<VendorInput>, rationale?: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const vendor = await tx.vendor.findFirst({ where: { id, organizationId } });
      if (!vendor) throw notFound('Vendor');
      if (vendor.version !== version) throw versionConflict();
      await this.entities.assertMember(input.businessOwnerId, tx);
      const merged = { ...vendor, ...input };
      const { policy, version: policyVersion } = await this.policies.activeVendor(tx, organizationId);
      const inherent = inherentVendorRisk(merged, policy);
      const material = MATERIAL.filter((k) => k in input && JSON.stringify((input as Record<string, unknown>)[k]) !== JSON.stringify(vendor[k]));
      const reassess = material.length > 0 && ['approved', 'approved_with_conditions', 'active'].includes(vendor.status);
      const updated = await tx.vendor.update({
        where: { id },
        data: {
          ...input,
          inherentRiskScore: inherent.score,
          version: { increment: 1 },
          ...(reassess ? { status: 'assessment_required', nextAssessmentAt: new Date() } : {}),
        },
      });
      if (inherent.score !== vendor.inherentRiskScore) {
        await tx.vendorRiskHistory.create({ data: { organizationId, vendorId: id, inherentScore: inherent.score, residualScore: vendor.residualRiskScore, tier: vendor.riskTier, policyVersion } });
      }
      const changed = Object.keys(input).filter((k) => JSON.stringify((input as Record<string, unknown>)[k]) !== JSON.stringify((vendor as Record<string, unknown>)[k]));
      await this.audit.record(
        {
          action: reassess ? 'vendor.material_change' : 'vendor.updated',
          entityType: 'vendor',
          entityId: id,
          before: Object.fromEntries(changed.map((k) => [k, (vendor as Record<string, unknown>)[k]])),
          after: { ...Object.fromEntries(changed.map((k) => [k, (input as Record<string, unknown>)[k]])), ...(reassess ? { status: 'assessment_required', reason: `Material change: ${material.join(', ')}` } : {}) },
          rationale,
        },
        tx,
      );
      return updated;
    });
  }

  async transition(id: string, to: VendorStatus, rationale: string) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const vendor = await tx.vendor.findFirst({ where: { id, organizationId } });
      if (!vendor) throw notFound('Vendor');
      if (['approved', 'approved_with_conditions', 'rejected'].includes(to)) throw badRequest('use_assessment_decision', 'Vendors are approved or rejected through an assessment decision.');
      if (!LIFECYCLE[vendor.status].includes(to)) throw invalidTransition(vendor.status, to);
      const updated = await tx.vendor.update({ where: { id }, data: { status: to, version: { increment: 1 }, ...(to === 'assessment_required' ? { nextAssessmentAt: vendor.nextAssessmentAt ?? new Date() } : {}) } });
      await this.audit.record({ action: 'vendor.lifecycle_changed', entityType: 'vendor', entityId: id, before: { status: vendor.status }, after: { status: to }, rationale }, tx);
      return updated;
    });
  }

  // ── Contacts (restricted) ──
  async addContact(vendorId: string, input: { name: string; email: string; role?: string; contactType: string }) {
    const organizationId = requireOrgId();
    await this.mustGet(vendorId);
    const contact = await this.prisma.vendorContact.create({ data: { organizationId, vendorId, ...input, email: input.email.toLowerCase() } });
    await this.audit.record({ action: 'vendor.contact_added', entityType: 'vendor', entityId: vendorId, after: { contactId: contact.id, contactType: input.contactType } });
    return contact;
  }

  async removeContact(vendorId: string, contactId: string) {
    const organizationId = requireOrgId();
    const result = await this.prisma.vendorContact.deleteMany({ where: { id: contactId, vendorId, organizationId } });
    if (!result.count) throw notFound('Contact');
    await this.audit.record({ action: 'vendor.contact_removed', entityType: 'vendor', entityId: vendorId, before: { contactId } });
  }

  async mustGet(id: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, organizationId: requireOrgId() } });
    if (!vendor) throw notFound('Vendor');
    return vendor;
  }
}
