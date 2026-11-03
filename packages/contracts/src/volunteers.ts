import { z } from 'zod';
import { idSchema, patchSchema } from './common';

const date = z.iso.date();
const text = (max = 200) => z.string().trim().max(max);
const instant = z.iso.datetime({ offset: true });
export const volunteerTypeSchema = z.enum(['regular', 'occasional']);
export type VolunteerType = z.infer<typeof volunteerTypeSchema>;
export const engagementStatusSchema = z.enum(['active', 'paused', 'ended']);
export const assignmentRoleSchema = z.enum(['helper', 'lead']);
export const assignmentStatusSchema = z.enum(['planned', 'completed', 'cancelled']);
export const timeEntryStatusSchema = z.enum(['draft', 'submitted', 'confirmed', 'rejected']);
export const timeEntrySourceSchema = z.enum(['manual', 'attendance']);
export const registerSectionSchema = z.enum(['main', 'occasional']);
export type RegisterSection = z.infer<typeof registerSectionSchema>;
export const registerEntryTypeSchema = z.enum(['admission', 'exit', 'correction']);
export const registerStateSchema = z.enum([
  'registered',
  'pending_admission',
  'pending_exit',
  'pending_correction',
  'closed',
]);
export const snapshotStatusSchema = z.enum([
  'signature_pending',
  'signature_imported',
  'verified',
  'verification_failed',
]);
export const insuranceTypeSchema = z.enum(['accident', 'illness', 'liability']);
export type InsuranceType = z.infer<typeof insuranceTypeSchema>;
export const insuranceTypes = insuranceTypeSchema.options;
export const insuredGroupSchema = z.enum(['regular', 'occasional', 'all', 'named']);
export const policyStatusSchema = z.enum(['draft', 'active', 'expired', 'cancelled']);
// Ordered from strongest to weakest indication. None of them is a legal coverage confirmation.
export const coverageStatusSchema = z.enum(['possibly_covered', 'assigned', 'unclear', 'none']);
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export const focusAreasSchema = z.array(text(60).min(1)).max(12).default([]);

// Art. 3 c. 4 D.M. 6.10.2021: identification, residence/domicile and start/end of activity.
export const registerDataSchema = z
  .object({
    fiscalCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(16)
      .refine((v) => !v || /^[A-Z0-9]{16}$/.test(v), 'invalidFiscalCode')
      .default(''),
    dateOfBirth: date.nullable().default(null),
    birthPlace: text(120).default(''),
    street: text().default(''),
    postalCode: text(20).default(''),
    city: text(100).default(''),
    country: z.string().trim().length(2).default('IT'),
    domicile: text(300).default(''),
  })
  .strict();
export type RegisterData = z.infer<typeof registerDataSchema>;
// Partial updates never reset fields that were not sent.
export const registerDataPatchSchema = patchSchema(registerDataSchema);
export type RegisterIdentity = RegisterData & { firstName: string; lastName: string };
export function registerDataIssues(data: RegisterIdentity): string[] {
  const issues: string[] = [];
  const identified =
    !!data.fiscalCode ||
    (!!data.firstName.trim() &&
      !!data.lastName.trim() &&
      !!data.dateOfBirth &&
      !!data.birthPlace.trim());
  if (!identified) issues.push('registerIdentificationMissing');
  const residence = !!data.street.trim() && !!data.city.trim();
  if (!residence && !data.domicile.trim()) issues.push('registerResidenceMissing');
  return issues;
}
const newPersonSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.union([z.email().max(254), z.literal('')]).default(''),
    phone: text(40).default(''),
  })
  .strict();
export const engagementInputSchema = z
  .object({
    personId: idSchema.optional(),
    person: newPersonSchema.optional(),
    volunteerType: volunteerTypeSchema,
    startedOn: date,
    focusAreas: focusAreasSchema,
    activity: text(500).default(''),
    notes: text(2000).default(''),
    registerData: registerDataPatchSchema.optional(),
  })
  .strict()
  .refine((v) => !!v.personId !== !!v.person, { path: ['personId'], message: 'personRequired' });
export type EngagementInput = z.infer<typeof engagementInputSchema>;
export const engagementPatchSchema = z
  .object({
    version: z.number().int().min(1),
    status: z.enum(['active', 'paused']).optional(),
    focusAreas: focusAreasSchema.optional(),
    activity: text(500).optional(),
    notes: text(2000).optional(),
    registerData: registerDataPatchSchema.optional(),
  })
  .strict();
