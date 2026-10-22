import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../common/errors.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import { actorId, requireOrgId, requireUserId } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EventQueue } from '../workflows/event-queue.service.js';

const MAX_QUESTIONS = 500;
const SHORT = ['yes', 'no', 'partial', 'not_applicable', 'unknown'] as const;
const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'your', 'does', 'what', 'which', 'when', 'there', 'their', 'please', 'describe', 'provide', 'company', 'organization', 'organisation']);

/** Content words used to match questions against the answer library. */
export function questionTerms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

/** Jaccard similarity of two questions' content words (0–1). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Splits pasted text or CSV into questions. Accepted forms, one question per line:
 *   "Question text"   |   "Section | Question text"   |   CSV with a header row containing "question" (and optionally "section").
 */
export function parseQuestions(text: string): Array<{ section: string | null; questionText: string }> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const cells = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const header = cells(lines[0]).map((h) => h.toLowerCase());
  const qIdx = header.findIndex((h) => h.includes('question'));
  if (qIdx >= 0 && lines[0].includes(',')) {
    const sIdx = header.findIndex((h) => h.includes('section') || h.includes('category') || h.includes('domain'));
    return lines.slice(1).map((l) => cells(l)).filter((c) => c[qIdx]).map((c) => ({ section: sIdx >= 0 ? c[sIdx] || null : null, questionText: c[qIdx] }));
  }
  return lines.map((l) => {
    const [a, ...rest] = l.split('|');
    return rest.length ? { section: a.trim() || null, questionText: rest.join('|').trim() } : { section: null, questionText: l.replace(/^\d+[.)]\s*/, '') };
  });
}

