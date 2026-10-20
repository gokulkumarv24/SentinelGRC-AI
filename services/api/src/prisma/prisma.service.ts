import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../config/env.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({ connectionString: loadEnv().DATABASE_URL, max: 10 });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Multi-record state changes run in one transaction (spec §3.4). */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
  }
}
