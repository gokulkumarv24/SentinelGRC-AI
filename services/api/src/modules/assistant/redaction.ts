/**
 * Minimization before any content leaves the system (spec §11.2, §16.3). Patterns are deliberately
 * conservative: secrets and direct identifiers are replaced with typed placeholders, and the counts
 * are recorded on the artifact so reviewers know what was removed.
 */
const RULES: Array<[string, RegExp]> = [
  ['PRIVATE_KEY', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['AWS_KEY', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['API_KEY', /\b(?:sk|pk|rk|gsk|xox[abpr]|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{16,}\b/g],
  ['SECRET', /\b(?:password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret)\s*[:=]\s*\S+/gi],
  ['EMAIL', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ['CARD', /\b(?:\d[ -]?){13,19}\b/g],
  ['IBAN', /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}\b/g],
  ['PHONE', /(?<!\w)\+?\d{1,3}[ .-]?\(?\d{2,4}\)?[ .-]?\d{3,4}[ .-]?\d{3,4}(?!\w)/g],
  ['IP', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
];

export interface Redacted {
  text: string;
  counts: Record<string, number>;
}

export function redact(input: string): Redacted {
  let text = input;
  const counts: Record<string, number> = {};
  for (const [label, pattern] of RULES) {
    text = text.replace(pattern, () => {
      counts[label] = (counts[label] ?? 0) + 1;
      return `[${label}]`;
    });
  }
  return { text, counts };
}

/** Phrases typical of instructions aimed at a model. Detection only adds a limitation; content is never trusted either way. */
const INJECTION = /\b(ignore (all |any )?(previous|prior|above) instructions|disregard (the )?(system|previous)|you are now|system prompt|act as (an? )?(admin|administrator)|approve (this|the) (assessment|risk|request)|reveal (the )?(secret|password|api key))\b/i;

export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}
