import { conditionMet, validateAnswer, visibleQuestions, type QuestionDef } from './questionnaire.js';

const q = (o: Partial<QuestionDef>): QuestionDef => ({ id: o.questionKey ?? 'q', questionKey: 'q', responseType: 'yes_no', options: [], required: true, dependsOnQuestionKey: null, dependsOnAnswer: null, ...o });

describe('questionnaire logic', () => {
  it('validates answers by response type', () => {
    expect(validateAnswer(q({ responseType: 'yes_no' }), 'yes')).toBeTruthy();
    expect(validateAnswer(q({ responseType: 'yes_no' }), true)).toBeNull();
    expect(validateAnswer(q({ responseType: 'single_choice', options: ['A', 'B'] }), 'C')).toBeTruthy();
    expect(validateAnswer(q({ responseType: 'multiple_choice', options: ['A', 'B'] }), ['A', 'A'])).toBeTruthy();
    expect(validateAnswer(q({ responseType: 'multiple_choice', options: ['A', 'B'] }), ['A', 'B'])).toBeNull();
    expect(validateAnswer(q({ responseType: 'number' }), Number.NaN)).toBeTruthy();
    expect(validateAnswer(q({ responseType: 'date' }), '2026-13-40')).toBeTruthy();
    expect(validateAnswer(q({ responseType: 'date' }), '2026-02-01')).toBeNull();
  });

  it('evaluates follow-up conditions', () => {
    expect(conditionMet(true, { equals: true })).toBe(true);
    expect(conditionMet(['SOC 2 Type II'], { notIncludes: 'None' })).toBe(true);
    expect(conditionMet(['None'], { notIncludes: 'None' })).toBe(false);
    expect(conditionMet(undefined, { equals: true })).toBe(false);
  });

  it('shows follow-up questions only when their parent condition holds (transitively)', () => {
    const parent = q({ id: 'p', questionKey: 'ai.usage' });
    const child = q({ id: 'c', questionKey: 'ai.training', dependsOnQuestionKey: 'ai.usage', dependsOnAnswer: { equals: true } });
    const grandchild = q({ id: 'g', questionKey: 'ai.more', dependsOnQuestionKey: 'ai.training', dependsOnAnswer: { equals: false } });
    expect(visibleQuestions([parent, child, grandchild], new Map([['p', false]])).map((x) => x.id)).toEqual(['p']);
    expect(visibleQuestions([parent, child, grandchild], new Map<string, unknown>([['p', true], ['c', false]])).map((x) => x.id)).toEqual(['p', 'c', 'g']);
  });
});
