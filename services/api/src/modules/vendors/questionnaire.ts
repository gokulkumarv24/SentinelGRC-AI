import { z } from 'zod';
import type { ResponseType } from '../../generated/prisma/client.js';

/** Visibility condition for follow-up questions (spec §9.2 "conditional follow-up"). */
export type Condition = { equals: unknown } | { in: unknown[] } | { includes: unknown } | { notIncludes: unknown };

export function conditionMet(answer: unknown, condition: Condition | null | undefined): boolean {
  if (!condition) return true;
  if (answer === null || answer === undefined) return false;
  if ('equals' in condition) return answer === condition.equals;
  if ('in' in condition) return condition.in.includes(answer);
  if ('includes' in condition) return Array.isArray(answer) && answer.includes(condition.includes);
  if ('notIncludes' in condition) return Array.isArray(answer) && answer.length > 0 && !answer.includes(condition.notIncludes);
  return true;
}

export interface QuestionDef {
  id: string;
  questionKey: string;
  responseType: ResponseType;
  options: string[];
  required: boolean;
  dependsOnQuestionKey: string | null;
  dependsOnAnswer: unknown;
}

/** Validates an answer against its question's response type. Returns an error message or null. */
export function validateAnswer(q: QuestionDef, answer: unknown): string | null {
  if (answer === null || answer === undefined || answer === '') return null; // emptiness handled by required checks
  switch (q.responseType) {
    case 'yes_no':
      return typeof answer === 'boolean' ? null : 'Answer yes or no';
    case 'single_choice':
      return typeof answer === 'string' && q.options.includes(answer) ? null : 'Choose one of the listed options';
    case 'multiple_choice':
      return Array.isArray(answer) && answer.length > 0 && answer.every((a) => typeof a === 'string' && q.options.includes(a)) && new Set(answer).size === answer.length ? null : 'Choose one or more listed options';
    case 'text':
      return typeof answer === 'string' && answer.length <= 10_000 ? null : 'Enter text up to 10,000 characters';
    case 'number':
      return typeof answer === 'number' && Number.isFinite(answer) ? null : 'Enter a number';
    case 'date':
      return typeof answer === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(answer) && !Number.isNaN(Date.parse(answer)) ? null : 'Enter a date (YYYY-MM-DD)';
    case 'file':
      return typeof answer === 'string' ? null : 'Attach a file';
    default:
      return 'Unsupported question type';
  }
}

/** Which questions are currently shown given the answers so far. */
export function visibleQuestions<Q extends QuestionDef>(questions: Q[], answers: Map<string, unknown>): Q[] {
  const byKey = new Map(questions.map((q) => [q.questionKey, q]));
  return questions.filter((q) => {
    let current: QuestionDef | undefined = q;
    const seen = new Set<string>();
    while (current?.dependsOnQuestionKey) {
      if (seen.has(current.questionKey)) return false;
      seen.add(current.questionKey);
      const parent = byKey.get(current.dependsOnQuestionKey);
      if (!parent || !conditionMet(answers.get(parent.id), current.dependsOnAnswer as Condition)) return false;
      current = parent;
    }
    return true;
  });
}

export const templateFileSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(200),
  version: z.number().int().positive(),
  purpose: z.enum(['vendor_security', 'ai_system']),
  description: z.string().max(2000).optional(),
  questions: z
    .array(
      z.object({
        questionKey: z.string().regex(/^[a-z0-9_.]{2,60}$/),
        category: z.string().min(1).max(60),
        questionText: z.string().min(1).max(1000),
        responseType: z.enum(['yes_no', 'single_choice', 'multiple_choice', 'text', 'number', 'date', 'file']),
        options: z.array(z.string().max(200)).max(30).default([]),
        required: z.boolean().default(true),
        weight: z.number().int().min(0).max(10).default(1),
        important: z.boolean().default(false),
        evidenceRequired: z.boolean().default(false),
        guidance: z.string().max(2000).optional(),
        expectedAnswer: z.unknown().nullable().optional(),
        dependsOnQuestionKey: z.string().optional(),
        dependsOnAnswer: z.unknown().optional(),
        rmfFunction: z.enum(['Govern', 'Map', 'Measure', 'Manage']).optional(),
      }),
    )
    .min(1)
    .max(300),
});
export type TemplateFile = z.infer<typeof templateFileSchema>;
