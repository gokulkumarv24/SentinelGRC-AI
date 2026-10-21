import { Injectable } from '@nestjs/common';
import { badRequest, notFound } from '../../common/errors.js';
import { requireOrgId } from '../../common/request-context.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';

/** Entity types that may be referenced polymorphically (evidence links, risk links, AI sources). */
export const LINKABLE_TYPES = [
  'control',
  'risk',
  'finding',
  'remediation_task',
  'vendor',
  'vendor_assessment',
  'assessment_response',
  'ai_system',
  'ai_assessment',
  'ai_assessment_item',
  'ai_evaluation',
  'ai_incident',
  'evidence',
  'report',
] as const;
export type LinkableType = (typeof LINKABLE_TYPES)[number];

export interface ResolvedEntity {
  type: LinkableType;
  id: string;
  label: string;
}

/**
 * Polymorphic references cannot be enforced with foreign keys, so every one is checked here:
 * the record must exist AND belong to the caller's organization (spec §5.1 evidence_links).
 * Missing and foreign records produce the same 404.
 */
@Injectable()
export class EntityResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(type: string, id: string, tx?: Tx): Promise<ResolvedEntity> {
    const organizationId = requireOrgId();
    const db = tx ?? this.prisma;
    const where = { id, organizationId };
    let label: string | undefined;
    switch (type as LinkableType) {
      case 'control': {
        const r = await db.control.findFirst({ where, select: { controlCode: true, title: true } });
        label = r ? `${r.controlCode} ${r.title}` : undefined;
        break;
      }
      case 'risk': {
        const r = await db.risk.findFirst({ where, select: { riskKey: true, title: true } });
        label = r ? `${r.riskKey} ${r.title}` : undefined;
        break;
      }
      case 'finding': {
        const r = await db.finding.findFirst({ where, select: { findingKey: true, title: true } });
        label = r ? `${r.findingKey} ${r.title}` : undefined;
        break;
      }
      case 'remediation_task':
        label = (await db.remediationTask.findFirst({ where, select: { title: true } }))?.title;
        break;
      case 'vendor':
        label = (await db.vendor.findFirst({ where, select: { name: true } }))?.name;
        break;
      case 'vendor_assessment': {
        const r = await db.vendorAssessment.findFirst({ where, select: { vendor: { select: { name: true } }, assessmentVersion: true } });
        label = r ? `${r.vendor.name} assessment v${r.assessmentVersion}` : undefined;
        break;
      }
      case 'assessment_response': {
        const r = await db.questionResponse.findFirst({ where, select: { questionRef: { select: { questionKey: true } } } });
        label = r?.questionRef.questionKey;
        break;
      }
      case 'ai_system':
        label = (await db.aiSystem.findFirst({ where, select: { name: true } }))?.name;
        break;
      case 'ai_assessment': {
        const r = await db.aiAssessment.findFirst({ where, select: { aiSystem: { select: { name: true } }, assessmentVersion: true } });
        label = r ? `${r.aiSystem.name} AI assessment v${r.assessmentVersion}` : undefined;
        break;
      }
      case 'ai_assessment_item':
        label = (await db.aiAssessmentItem.findFirst({ where, select: { questionKey: true } }))?.questionKey;
        break;
      case 'ai_evaluation':
        label = (await db.aiEvaluation.findFirst({ where, select: { evaluationType: true } }))?.evaluationType;
        break;
      case 'ai_incident':
        label = (await db.aiIncident.findFirst({ where, select: { title: true } }))?.title;
        break;
      case 'evidence':
        label = (await db.evidence.findFirst({ where, select: { title: true } }))?.title;
        break;
      case 'report':
        label = (await db.reportRun.findFirst({ where, select: { title: true } }))?.title;
        break;
      default:
        throw badRequest('invalid_entity_type', `Unsupported entity type "${type}"`);
    }
    if (!label) throw notFound('Linked record');
    return { type: type as LinkableType, id, label };
  }

  /** Verifies a user is an active member of the current organization (owner/assignee fields). */
  async assertMember(userId: string | null | undefined, tx?: Tx): Promise<void> {
    if (!userId) return;
    const member = await (tx ?? this.prisma).membership.findFirst({ where: { userId, organizationId: requireOrgId(), status: 'active' } });
    if (!member) throw badRequest('invalid_user', 'The selected person is not an active member of this organization');
  }

  /** Verifies an evidence record exists in the current organization and is not archived. */
  async assertEvidence(evidenceId: string | null | undefined, tx?: Tx): Promise<void> {
    if (!evidenceId) return;
    const evidence = await (tx ?? this.prisma).evidence.findFirst({ where: { id: evidenceId, organizationId: requireOrgId(), archivedAt: null } });
    if (!evidence) throw notFound('Evidence');
  }
}