/** Customer security questionnaires answered with the AI agent and an approved-answer library (trust desk). */
@Injectable()
export class TrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventQueue,
  ) {}

  async list(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; status?: string[]; q?: string }) {
    const where: Prisma.TrustQuestionnaireWhereInput = {
      organizationId: requireOrgId(),
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { customerName: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([this.prisma.trustQuestionnaire.findMany({ where, ...pageArgs(query) }), this.prisma.trustQuestionnaire.count({ where })]);
    const counts = await this.prisma.trustQuestionnaireItem.groupBy({ by: ['questionnaireId', 'answerStatus'], where: { questionnaireId: { in: items.map((i) => i.id) } }, _count: true });
    return toPage(
      items.map((q) => ({ ...q, progress: Object.fromEntries(counts.filter((c) => c.questionnaireId === q.id).map((c) => [c.answerStatus, c._count])) })),
      total,
      query,
    );
  }

  async get(id: string) {
    const q = await this.prisma.trustQuestionnaire.findFirst({ where: { id, organizationId: requireOrgId() }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!q) throw notFound('Questionnaire');
    return q;
  }

  /** Creates the questionnaire and queues the agent to answer it. */
  async create(input: { title: string; customerName: string; dueDate?: Date | null; notes?: string | null; questions?: Array<{ section?: string | null; questionText: string }>; text?: string }) {
    const organizationId = requireOrgId();
    const questions = (input.questions?.length ? input.questions : parseQuestions(input.text ?? ''))
      .map((q) => ({ section: q.section?.trim().slice(0, 200) || null, questionText: q.questionText.trim().slice(0, 2000) }))
      .filter((q) => q.questionText);
    if (!questions.length) throw badRequest('no_questions', 'Add at least one question (one per line, or a CSV with a "question" column).');
    if (questions.length > MAX_QUESTIONS) throw badRequest('too_many_questions', `A questionnaire may have at most ${MAX_QUESTIONS} questions.`);
    return this.prisma.tx(async (tx) => {
      const q = await tx.trustQuestionnaire.create({ data: { organizationId, title: input.title, customerName: input.customerName, dueDate: input.dueDate ?? null, notes: input.notes ?? null, status: 'answering', createdBy: actorId() } });
      await tx.trustQuestionnaireItem.createMany({ data: questions.map((x, i) => ({ organizationId, questionnaireId: q.id, sortOrder: i + 1, section: x.section, questionText: x.questionText })) });
      await this.audit.record({ action: 'trust_questionnaire.created', entityType: 'trust_questionnaire', entityId: q.id, after: { customerName: q.customerName, questions: questions.length } }, tx);
      await this.events.emit(tx, organizationId, 'trust_questionnaire.submitted', { questionnaireId: q.id }, `trust-questionnaire:${q.id}:${randomUUID()}`);
      return q;
    });
  }

  /** Asks the agent again for every unanswered item (pending or needs input). */
  async reanswer(id: string) {
    const organizationId = requireOrgId();
    const q = await this.get(id);
    return this.prisma.tx(async (tx) => {
      await tx.trustQuestionnaireItem.updateMany({ where: { questionnaireId: q.id, answerStatus: 'needs_input' }, data: { answerStatus: 'pending' } });
      await tx.trustQuestionnaire.update({ where: { id: q.id }, data: { status: 'answering', version: { increment: 1 } } });
      const queued = await this.events.emit(tx, organizationId, 'trust_questionnaire.submitted', { questionnaireId: q.id }, `trust-questionnaire:${q.id}:${randomUUID()}`);
      await this.audit.record({ action: 'trust_questionnaire.reanswer_requested', entityType: 'trust_questionnaire', entityId: q.id }, tx);
      return { queued };
    });
  }

  /** A person saves, approves or reopens one answer. Approved answers feed the answer library. */
  async updateItem(questionnaireId: string, itemId: string, input: { action: 'save' | 'approve' | 'reopen'; finalAnswer?: string | null; shortAnswer?: (typeof SHORT)[number] | null }) {
    const organizationId = requireOrgId();
    return this.prisma.tx(async (tx) => {
      const item = await tx.trustQuestionnaireItem.findFirst({ where: { id: itemId, questionnaireId, organizationId } });
      if (!item) throw notFound('Question');
      const answer = (input.finalAnswer ?? item.finalAnswer ?? item.draftAnswer ?? '').trim();
      const shortAnswer = input.shortAnswer ?? item.shortAnswer;
      let data: Prisma.TrustQuestionnaireItemUpdateInput;
      if (input.action === 'reopen') data = { answerStatus: item.draftAnswer ? 'drafted' : 'pending', reviewedBy: null, reviewedAt: null };
      else if (input.action === 'save') data = { finalAnswer: answer || null, shortAnswer, answerStatus: item.answerStatus === 'approved' ? 'drafted' : answer ? 'drafted' : item.answerStatus, answerSource: input.finalAnswer !== undefined ? 'manual' : item.answerSource, reviewedBy: null, reviewedAt: null };
      else {
        if (!answer) throw badRequest('answer_required', 'Write or accept an answer before approving it.');
        data = { finalAnswer: answer, shortAnswer, answerStatus: 'approved', reviewedBy: requireUserId(), reviewedAt: new Date() };
      }
      const updated = await tx.trustQuestionnaireItem.update({ where: { id: item.id }, data });
      if (input.action === 'approve') await this.learn(tx, organizationId, updated.questionText, answer, shortAnswer, updated.sources, item.libraryAnswerId);
      await this.audit.record({ action: `trust_questionnaire.answer_${input.action === 'approve' ? 'approved' : input.action === 'reopen' ? 'reopened' : 'saved'}`, entityType: 'trust_questionnaire', entityId: questionnaireId, after: { itemId, sortOrder: item.sortOrder, shortAnswer } }, tx);
      await this.refreshStatus(tx, questionnaireId);
      return updated;
    });
  }

  /** Approves every drafted answer with a short answer other than "unknown" (bulk review after reading them). */
  async approveDrafted(questionnaireId: string) {
    const organizationId = requireOrgId();
    const q = await this.get(questionnaireId);
    const ready = q.items.filter((i) => i.answerStatus === 'drafted' && (i.finalAnswer ?? i.draftAnswer) && i.shortAnswer !== 'unknown');
    return this.prisma.tx(async (tx) => {
      for (const i of ready) {
        const answer = (i.finalAnswer ?? i.draftAnswer)!;
        await tx.trustQuestionnaireItem.update({ where: { id: i.id }, data: { finalAnswer: answer, answerStatus: 'approved', reviewedBy: requireUserId(), reviewedAt: new Date() } });
        await this.learn(tx, organizationId, i.questionText, answer, i.shortAnswer, i.sources, i.libraryAnswerId);
      }
      await this.audit.record({ action: 'trust_questionnaire.answers_bulk_approved', entityType: 'trust_questionnaire', entityId: questionnaireId, after: { approved: ready.length } }, tx);
      await this.refreshStatus(tx, questionnaireId);
      return { approved: ready.length };
    });
  }

  async exportCsv(id: string) {
    const q = await this.get(id);
    const esc = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const rows = q.items.map((i) => [i.sortOrder, esc(i.section), esc(i.questionText), esc(i.shortAnswer), esc(i.answerStatus === 'approved' ? i.finalAnswer : (i.finalAnswer ?? i.draftAnswer)), esc(i.answerStatus)].join(','));
    await this.audit.record({ action: 'trust_questionnaire.exported', entityType: 'trust_questionnaire', entityId: id, after: { approved: q.items.filter((i) => i.answerStatus === 'approved').length, total: q.items.length } });
    return { filename: `${q.customerName}-${q.title}`.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) + '.csv', body: ['#,Section,Question,Short answer,Answer,Status', ...rows].join('\n') };
  }

  libraryList(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc'; q?: string }) {
    const where: Prisma.TrustAnswerWhereInput = { organizationId: requireOrgId(), active: true, ...(query.q ? { questionText: { contains: query.q, mode: 'insensitive' } } : {}) };
    return Promise.all([this.prisma.trustAnswer.findMany({ where, ...pageArgs(query) }), this.prisma.trustAnswer.count({ where })]).then(([items, total]) => toPage(items, total, query));
  }

  async retireLibraryAnswer(id: string) {
    const r = await this.prisma.trustAnswer.updateMany({ where: { id, organizationId: requireOrgId(), active: true }, data: { active: false } });
    if (!r.count) throw notFound('Library answer');
    await this.audit.record({ action: 'trust_answer.retired', entityType: 'trust_answer', entityId: id });
  }

  /**
   * Agent step 1: reuse approved library answers for pending questions (no AI call).
   * Returns the ids still pending, for the AI to answer in batches.
   */
  async applyLibrary(questionnaireId: string, organizationId: string, threshold = 0.6): Promise<{ reused: number; pendingIds: string[] }> {
    const items = await this.prisma.trustQuestionnaireItem.findMany({ where: { questionnaireId, organizationId, answerStatus: 'pending' }, orderBy: { sortOrder: 'asc' } });
    const library = await this.prisma.trustAnswer.findMany({ where: { organizationId, active: true }, take: 2000 });
    const libTerms = library.map((l) => ({ l, t: questionTerms(l.questionText) }));
    let reused = 0;
    const pendingIds: string[] = [];
    for (const item of items) {
      const t = questionTerms(item.questionText);
      const best = libTerms.map((x) => ({ ...x, s: similarity(t, x.t) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= threshold) {
        await this.prisma.trustQuestionnaireItem.update({ where: { id: item.id }, data: { answerStatus: 'drafted', draftAnswer: best.l.answer, shortAnswer: best.l.shortAnswer, confidence: best.s >= 0.85 ? 'high' : 'medium', answerSource: 'library', libraryAnswerId: best.l.id, sources: (best.l.sources ?? undefined) as Prisma.InputJsonValue | undefined } });
        await this.prisma.trustAnswer.update({ where: { id: best.l.id }, data: { usageCount: { increment: 1 } } });
        reused++;
      } else pendingIds.push(item.id);
    }
    return { reused, pendingIds };
  }

  /** Agent step 2: stores AI-drafted answers (never approved automatically). */
  async applyDrafts(organizationId: string, artifactId: string, drafts: Array<{ itemId: string; shortAnswer: string; answer: string; confidence: string; sources: Array<{ type: string; label: string }> }>) {
    for (const d of drafts) {
      await this.prisma.trustQuestionnaireItem.updateMany({
        where: { id: d.itemId, organizationId, answerStatus: 'pending' },
        data: { answerStatus: d.shortAnswer === 'unknown' ? 'needs_input' : 'drafted', shortAnswer: d.shortAnswer, draftAnswer: d.answer, confidence: d.confidence, answerSource: 'agent', aiArtifactId: artifactId, sources: d.sources as Prisma.InputJsonValue },
      });
    }
  }

  async finishAnswering(questionnaireId: string) {
    await this.prisma.tx((tx) => this.refreshStatus(tx, questionnaireId));
  }

  private async learn(tx: Tx, organizationId: string, questionText: string, answer: string, shortAnswer: string | null, sources: Prisma.JsonValue, libraryAnswerId: string | null) {
    if (libraryAnswerId) {
      await tx.trustAnswer.updateMany({ where: { id: libraryAnswerId, organizationId }, data: { answer, shortAnswer, approvedBy: requireUserId() } });
      return;
    }
    const t = questionTerms(questionText);
    const existing = (await tx.trustAnswer.findMany({ where: { organizationId, active: true }, take: 2000 })).find((l) => similarity(t, questionTerms(l.questionText)) >= 0.85);
    if (existing) await tx.trustAnswer.update({ where: { id: existing.id }, data: { answer, shortAnswer, approvedBy: requireUserId() } });
    else await tx.trustAnswer.create({ data: { organizationId, questionText, answer, shortAnswer, sources: (sources ?? undefined) as Prisma.InputJsonValue | undefined, approvedBy: requireUserId() } });
  }

  private async refreshStatus(tx: Tx, questionnaireId: string) {
    const counts = await tx.trustQuestionnaireItem.groupBy({ by: ['answerStatus'], where: { questionnaireId }, _count: true });
    const n = (s: string) => counts.find((c) => c.answerStatus === s)?._count ?? 0;
    const total = counts.reduce((sum, c) => sum + c._count, 0);
    const status = total && n('approved') === total ? 'completed' : n('pending') ? 'answering' : 'in_review';
    const q = await tx.trustQuestionnaire.findUnique({ where: { id: questionnaireId }, select: { status: true } });
    if (q && q.status !== status) await tx.trustQuestionnaire.update({ where: { id: questionnaireId }, data: { status, completedAt: status === 'completed' ? new Date() : null, version: { increment: 1 } } });
    if (q && status === 'completed' && q.status !== 'completed') await this.audit.record({ action: 'trust_questionnaire.completed', entityType: 'trust_questionnaire', entityId: questionnaireId }, tx);
    return status;
  }
}
