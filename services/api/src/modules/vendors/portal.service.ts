import { Injectable } from '@nestjs/common';
import { newToken, sha256Hex } from '../../common/crypto.js';
import { AppError, conflict, notFound } from '../../common/errors.js';
import { currentContext, requireOrgId, requireUserId, runWithContext } from '../../common/request-context.js';
import { loadEnv } from '../../config/env.js';
import { permissionsForRoles } from '../../permissions/catalog.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { visibleQuestions } from './questionnaire.js';
import { AssessmentsService, type ResponseInput } from './assessments.service.js';

const INVITATION_DAYS = 14;

/**
 * External vendor portal (spec §9.5). A respondent authenticates only with an invitation token
 * (hash stored, short expiry, revocable) and can reach exactly one assessment. Responses shown to
 * the respondent never include internal scores, reviewer notes or other vendors' data.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assessments: AssessmentsService,
    private readonly evidence: EvidenceService,
  ) {}

  // ── Internal management ──
  async invite(assessmentId: string, contactEmail: string) {
    const organizationId = requireOrgId();
    const assessment = await this.prisma.vendorAssessment.findFirst({ where: { id: assessmentId, organizationId } });
    if (!assessment) throw notFound('Assessment');
    if (!['draft', 'returned_for_clarification'].includes(assessment.status)) throw conflict('Invitations can only be issued while the vendor can answer.');
    const token = newToken();
    const invitation = await this.prisma.vendorPortalInvitation.create({
      data: { organizationId, vendorId: assessment.vendorId, assessmentId, contactEmail: contactEmail.toLowerCase(), tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000), createdBy: requireUserId() },
    });
    await this.audit.record({ action: 'vendor_portal.invited', entityType: 'vendor_assessment', entityId: assessmentId, after: { invitationId: invitation.id, contactEmail: invitation.contactEmail, expiresAt: invitation.expiresAt } });
    // Delivered out-of-band by the vendor manager; shown once.
    return { invitationId: invitation.id, expiresAt: invitation.expiresAt, portalUrl: `${loadEnv().PUBLIC_APP_URL}/vendor-portal/${token}` };
  }

  async revoke(assessmentId: string, invitationId: string) {
    const organizationId = requireOrgId();
    const result = await this.prisma.vendorPortalInvitation.updateMany({ where: { id: invitationId, assessmentId, organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw notFound('Invitation');
    await this.audit.record({ action: 'vendor_portal.revoked', entityType: 'vendor_assessment', entityId: assessmentId, after: { invitationId } });
  }

  // ── Respondent side ──
  /** Resolves a token and runs `fn` in a narrowly scoped respondent context. */
  async asRespondent<T>(token: string, fn: (scope: { organizationId: string; vendorId: string; assessmentId: string; invitationId: string }) => Promise<T>): Promise<T> {
    const invitation = await this.prisma.vendorPortalInvitation.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!invitation || invitation.revokedAt || invitation.expiresAt < new Date()) {
      throw new AppError(401, 'portal_link_invalid', 'This questionnaire link is invalid, expired or revoked. Contact your requester for a new link.');
    }
    await this.prisma.vendorPortalInvitation.update({ where: { id: invitation.id }, data: { lastUsedAt: new Date() } });
    const ctx = currentContext();
    const scope = { organizationId: invitation.organizationId, vendorId: invitation.vendorId, assessmentId: invitation.assessmentId, invitationId: invitation.id };
    // A synthetic membership with only the permissions the respondent flow needs, scoped to one organization.
    return runWithContext(
      {
        ...ctx,
        actorType: 'vendor_respondent',
        user: undefined,
        vendorPortal: scope,
        membership: { id: `portal:${invitation.id}`, organizationId: invitation.organizationId, organizationName: '', roleKeys: [], permissions: permissionsForRoles([]) },
      },
      () => fn(scope),
    );
  }

  view(token: string) {
    return this.asRespondent(token, async ({ organizationId, assessmentId }) => {
      const a = await this.prisma.vendorAssessment.findFirstOrThrow({
        where: { id: assessmentId, organizationId },
        include: { vendor: { select: { name: true } }, templateRef: { include: { questions: { orderBy: { sortOrder: 'asc' } } } }, responses: true },
      });
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
      const answers = new Map(a.responses.map((r) => [r.questionId, r.notApplicable ? undefined : r.answer]));
      const visible = new Set(visibleQuestions(a.templateRef.questions, answers).map((q) => q.id));
      // Explicit allowlist of fields: nothing internal leaves the server.
      return {
        requester: org.name,
        vendor: a.vendor.name,
        questionnaire: { name: a.templateRef.name, version: a.templateRef.version },
        status: a.status,
        editable: ['draft', 'returned_for_clarification'].includes(a.status),
        dueDate: a.dueDate,
        questions: a.templateRef.questions.map((q) => {
          const r = a.responses.find((x) => x.questionId === q.id);
          return {
            id: q.id,
            questionKey: q.questionKey,
            category: q.category,
            questionText: q.questionText,
            responseType: q.responseType,
            options: q.options,
            required: q.required,
            guidance: q.guidance,
            evidenceRequired: q.evidenceRequired,
            dependsOnQuestionKey: q.dependsOnQuestionKey,
            dependsOnAnswer: q.dependsOnAnswer,
            visible: visible.has(q.id),
            response: r ? { answer: r.answer, notApplicable: r.notApplicable, naRationale: r.naRationale, comments: r.comments, hasEvidence: !!r.evidenceId } : null,
          };
        }),
      };
    });
  }

  save(token: string, responses: ResponseInput[]) {
    return this.asRespondent(token, async ({ assessmentId, invitationId }) => {
      // Respondents cannot attach arbitrary evidence ids — only files they uploaded through this invitation.
      const allowed = new Set(
        (await this.prisma.evidence.findMany({ where: { sourceUri: `vendor-portal:${invitationId}` }, select: { id: true } })).map((e) => e.id),
      );
      for (const r of responses) if (r.evidenceId && !allowed.has(r.evidenceId)) throw notFound('Evidence');
      const result = await this.assessments.saveResponses(assessmentId, responses, `vendor:${invitationId}`);
      await this.audit.record({ action: 'vendor_portal.answers_saved', entityType: 'vendor_assessment', entityId: assessmentId, after: { answers: responses.length, invitationId } });
      return result;
    });
  }

  upload(token: string, file: { buffer: Buffer; originalname: string; size: number }, title: string) {
    return this.asRespondent(token, async ({ assessmentId, invitationId }) => {
      const a = await this.prisma.vendorAssessment.findFirstOrThrow({ where: { id: assessmentId } });
      if (!['draft', 'returned_for_clarification'].includes(a.status)) throw conflict('This questionnaire can no longer be changed.');
      const evidence = await this.evidence.upload(file, { title, classification: 'confidential', sourceType: 'upload', sourceUri: `vendor-portal:${invitationId}` });
      return { id: evidence.id, title: evidence.title, originalFilename: evidence.originalFilename };
    });
  }

  submit(token: string) {
    return this.asRespondent(token, async ({ assessmentId }) => {
      const result = await this.assessments.submit(assessmentId);
      return { status: result.status };
    });
  }
}