export const engagementEndSchema = z
  .object({ version: z.number().int().min(1), endedOn: date, reason: text(500).min(1) })
  .strict();
export const engagementHistorySchema = z.object({
  id: idSchema,
  version: z.number().int(),
  action: z.string(),
  changes: z.record(z.string(), z.unknown()),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});
export const volunteerSummarySchema = z.object({
  id: idSchema,
  personId: idSchema,
  firstName: z.string(),
  lastName: z.string(),
  isMember: z.boolean(),
  volunteerType: volunteerTypeSchema,
  status: engagementStatusSchema,
  startedOn: z.string(),
  endedOn: z.string().nullable(),
  focusAreas: z.array(z.string()),
  activity: z.string(),
  registerState: registerStateSchema,
  coverageStatus: coverageStatusSchema,
  plannedAssignments: z.number().int(),
  confirmedMinutes: z.number().int(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type VolunteerSummary = z.infer<typeof volunteerSummarySchema>;
export const volunteerDetailSchema = volunteerSummarySchema.extend({
  notes: z.string(),
  // Only present for roles that may read register-relevant personal data.
  registerData: registerDataSchema.nullable(),
  registerIssues: z.array(z.string()),
  history: z.array(engagementHistorySchema),
  events: z.array(
    z.object({
      eventOccurrenceId: idSchema,
      titleI18n: z.object({ de: z.string(), it: z.string() }),
      startAt: z.string(),
      relation: z.enum(['assignment', 'registration']),
      status: z.string(),
    }),
  ),
  coverage: z.object({
    status: coverageStatusSchema,
    reasons: z.array(z.string()),
    gaps: z.array(
      z.object({ type: insuranceTypeSchema, from: z.string(), to: z.string().nullable() }),
    ),
  }),
});
export type VolunteerDetail = z.infer<typeof volunteerDetailSchema>;
export const volunteerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(''),
  volunteerType: volunteerTypeSchema.optional(),
  status: engagementStatusSchema.optional(),
  coverage: coverageStatusSchema.optional(),
});
export type VolunteerQuery = z.infer<typeof volunteerQuerySchema>;

export const assignmentInputSchema = z
  .object({
    engagementId: idSchema,
    eventOccurrenceId: idSchema.nullable().default(null),
    role: assignmentRoleSchema.default('helper'),
    task: text(500).min(1),
    plannedStart: instant,
    plannedEnd: instant,
    responsibleUserId: idSchema.nullable().default(null),
    project: text(200).default(''),
  })
  .strict()
  .refine((v) => v.plannedEnd > v.plannedStart, {
    path: ['plannedEnd'],
    message: 'endBeforeStart',
  });
export const assignmentPatchSchema = z
  .object({
    version: z.number().int().min(1),
    role: assignmentRoleSchema.optional(),
    task: text(500).min(1).optional(),
    plannedStart: instant.optional(),
    plannedEnd: instant.optional(),
    responsibleUserId: idSchema.nullable().optional(),
    project: text(200).optional(),
    status: assignmentStatusSchema.optional(),
  })
  .strict();
export const assignmentSchema = z.object({
  id: idSchema,
  engagementId: idSchema,
  personId: idSchema,
  volunteerName: z.string(),
  volunteerType: volunteerTypeSchema,
  eventOccurrenceId: idSchema.nullable(),
  eventTitleI18n: z.object({ de: z.string(), it: z.string() }).nullable(),
  role: assignmentRoleSchema,
  task: z.string(),
  plannedStart: z.string(),
  plannedEnd: z.string(),
  responsibleUserId: idSchema.nullable(),
  responsibleName: z.string().nullable(),
  project: z.string(),
  status: assignmentStatusSchema,
  coverageStatus: coverageStatusSchema,
  version: z.number().int(),
});
export type VolunteerAssignment = z.infer<typeof assignmentSchema>;
export const assignmentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  engagementId: idSchema.optional(),
  eventOccurrenceId: idSchema.optional(),
  status: assignmentStatusSchema.optional(),
  from: date.optional(),
  to: date.optional(),
});

