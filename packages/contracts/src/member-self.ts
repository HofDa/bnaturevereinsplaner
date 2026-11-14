import { z } from 'zod';
import { idSchema, languageSchema, membershipTypeSchema, statusSchema } from './common';
import {
  centsSchema,
  feeIntervalSchema,
  feeStatusSchema,
  fiscalYearSchema,
  paymentMethodSchema,
  positiveCentsSchema,
} from './finance';
import { memberFieldTypeSchema, memberFieldValueSchema } from './member-extras';

const i18nSchema = z.object({ de: z.string(), it: z.string() });
const organizationTypeSchema = z.enum(['ODV', 'APS', 'ETS', 'other']);

const ownConsentSummaryItemSchema = z.object({
  granted: z.boolean(),
  decidedOn: z.iso.date(),
});

export const ownMembershipDetailSchema = z.object({
  organization: z.object({
    id: idSchema,
    name: z.string(),
    organizationType: organizationTypeSchema,
  }),
  linked: z.boolean(),
  person: z
    .object({
      id: idSchema,
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      preferredLanguage: languageSchema,
    })
    .nullable(),
  membership: z
    .object({
      id: idSchema,
      membershipNumber: z.string(),
      membershipType: membershipTypeSchema,
      status: statusSchema,
      joinedAt: z.iso.date(),
      endedAt: z.iso.date().nullable(),
    })
    .nullable(),
  groups: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      description: z.string(),
      active: z.boolean(),
    }),
  ),
  consents: z.object({
    data_processing: ownConsentSummaryItemSchema.nullable(),
    photos: ownConsentSummaryItemSchema.nullable(),
  }),
  extraFields: z.array(
    z.object({
      id: idSchema,
      labelI18n: i18nSchema,
      type: memberFieldTypeSchema,
      value: memberFieldValueSchema,
    }),
  ),
});
export type OwnMembershipDetail = z.infer<typeof ownMembershipDetailSchema>;

export const ownFeeAssessmentSchema = z.object({
  id: idSchema,
  fiscalYear: fiscalYearSchema,
  dueDate: z.iso.date(),
  planName: z.string(),
  interval: feeIntervalSchema,
  amountCents: centsSchema,
  paidCents: centsSchema,
  openCents: centsSchema,
  status: feeStatusSchema,
  overdue: z.boolean(),
  exempt: z.boolean(),
  currency: z.literal('EUR'),
});
export type OwnFeeAssessment = z.infer<typeof ownFeeAssessmentSchema>;

export const ownFeePaymentSchema = z.object({
  id: idSchema,
  receiptNumber: z.number().int().positive(),
  paidOn: z.iso.date(),
  method: paymentMethodSchema,
  reference: z.string(),
  amountCents: positiveCentsSchema,
  currency: z.literal('EUR'),
  status: z.enum(['posted', 'reversed']),
  receiptAvailable: z.boolean(),
  allocations: z.array(
    z.object({
      assessmentId: idSchema,
      planName: z.string(),
      fiscalYear: fiscalYearSchema,
      amountCents: positiveCentsSchema,
    }),
  ),
});
export type OwnFeePayment = z.infer<typeof ownFeePaymentSchema>;

export const ownFeesSchema = z.object({
  linked: z.boolean(),
  hasMembership: z.boolean(),
  openCount: z.number().int().min(0),
  overdueCount: z.number().int().min(0),
  openCents: centsSchema,
  assessments: z.array(ownFeeAssessmentSchema),
  payments: z.array(ownFeePaymentSchema),
});
export type OwnFees = z.infer<typeof ownFeesSchema>;

export const memberDashboardSchema = z.object({
  organization: z.object({
    id: idSchema,
    name: z.string(),
    organizationType: organizationTypeSchema,
  }),
  linked: z.boolean(),
  personName: z.string().nullable(),
  membership: z
    .object({
      id: idSchema,
      membershipNumber: z.string(),
      membershipType: membershipTypeSchema,
      status: statusSchema,
      joinedAt: z.iso.date(),
    })
    .nullable(),
  fees: z.object({
    openCount: z.number().int().min(0),
    overdueCount: z.number().int().min(0),
    openCents: centsSchema,
  }),
  community: z.object({
    unreadNews: z.number().int().min(0),
    unreadPolls: z.number().int().min(0),
    unreadChat: z.number().int().min(0),
    openUnansweredPolls: z.number().int().min(0),
    openUnansweredSchedules: z.number().int().min(0),
  }),
  upcomingEvents: z.array(
    z.object({
      id: idSchema,
      titleI18n: i18nSchema,
      categoryNameI18n: i18nSchema,
      startAt: z.string(),
      endAt: z.string(),
      timezone: z.string(),
      location: z.string(),
      myRegistrationStatus: z.enum(['registered', 'waitlisted']).nullable(),
    }),
  ),
  myGroupCount: z.number().int().min(0),
  activeLoanCount: z.number().int().min(0),
  overdueLoanCount: z.number().int().min(0),
  nextAssignment: z
    .object({
      id: idSchema,
      task: z.string(),
      plannedStart: z.string(),
      plannedEnd: z.string(),
      eventTitle: i18nSchema.nullable(),
    })
    .nullable(),
});
export type MemberDashboard = z.infer<typeof memberDashboardSchema>;
