import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { CsrfExempt, Public, RateLimit, RequirePermission } from '../../common/decorators.js';
import { listQuery, multi } from '../../common/pagination.js';
import { ApiZodBody, ApiZodQuery, httpUrl, isoDate, requiredText, score1to5, text, uuid, zod } from '../../common/validation.js';
import { loadEnv } from '../../config/env.js';
import { AssessmentsService } from './assessments.service.js';
import { PortalService } from './portal.service.js';
import { VendorsService } from './vendors.service.js';

const STATUSES = ['draft', 'onboarding', 'assessment_required', 'under_review', 'approved', 'approved_with_conditions', 'rejected', 'active', 'offboarding', 'archived'] as const;
const LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
const ASSESSMENT_STATUSES = ['draft', 'submitted', 'under_review', 'returned_for_clarification', 'approved', 'closed'] as const;
const level1to5 = score1to5;

const vendorBody = z.object({
  name: requiredText(200),
  legalName: text(200).nullable().optional(),
  externalReference: text(100).nullable().optional(),
  serviceDescription: requiredText(2000),
  website: httpUrl(500).nullable().optional(),
  businessOwnerId: uuid.nullable().optional(),
  criticality: z.enum(LEVELS),
  dataClassification: z.enum(CLASSIFICATIONS),
  dataTypes: z.array(text(80)).max(30).default([]),
  personalDataAccess: z.boolean().default(false),
  accessLevel: z.enum(['none', 'limited', 'privileged', 'administrative']),
  businessDependency: level1to5.default(3),
  serviceImpact: level1to5.default(3),
  regions: z.array(text(80)).max(30).default([]),
  dependencies: text(2000).nullable().optional(),
  notes: text(5000).nullable().optional(),
  reassessmentFrequencyDays: z.number().int().min(30).max(1095).optional(),
});
const vendorUpdate = vendorBody.partial().extend({ version: z.number().int().positive(), rationale: text(2000).optional() });
const vendorList = listQuery(['name', 'updatedAt', 'createdAt', 'residualRiskScore', 'inherentRiskScore', 'nextAssessmentAt'], {
  status: multi(STATUSES),
  criticality: multi(LEVELS),
  tier: multi([...LEVELS, 'not_assessed']),
  reassessmentDue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
}, 'name');
const transitionBody = z.object({ to: z.enum(STATUSES), rationale: requiredText(2000) });
const contactBody = z.object({ name: requiredText(120), email: z.email().max(320), role: text(120).optional(), contactType: z.enum(['security', 'business', 'privacy', 'billing']).default('security') });
const assessmentBody = z.object({ templateId: uuid, dueDate: isoDate.nullable().optional(), assessorId: uuid.nullable().optional() });
const assessmentList = listQuery(['createdAt', 'dueDate', 'submittedAt', 'decidedAt'], { status: multi(ASSESSMENT_STATUSES), vendorId: uuid.optional() });
const responseItem = z.object({ questionId: uuid, answer: z.unknown().optional(), notApplicable: z.boolean().optional(), naRationale: text(2000).nullable().optional(), comments: text(5000).nullable().optional(), evidenceId: uuid.nullable().optional() });
const responsesBody = z.object({ responses: z.array(responseItem).min(1).max(300) });
const reviewBody = z.object({ reviews: z.array(z.object({ questionId: uuid, reviewerStatus: z.enum(['pending', 'accepted', 'insufficient', 'rejected']), reviewerNotes: text(5000).nullable().optional() })).min(1).max(300) });
const returnBody = z.object({ message: requiredText(5000) });
const notesBody = z.object({ internalNotes: text(20000) });
const decisionBody = z.object({ decision: z.enum(['approved', 'approved_with_conditions', 'rejected']), rationale: requiredText(5000), nextReviewAt: isoDate.nullable().optional() });
const inviteBody = z.object({ contactEmail: z.email().max(320) });
const questionSchema = z.object({
  questionKey: z.string().regex(/^[a-z0-9_.]{2,60}$/),
  questionText: requiredText(1000),
  category: requiredText(60),
  responseType: z.enum(['yes_no', 'single_choice', 'multiple_choice', 'text', 'number', 'date', 'file']),
  options: z.array(text(200)).max(30).default([]),
  required: z.boolean().default(true),
  weight: z.number().int().min(0).max(10).default(1),
  important: z.boolean().default(false),
  guidance: text(2000).optional(),
  evidenceRequired: z.boolean().default(false),
  expectedAnswer: z.unknown().optional(),
  dependsOnQuestionKey: z.string().max(60).optional(),
  dependsOnAnswer: z.unknown().optional(),
});
const templateBody = z.object({ baseTemplateId: uuid.optional(), key: z.string().regex(/^[a-z0-9-]{2,40}$/), name: requiredText(200), description: text(2000).optional(), questions: z.array(questionSchema).min(1).max(300) });