export const timeEntryInputSchema = z
  .object({
    engagementId: idSchema,
    assignmentId: idSchema.nullable().default(null),
    actualStart: instant,
    actualEnd: instant,
    breakMinutes: z.number().int().min(0).max(1440).default(0),
    description: text(1000).default(''),
    project: text(200).default(''),
    submit: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.actualEnd <= v.actualStart)
      ctx.addIssue({ code: 'custom', path: ['actualEnd'], message: 'endBeforeStart' });
    else if (netMinutes(v.actualStart, v.actualEnd, v.breakMinutes) <= 0)
      ctx.addIssue({ code: 'custom', path: ['breakMinutes'], message: 'breakTooLong' });
    else if (Date.parse(v.actualEnd) - Date.parse(v.actualStart) > 24 * 3600_000)
      ctx.addIssue({ code: 'custom', path: ['actualEnd'], message: 'timeEntryTooLong' });
  });
export const timeEntryCorrectionSchema = z
  .object({
    version: z.number().int().min(1),
    actualStart: instant.optional(),
    actualEnd: instant.optional(),
    breakMinutes: z.number().int().min(0).max(1440).optional(),
    description: text(1000).optional(),
    project: text(200).optional(),
    reason: text(500).min(1),
  })
  .strict();
export const timeEntryDecisionSchema = z
  .object({
    version: z.number().int().min(1),
    decision: z.enum(['submit', 'confirm', 'reject']),
    reason: text(500).default(''),
  })
  .strict();
export const timeEntrySchema = z.object({
  id: idSchema,
  engagementId: idSchema,
  volunteerName: z.string(),
  assignmentId: idSchema.nullable(),
  eventTitleI18n: z.object({ de: z.string(), it: z.string() }).nullable(),
  actualStart: z.string(),
  actualEnd: z.string(),
  breakMinutes: z.number().int(),
  minutes: z.number().int(),
  description: z.string(),
  project: z.string(),
  status: timeEntryStatusSchema,
  source: timeEntrySourceSchema,
  confirmedByName: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  version: z.number().int(),
  history: z
    .array(
      z.object({
        version: z.number().int(),
        action: z.string(),
        reason: z.string(),
        previous: z.record(z.string(), z.unknown()),
        actorName: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .default([]),
});
export type VolunteerTimeEntry = z.infer<typeof timeEntrySchema>;
export const timeEntryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  engagementId: idSchema.optional(),
  status: timeEntryStatusSchema.optional(),
  from: date.optional(),
  to: date.optional(),
  project: z.string().trim().max(200).optional(),
});
export const timeExportQuerySchema = timeEntryQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(['csv', 'pdf']), language: z.enum(['de', 'it']).default('de') });
export const timeTotalsSchema = z.object({
  confirmedMinutes: z.number().int(),
  pendingMinutes: z.number().int(),
  entries: z.number().int(),
});

// Net working time; attendance alone never produces minutes.
export function netMinutes(start: string, end: string, breakMinutes: number) {
  return Math.floor((Date.parse(end) - Date.parse(start)) / 60_000) - breakMinutes;
}
export function confirmedTotal(entries: { status: string; minutes: number }[]) {
  return entries.reduce((sum, e) => (e.status === 'confirmed' ? sum + e.minutes : sum), 0);
}
export const formatMinutes = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

export const registerEntryInputSchema = z
  .object({
    engagementId: idSchema,
    entryType: registerEntryTypeSchema,
    reason: text(500).default(''),
    correctsEntryId: idSchema.nullable().default(null),
  })
  .strict()
  .refine((v) => v.entryType !== 'correction' || (!!v.correctsEntryId && !!v.reason), {
    path: ['reason'],
    message: 'correctionReasonRequired',
  });
