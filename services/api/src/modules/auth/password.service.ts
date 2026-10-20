import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/** Argon2id with OWASP-recommended minimums (19 MiB memory, t=2, p=1). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;


export const passwordPolicy = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200, 'Use at most 200 characters')
  .refine((v) => /[a-z]/i.test(v) && /[^a-z]/i.test(v), 'Mix letters with numbers or symbols');

@Injectable()
export class PasswordService {
  // Real hash of a random value: unknown-user logins do the same work as wrong-password logins.
  private readonly dummyHash = argon2.hash(randomBytes(32).toString('hex'), OPTIONS);

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? (await this.dummyHash), password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }
}