@ApiTags('vendors')
@Controller()
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly assessments: AssessmentsService,
    private readonly portal: PortalService,
  ) {}

  @Get('vendors')
  @RequirePermission('vendor.read')
  @ApiZodQuery(vendorList)
  list(@Query(zod(vendorList)) query: z.infer<typeof vendorList>) {
    return this.vendors.list(query);
  }

  @Post('vendors')
  @RequirePermission('vendor.create')
  @ApiZodBody(vendorBody)
  create(@Body(zod(vendorBody)) body: z.infer<typeof vendorBody>) {
    return this.vendors.create(body);
  }

  @Get('vendors/:id')
  @RequirePermission('vendor.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.get(id);
  }

  @Patch('vendors/:id')
  @RequirePermission('vendor.update')
  @ApiZodBody(vendorUpdate)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(vendorUpdate)) body: z.infer<typeof vendorUpdate>) {
    const { version, rationale, ...input } = body;
    return this.vendors.update(id, version, input, rationale);
  }

  @Post('vendors/:id/transition')
  @RequirePermission('vendor.lifecycle')
  @HttpCode(200)
  @ApiZodBody(transitionBody)
  transition(@Param('id', ParseUUIDPipe) id: string, @Body(zod(transitionBody)) body: z.infer<typeof transitionBody>) {
    return this.vendors.transition(id, body.to, body.rationale);
  }

  // Changing contacts is an edit of the vendor record; reading them is the separate, narrower permission.
  @Post('vendors/:id/contacts')
  @RequirePermission('vendor.update')
  @ApiZodBody(contactBody)
  addContact(@Param('id', ParseUUIDPipe) id: string, @Body(zod(contactBody)) body: z.infer<typeof contactBody>) {
    return this.vendors.addContact(id, body);
  }

  @Delete('vendors/:id/contacts/:contactId')
  @RequirePermission('vendor.update')
  @HttpCode(204)
  removeContact(@Param('id', ParseUUIDPipe) id: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.vendors.removeContact(id, contactId);
  }

  @Get('vendors/:id/assessments')
  @RequirePermission('vendor_assessment.read')
  async vendorAssessments(@Param('id', ParseUUIDPipe) id: string) {
    await this.vendors.get(id); // 404 for an unknown or other-tenant vendor, not an empty list
    return this.assessments.list({ page: 1, pageSize: 100, sort: 'createdAt', order: 'desc', vendorId: id });
  }

  @Post('vendors/:id/assessments')
  @RequirePermission('vendor_assessment.manage')
  @ApiZodBody(assessmentBody)
  createAssessment(@Param('id', ParseUUIDPipe) id: string, @Body(zod(assessmentBody)) body: z.infer<typeof assessmentBody>) {
    return this.assessments.create(id, body);
  }

  // ── Questionnaire templates ──
  @Get('questionnaires')
  @RequirePermission('vendor_assessment.read')
  templates(@Query('purpose') purpose?: string) {
    return this.assessments.templates(purpose === 'ai_system' ? 'ai_system' : 'vendor_security');
  }

  @Get('questionnaires/:id')
  @RequirePermission('vendor_assessment.read')
  template(@Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.template(id);
  }

  @Post('questionnaires')
  @RequirePermission('questionnaire.manage')
  @ApiZodBody(templateBody)
  createTemplate(@Body(zod(templateBody)) body: z.infer<typeof templateBody>) {
    return this.assessments.createTemplateVersion({ ...body, purpose: 'vendor_security', questions: body.questions as never });
  }

  // ── Assessments ──
  @Get('assessments')
  @RequirePermission('vendor_assessment.read')
  @ApiZodQuery(assessmentList)
  listAssessments(@Query(zod(assessmentList)) query: z.infer<typeof assessmentList>) {
    return this.assessments.list(query);
  }

  @Get('assessments/:id')
  @RequirePermission('vendor_assessment.read')
  getAssessment(@Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.get(id);
  }

  @Post('assessments/:id/responses')
  @RequirePermission('vendor_assessment.manage')
  @HttpCode(200)
  @ApiZodBody(responsesBody)
  saveResponses(@Param('id', ParseUUIDPipe) id: string, @Body(zod(responsesBody)) body: z.infer<typeof responsesBody>) {
    return this.assessments.saveResponses(id, body.responses);
  }

  @Post('assessments/:id/submit')
  @RequirePermission('vendor_assessment.manage')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.submit(id);
  }

  @Post('assessments/:id/review')
  @RequirePermission('vendor_assessment.review')
  @HttpCode(200)
  @ApiZodBody(reviewBody)
  review(@Param('id', ParseUUIDPipe) id: string, @Body(zod(reviewBody)) body: z.infer<typeof reviewBody>) {
    return this.assessments.reviewResponses(id, body.reviews);
  }

  @Post('assessments/:id/return')
  @RequirePermission('vendor_assessment.review')
  @HttpCode(200)
  @ApiZodBody(returnBody)
  returnForClarification(@Param('id', ParseUUIDPipe) id: string, @Body(zod(returnBody)) body: z.infer<typeof returnBody>) {
    return this.assessments.returnForClarification(id, body.message);
  }

  @Put('assessments/:id/internal-notes')
  @RequirePermission('vendor_assessment.review')
  @ApiZodBody(notesBody)
  notes(@Param('id', ParseUUIDPipe) id: string, @Body(zod(notesBody)) body: z.infer<typeof notesBody>) {
    return this.assessments.setInternalNotes(id, body.internalNotes);
  }

  @Post('assessments/:id/decision')
  @RequirePermission('vendor_assessment.decide')
  @HttpCode(200)
  @ApiZodBody(decisionBody)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body(zod(decisionBody)) body: z.infer<typeof decisionBody>) {
    return this.assessments.decide(id, body);
  }

  @Post('assessments/:id/invitations')
  @RequirePermission('vendor_portal.manage')
  @ApiZodBody(inviteBody)
  invite(@Param('id', ParseUUIDPipe) id: string, @Body(zod(inviteBody)) body: z.infer<typeof inviteBody>) {
    return this.portal.invite(id, body.contactEmail);
  }

  @Delete('assessments/:id/invitations/:invitationId')
  @RequirePermission('vendor_portal.manage')
  @HttpCode(204)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Param('invitationId', ParseUUIDPipe) invitationId: string) {
    return this.portal.revoke(id, invitationId);
  }
}

/** Public vendor-portal routes: token authentication only (no cookie, so no CSRF), rate limited. */
@ApiTags('vendor-portal')
@Controller('vendor-portal/:token')
export class VendorPortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @Public()
  @RateLimit('login')
  view(@Param('token') token: string) {
    return this.portal.view(token);
  }

  @Put('responses')
  @Public()
  @CsrfExempt()
  @RateLimit('login')
  @ApiZodBody(responsesBody)
  save(@Param('token') token: string, @Body(zod(responsesBody)) body: z.infer<typeof responsesBody>) {
    return this.portal.save(token, body.responses);
  }

  @Post('evidence')
  @Public()
  @CsrfExempt()
  @RateLimit('login')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: loadEnv().MAX_UPLOAD_SIZE_MB * 1024 * 1024, files: 1 } }))
  upload(@Param('token') token: string, @UploadedFile() file: Express.Multer.File, @Body('title') title?: string) {
    return this.portal.upload(token, file, (title ?? file?.originalname ?? 'Vendor evidence').slice(0, 200));
  }

  @Post('submit')
  @Public()
  @CsrfExempt()
  @RateLimit('login')
  @HttpCode(200)
  submit(@Param('token') token: string) {
    return this.portal.submit(token);
  }
}