export const registerEntryDataSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  fiscalCode: z.string(),
  dateOfBirth: z.string().nullable(),
  birthPlace: z.string(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  country: z.string(),
  domicile: z.string(),
  startedOn: z.string(),
  endedOn: z.string().nullable(),
});
export type RegisterEntryData = z.infer<typeof registerEntryDataSchema>;
export const registerEntrySchema = z.object({
  id: idSchema,
  section: registerSectionSchema,
  entryNumber: z.number().int(),
  engagementId: idSchema,
  entryType: registerEntryTypeSchema,
  effectiveDate: z.string(),
  correctsEntryId: idSchema.nullable(),
  data: registerEntryDataSchema,
  reason: z.string(),
  recordedByName: z.string().nullable(),
  recordedAt: z.string(),
  previousHash: z.string().nullable(),
  entryHash: z.string(),
});
export type RegisterEntry = z.infer<typeof registerEntrySchema>;
export const registerPendingSchema = z.object({
  engagementId: idSchema,
  name: z.string(),
  section: registerSectionSchema,
  action: registerEntryTypeSchema,
  issues: z.array(z.string()),
  correctsEntryId: idSchema.nullable(),
});
export const registerViewSchema = z.object({
  section: registerSectionSchema,
  current: z.array(
    z.object({
      engagementId: idSchema,
      entryNumber: z.number().int(),
      data: registerEntryDataSchema,
      lastEntryId: idSchema,
    }),
  ),
  entries: z.array(registerEntrySchema),
  pending: z.array(registerPendingSchema),
});
export const registerSettingsSchema = z
  .object({
    occasionalSection: z.boolean().default(true),
    signatureIntervalDays: z.number().int().min(1).max(366).default(365),
    signatureProcedure: text(500).default(''),
    insuranceRetentionYears: z.number().int().min(10).max(100).default(10),
    registerRetentionYears: z.number().int().min(10).max(100).default(10),
    expiryWarningDays: z.number().int().min(1).max(365).default(60),
    legalApprovalReference: text(300).default(''),
    legalApprovedOn: date.nullable().default(null),
  })
  .strict();
export type RegisterSettings = z.infer<typeof registerSettingsSchema>;
export const registerSettingsResponseSchema = registerSettingsSchema.extend({
  version: z.number().int(),
});
export const registerSettingsPatchSchema = registerSettingsSchema
  .partial()
  .extend({ version: z.number().int().min(0) })
  .strict();

export const snapshotInputSchema = z.object({ cutoffDate: date }).strict();
export const signatureImportMetadataSchema = z
  .object({ kind: z.enum(['signed', 'timestamp']), filename: z.string().min(1).max(200) })
  .strict();
export const signatureVerificationSchema = z
  .object({
    version: z.number().int().min(1),
    result: z.enum(['verified', 'verification_failed']),
    tool: text(200).min(1),
    signer: text(200).default(''),
    timestampTime: instant.nullable().default(null),
    notes: text(2000).default(''),
  })
  .strict();
