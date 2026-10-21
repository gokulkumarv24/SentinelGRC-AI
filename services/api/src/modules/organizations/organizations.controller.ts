import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthenticatedOnly, PlatformAdmin, RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, requiredText, text, zod } from '../../common/validation.js';
import { ROLE_KEYS, type RoleKey } from '../../permissions/catalog.js';
import { AuthService } from '../auth/auth.service.js';
import { MembersService } from './members.service.js';
import { OrganizationsService } from './organizations.service.js';

const roleKeys = z.array(z.enum(ROLE_KEYS as [RoleKey, ...RoleKey[]])).min(1).max(ROLE_KEYS.length);
const timezone = z.string().refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC', 'Unknown time zone');

const createOrgSchema = z.object({
  name: requiredText(120),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, 'Use 3–50 lowercase letters, digits or hyphens'),
  industry: text(120).optional(),
  timezone: timezone.default('UTC'),
  adminEmail: z.email().max(320),
});
const updateOrgSchema = z.object({
  name: requiredText(120).optional(),
  industry: text(120).nullable().optional(),
  timezone: timezone.optional(),
  settings: z
    .object({
      evidenceRetentionDays: z.number().int().min(30).max(36500).optional(),
      auditRetentionDays: z.number().int().min(365).max(36500).optional(),
      requireSeparationOfDutiesForHighRisk: z.boolean().optional(),
      allowSelfApprovalForLowRisk: z.boolean().optional(),
      aiFeaturesEnabled: z.boolean().optional(),
      reportRetentionDays: z.number().int().min(1).max(3650).optional(),
    })
    .optional(),
});
const membersQuery = listQuery(['joinedAt', 'displayName'], { status: multi(['active', 'invited', 'suspended', 'removed']) });
const inviteSchema = z.object({ email: z.email().max(320), roles: roleKeys });
const rolesSchema = z.object({ roles: roleKeys, rationale: text(1000).optional() });
const statusSchema = z.object({ status: z.enum(['active', 'suspended', 'removed']), rationale: text(1000).optional() });

@ApiTags('organizations')
@Controller()
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly members: MembersService,
    private readonly auth: AuthService,
  ) {}

  /** Organizations the caller belongs to (platform admins see all). */
  @Get('organizations')
  @AuthenticatedOnly()
  async list() {
    const me = await this.auth.me();
    return me.user.isPlatformAdmin ? this.orgs.listAll() : me.organizations;
  }

  @Post('organizations')
  @PlatformAdmin()
  @ApiZodBody(createOrgSchema)
  create(@Body(zod(createOrgSchema)) body: z.infer<typeof createOrgSchema>) {
    return this.orgs.create(body);
  }

  @Get('organizations/current/onboarding')
  @RequirePermission('org.read')
  onboarding() {
    return this.orgs.onboarding();
  }

  @Get('organizations/current')
  @RequirePermission('org.read')
  current() {
    return this.orgs.current();
  }

  @Patch('organizations/current')
  @RequirePermission('org.manage')
  @ApiZodBody(updateOrgSchema)
  update(@Body(zod(updateOrgSchema)) body: z.infer<typeof updateOrgSchema>) {
    return this.orgs.updateCurrent(body);
  }

  @Get('members')
  @RequirePermission('member.read')
  @ApiZodQuery(membersQuery)
  listMembers(@Query(zod(membersQuery)) query: z.infer<typeof membersQuery>) {
    return this.members.list(query);
  }

  @Get('members/directory')
  @RequirePermission('member.read')
  directory() {
    return this.members.directory();
  }

  @Get('roles')
  @RequirePermission('member.read')
  roles() {
    return this.members.roleCatalog();
  }

  @Post('members/invitations')
  @RequirePermission('member.manage')
  @ApiZodBody(inviteSchema)
  invite(@Body(zod(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    return this.members.invite(body.email, body.roles);
  }

  @Get('members/invitations')
  @RequirePermission('member.manage')
  invitations() {
    return this.members.listInvitations();
  }

  @Delete('members/invitations/:id')
  @RequirePermission('member.manage')
  @HttpCode(204)
  revokeInvitation(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.revokeInvitation(id);
  }

  @Patch('members/:id/roles')
  @RequirePermission('role.assign')
  @ApiZodBody(rolesSchema)
  setRoles(@Param('id', ParseUUIDPipe) id: string, @Body(zod(rolesSchema)) body: z.infer<typeof rolesSchema>) {
    return this.members.setRoles(id, body.roles, body.rationale);
  }

  @Patch('members/:id/status')
  @RequirePermission('member.manage')
  @ApiZodBody(statusSchema)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zod(statusSchema)) body: z.infer<typeof statusSchema>) {
    return this.members.setStatus(id, body.status, body.rationale);
  }
}
