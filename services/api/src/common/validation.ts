import { applyDecorators, PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from './errors.js';

/** Path of the first string containing a NUL character, which PostgreSQL text columns cannot store. */
function findNul(value: unknown, path: string[] = []): string | null {
  if (typeof value === 'string') return value.includes('\u0000') ? path.join('.') || '(value)' : null;
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const found = findNul(child, [...path, key]);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Validates and strips unknown keys; failure → 422 with per-field messages. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const nulPath = findNul(value);
    if (nulPath !== null) {
      throw new AppError(422, 'validation_error', 'Some fields are invalid', { fields: [{ path: nulPath, message: 'Contains a control character that is not allowed' }] });
    }
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      throw new AppError(422, 'validation_error', 'Some fields are invalid', { fields });
    }
    return result.data;
  }
}

export const zod = <T extends z.ZodType>(schema: T) => new ZodPipe(schema);

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;

/** Documents a Zod body schema in OpenAPI. Pair with `@Body(zod(schema))`. */
export const ApiZodBody = (schema: z.ZodType) => ApiBody({ schema: jsonSchema(schema) });

/** Documents Zod query parameters in OpenAPI. Pair with `@Query(zod(schema))`. */
export function ApiZodQuery(schema: z.ZodObject) {
  const props = (jsonSchema(schema).properties ?? {}) as Record<string, Record<string, unknown>>;
  return applyDecorators(...Object.entries(props).map(([name, s]) => ApiQuery({ name, required: false, schema: s })));
}

// ── Reusable field schemas ──
export const uuid = z.uuid();
export const isoDate = z.coerce.date();
/** Links shown to users as <a href>: http(s) only, so javascript:/data: URLs are never stored. */
export const httpUrl = (max = 1000) => z.url({ protocol: /^https?$/, error: 'Must be an http:// or https:// URL' }).max(max);
/** JSON bodies only: a real number, so "3" or true are rejected instead of silently coerced. */
export const score1to5 = z.number({ error: 'Must be a whole number from 1 to 5' }).int().min(1).max(5);
/** Free text with a sane upper bound; trims whitespace. */
export const text = (max = 5000) => z.string().trim().max(max);
export const requiredText = (max = 500) => z.string().trim().min(1, 'Required').max(max);
