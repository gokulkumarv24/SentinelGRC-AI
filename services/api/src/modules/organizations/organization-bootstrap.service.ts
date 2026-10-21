import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../../prisma/prisma.service.js';
import { DEFAULT_RISK_POLICY } from '../risks/risk-scoring.js';
import { DEFAULT_VENDOR_POLICY } from '../vendors/vendor-scoring.js';
import { DEFAULT_WORKFLOWS } from '../workflows/default-workflows.js';

/** Creates the per-organization defaults every new tenant needs. Idempotent. */
@Injectable()
export class OrganizationBootstrapService {
  async initialize(tx: Tx, organizationId: string): Promise<void> {
    for (const [kind, config] of [
      ['risk', DEFAULT_RISK_POLICY],
      ['vendor', DEFAULT_VENDOR_POLICY],
    ] as const) {
      await tx.scoringPolicy.upsert({
        where: { organizationId_kind_version: { organizationId, kind, version: 1 } },
        create: { organizationId, kind, version: 1, config: config as unknown as Prisma.InputJsonValue, rationale: 'Initial default policy' },
        update: {},
      });
    }
    for (const wf of DEFAULT_WORKFLOWS) {
      await tx.workflowDefinition.upsert({
        where: { organizationId_key: { organizationId, key: wf.key } },
        create: {
          organizationId,
          key: wf.key,
          name: wf.name,
          description: wf.description,
          triggerType: wf.triggerType,
          eventType: typeof wf.configuration.event === 'string' ? wf.configuration.event : null,
          scheduleCron: wf.intervalHours ? `every ${wf.intervalHours}h` : null,
          configuration: { intervalHours: wf.intervalHours ?? null, ...wf.configuration } as Prisma.InputJsonValue,
          nextRunAt: wf.intervalHours ? new Date() : null,
        },
        update: {},
      });
    }
  }
}