export const snapshotSchema = z.object({
  id: idSchema,
  snapshotNumber: z.number().int(),
  cutoffDate: z.string(),
  status: snapshotStatusSchema,
  sha256: z.string(),
  payloadSha256: z.string(),
  previousSnapshotId: idSchema.nullable(),
  previousSha256: z.string().nullable(),
  mainCount: z.number().int(),
  occasionalCount: z.number().int(),
  mainLastNumber: z.number().int(),
  occasionalLastNumber: z.number().int(),
  documentId: idSchema,
  signedDocumentId: idSchema.nullable(),
  timestampDocumentId: idSchema.nullable(),
  technicalChecks: z.record(z.string(), z.unknown()),
  verification: z.record(z.string(), z.unknown()),
  legallyApproved: z.boolean(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type RegisterSnapshot = z.infer<typeof snapshotSchema>;
export const snapshotValidationSchema = z.object({
  cutoffDate: z.string(),
  ready: z.boolean(),
  pending: z.array(registerPendingSchema),
  invalid: z.array(
    z.object({ engagementId: idSchema, name: z.string(), issues: z.array(z.string()) }),
  ),
  mainCount: z.number().int(),
  occasionalCount: z.number().int(),
});

export const policyInputSchema = z
  .object({
    insurer: text(200).min(1),
    policyNumber: text(100).min(1),
    coverageTypes: z.array(insuranceTypeSchema).min(1).max(3),
    startsOn: date,
    endsOn: date,
    insuredGroup: insuredGroupSchema.default('all'),
    insuredGroupDescription: text(500).default(''),
    status: policyStatusSchema.default('active'),
    notes: text(2000).default(''),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, { path: ['endsOn'], message: 'endBeforeStart' })
  .refine((v) => new Set(v.coverageTypes).size === v.coverageTypes.length, {
    path: ['coverageTypes'],
    message: 'validation',
  });
export const policyPatchSchema = z
  .object({
    version: z.number().int().min(1),
    insurer: text(200).min(1).optional(),
    policyNumber: text(100).min(1).optional(),
    coverageTypes: z.array(insuranceTypeSchema).min(1).max(3).optional(),
    startsOn: date.optional(),
    endsOn: date.optional(),
    insuredGroup: insuredGroupSchema.optional(),
    insuredGroupDescription: text(500).optional(),
    status: policyStatusSchema.optional(),
    notes: text(2000).optional(),
  })
  .strict();
export const policySchema = z.object({
  id: idSchema,
  insurer: z.string(),
  policyNumber: z.string(),
  coverageTypes: z.array(insuranceTypeSchema),
  startsOn: z.string(),
  endsOn: z.string(),
  insuredGroup: insuredGroupSchema,
  insuredGroupDescription: z.string(),
  status: policyStatusSchema,
  notes: z.string(),
  coverageCount: z.number().int(),
  documentCount: z.number().int(),
  lastNotifiedOn: z.string().nullable(),
  expiresInDays: z.number().int(),
  retainUntil: z.string(),
  version: z.number().int(),
});
export type InsurancePolicy = z.infer<typeof policySchema>;
export const coverageInputSchema = z
  .object({
    engagementIds: z.array(idSchema).min(1).max(500),
    coveredFrom: date,
    coveredTo: date.nullable().default(null),
    notes: text(500).default(''),
  })
  .strict()
  .refine((v) => !v.coveredTo || v.coveredTo >= v.coveredFrom, {
    path: ['coveredTo'],
    message: 'endBeforeStart',
  });
export const coverageEndSchema = z.object({ coveredTo: date, reason: text(500).min(1) }).strict();
export const coverageSchema = z.object({
  id: idSchema,
  policyId: idSchema,
  engagementId: idSchema,
  volunteerName: z.string(),
  volunteerType: volunteerTypeSchema,
  coveredFrom: z.string(),
  coveredTo: z.string().nullable(),
  notes: z.string(),
  notifiedOn: z.string().nullable(),
});
export const notificationInputSchema = z
  .object({
    policyId: idSchema,
    notifiedOn: date,
    method: text(200).min(1),
    engagementIds: z.array(idSchema).min(1).max(500),
    listSha256: z.string().regex(/^[0-9a-f]{64}$/),
    notes: text(1000).default(''),
  })
  .strict();
export const notificationSchema = z.object({
  id: idSchema,
  policyId: idSchema,
  notifiedOn: z.string(),
  method: z.string(),
  listSha256: z.string(),
  notes: z.string(),
  personCount: z.number().int(),
  proofDocumentIds: z.array(idSchema),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export const notificationListQuerySchema = z.object({
  format: z.enum(['csv', 'pdf', 'json']).default('json'),
  language: z.enum(['de', 'it']).default('de'),
  on: date.optional(),
});
export const coverageOverviewSchema = z.object({
  date: z.string(),
  items: z.array(
    z.object({
      engagementId: idSchema,
      name: z.string(),
      volunteerType: volunteerTypeSchema,
      status: coverageStatusSchema,
      reasons: z.array(z.string()),
      gaps: z.array(
        z.object({ type: insuranceTypeSchema, from: z.string(), to: z.string().nullable() }),
      ),
    }),
  ),
  expiring: z.array(policySchema),
});

type Period = { from: string; to: string | null };
const dayAfter = (value: string) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const dayBefore = (value: string) =>
  new Date(Date.parse(`${value}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
// Inclusive date ranges; null means open-ended.
export function uncoveredPeriods(window: Period, periods: Period[]): Period[] {
  const sorted = periods
    .filter(
      (p) => (window.to === null || p.from <= window.to) && (p.to === null || p.to >= window.from),
    )
    .sort((a, b) => a.from.localeCompare(b.from));
  const gaps: Period[] = [];
  let cursor: string | null = window.from;
  for (const p of sorted) {
    if (cursor === null) break;
    if (p.from > cursor) gaps.push({ from: cursor, to: dayBefore(p.from) });
    if (p.to === null) cursor = null;
    else if (p.to >= cursor) cursor = dayAfter(p.to);
  }
  if (cursor !== null && (window.to === null || cursor <= window.to))
    gaps.push({ from: cursor, to: window.to });
  return gaps;
}
export type CoverageInput = {
  date: string;
  engagement: { volunteerType: VolunteerType; startedOn: string; endedOn: string | null };
  registeredOn: string | null;
  coverages: {
    coveredFrom: string;
    coveredTo: string | null;
    notified: boolean;
    policy: {
      status: string;
      startsOn: string;
      endsOn: string;
      coverageTypes: InsuranceType[];
      hasDocument: boolean;
    };
  }[];
};
// Indicative assessment only; the contract alone decides whether protection exists.
export function assessCoverage(input: CoverageInput) {
  const reasons = new Set<string>();
  const window = {
    from: input.engagement.startedOn,
    to:
      input.engagement.endedOn ??
      (input.date > input.engagement.startedOn ? input.date : input.engagement.startedOn),
  };
  if (!input.coverages.length)
    return {
      status: 'none' as CoverageStatus,
      reasons: ['coverageNoAssignment'],
      gaps: insuranceTypes.map((type) => ({ type, from: window.from, to: window.to })),
    };
  const gaps: { type: InsuranceType; from: string; to: string | null }[] = [];
  let typesToday = true;
  for (const type of insuranceTypes) {
    const periods = input.coverages
      .filter((c) => c.policy.status === 'active' && c.policy.coverageTypes.includes(type))
      .map((c) => ({
        from: c.coveredFrom > c.policy.startsOn ? c.coveredFrom : c.policy.startsOn,
        to: c.coveredTo === null || c.coveredTo > c.policy.endsOn ? c.policy.endsOn : c.coveredTo,
      }))
      .filter((p) => p.to >= p.from);
    for (const gap of uncoveredPeriods(window, periods)) gaps.push({ type, ...gap });
    if (!periods.some((p) => p.from <= input.date && (p.to === null || p.to >= input.date)))
      typesToday = false;
  }
  if (input.coverages.some((c) => c.policy.status !== 'active'))
    reasons.add('coveragePolicyInactive');
  if (!typesToday) reasons.add('coverageTypeMissing');
  if (gaps.length) reasons.add('coverageGaps');
  if (!typesToday) return { status: 'unclear' as CoverageStatus, reasons: [...reasons], gaps };
  const formal: string[] = [];
  if (input.coverages.some((c) => !c.policy.hasDocument))
    formal.push('coveragePolicyDocumentMissing');
  if (!input.coverages.some((c) => c.notified)) formal.push('coverageNotNotified');
  // Art. 2 c. 4 D.M. 6.10.2021: protection for later registered volunteers starts at 24:00 of the registration day.
  if (input.engagement.volunteerType === 'regular') {
    if (!input.registeredOn) formal.push('coverageNotRegistered');
    else if (input.registeredOn >= input.date) formal.push('coverageRegistrationSameDay');
  }
  for (const r of formal) reasons.add(r);
  return {
    status: (formal.length || gaps.length ? 'assigned' : 'possibly_covered') as CoverageStatus,
    reasons: [...reasons],
    gaps,
  };
}

/** Self-reported hours: always submitted for confirmation by the club. */
export const ownTimeEntryInputSchema = z
  .object({
    engagementId: idSchema,
    assignmentId: idSchema.nullable().default(null),
    actualStart: z.iso.datetime({ offset: true }),
    actualEnd: z.iso.datetime({ offset: true }),
    breakMinutes: z.number().int().min(0).max(1440).default(0),
    description: z.string().trim().max(1000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.actualEnd <= v.actualStart)
      ctx.addIssue({ code: 'custom', path: ['actualEnd'], message: 'endBeforeStart' });
    else if (netMinutes(v.actualStart, v.actualEnd, v.breakMinutes) <= 0)
      ctx.addIssue({ code: 'custom', path: ['breakMinutes'], message: 'breakTooLong' });
  });
export const ownVolunteeringSchema = z.object({
  engagements: z.array(
    z.object({
      id: idSchema,
      status: z.string(),
      startedOn: z.string(),
      endedOn: z.string().nullable(),
      activity: z.string(),
    }),
  ),
  assignments: z.array(
    z.object({
      id: idSchema,
      engagementId: idSchema,
      task: z.string(),
      plannedStart: z.string(),
      plannedEnd: z.string(),
      status: z.string(),
      eventTitle: z.object({ de: z.string(), it: z.string() }).nullable(),
    }),
  ),
  timeEntries: z.array(
    z.object({
      id: idSchema,
      engagementId: idSchema,
      assignmentId: idSchema.nullable(),
      actualStart: z.string(),
      actualEnd: z.string(),
      minutes: z.number().int(),
      description: z.string(),
      status: z.string(),
    }),
  ),
  confirmedMinutesThisYear: z.number().int(),
  pendingMinutes: z.number().int(),
});
export type OwnVolunteering = z.infer<typeof ownVolunteeringSchema>;
