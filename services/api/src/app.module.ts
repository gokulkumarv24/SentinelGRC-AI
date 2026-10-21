import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { SecurityGuard } from './common/security.guard.js';
import { AuditController } from './modules/audit/audit.controller.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { PasswordService } from './modules/auth/password.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { ComplianceController } from './modules/compliance/compliance.controller.js';
import { ComplianceService } from './modules/compliance/compliance.service.js';
import { ControlTestsService } from './modules/control-tests/control-tests.service.js';
import { ControlImportService } from './modules/controls/control-import.service.js';
import { DashboardService } from './modules/dashboard/dashboard.service.js';
import { FrameworksService } from './modules/frameworks/frameworks.service.js';
import { MappingsService } from './modules/frameworks/mappings.service.js';
import { ControlsController } from './modules/controls/controls.controller.js';
import { ControlsService } from './modules/controls/controls.service.js';
import { EvidenceController } from './modules/evidence/evidence.controller.js';
import { EvidenceService } from './modules/evidence/evidence.service.js';
import { StorageService } from './modules/evidence/storage.js';
import { FindingsController } from './modules/findings/findings.controller.js';
import { FindingsService } from './modules/findings/findings.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { MembersService } from './modules/organizations/members.service.js';
import { OrganizationBootstrapService } from './modules/organizations/organization-bootstrap.service.js';
import { OrganizationsController } from './modules/organizations/organizations.controller.js';
import { OrganizationsService } from './modules/organizations/organizations.service.js';
import { RemediationController } from './modules/remediation/remediation.controller.js';
import { RemediationService } from './modules/remediation/remediation.service.js';
import { RisksController } from './modules/risks/risks.controller.js';
import { RisksService } from './modules/risks/risks.service.js';
import { ScoringPolicyService } from './modules/risks/scoring-policy.service.js';
import { SearchController } from './modules/search/search.controller.js';
import { EntityResolver } from './modules/shared/entity-resolver.service.js';
import { EventQueue } from './modules/workflows/event-queue.service.js';
import { PrismaService } from './prisma/prisma.service.js';

const CORE_PROVIDERS = [
  PrismaService,
  AuditService,
  SessionService,
  PasswordService,
  OrganizationBootstrapService,
  EntityResolver,
  NotificationsService,
  EventQueue,
  StorageService,
  ScoringPolicyService,
];

/** Infrastructure shared by every feature module and by the worker process. */
@Global()
@Module({ providers: CORE_PROVIDERS, exports: CORE_PROVIDERS })
export class CoreModule {}

/** Business services shared by the API and the worker. */
export const DOMAIN_SERVICES = [
  AuthService,
  MembersService,
  OrganizationsService,
  RisksService,
  FindingsService,
  RemediationService,
  ControlsService,
  EvidenceService,
  FrameworksService,
  MappingsService,
  ControlTestsService,
  ComplianceService,
  DashboardService,
  ControlImportService,
];

@Global()
@Module({ imports: [CoreModule], providers: DOMAIN_SERVICES, exports: DOMAIN_SERVICES })
export class DomainModule {}

@Module({
  imports: [CoreModule, DomainModule],
  controllers: [
    HealthController,
    AuthController,
    OrganizationsController,
    AuditController,
    NotificationsController,
    RisksController,
    FindingsController,
    RemediationController,
    // Before ControlsController: its literal routes (controls/export.csv, controls/import) must win over controls/:id.
    ComplianceController,
    ControlsController,
    EvidenceController,
    SearchController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SecurityGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
