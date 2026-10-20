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
import { HealthController } from './modules/health/health.controller.js';
import { MembersService } from './modules/organizations/members.service.js';
import { OrganizationBootstrapService } from './modules/organizations/organization-bootstrap.service.js';
import { OrganizationsController } from './modules/organizations/organizations.controller.js';
import { OrganizationsService } from './modules/organizations/organizations.service.js';
import { PrismaService } from './prisma/prisma.service.js';

/** Infrastructure shared by every feature module. */
@Global()
@Module({
  providers: [PrismaService, AuditService, SessionService, PasswordService, OrganizationBootstrapService],
  exports: [PrismaService, AuditService, SessionService, PasswordService, OrganizationBootstrapService],
})
export class CoreModule {}

@Module({
  imports: [CoreModule],
  controllers: [HealthController, AuthController, OrganizationsController, AuditController],
  providers: [
    AuthService,
    MembersService,
    OrganizationsService,
    { provide: APP_GUARD, useClass: SecurityGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
