import { QueryClient } from '@tanstack/react-query';
import i18n from './i18n';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      retry: (n, error) =>
        n < 1 && !(error instanceof ApiError && [401, 403, 404].includes(error.status)),
      refetchOnWindowFocus: true,
    },
  },
});
let organizationId: string | undefined;
export function setOrganization(id: string | undefined) {
  organizationId = id;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string[]>,
  ) {
    super(code);
  }
}
async function apiResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(organizationId ? { 'X-Organization-Id': organizationId } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      queryClient.clear();
      window.dispatchEvent(new Event('bnature-session-expired'));
    }
    throw new ApiError(response.status, body.error?.code ?? 'INTERNAL_ERROR', body.error?.fields);
  }
  return response;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await apiResponse(path, options)).json() as Promise<T>;
}
export async function downloadPrivateFile(path: string, filename: string): Promise<void> {
  const response = await apiResponse(path);
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const keys: Record<string, string> = {
      UNAUTHENTICATED: 'sessionExpired',
      EVENT_FULL: 'eventErrorFull',
      EVENT_ALREADY_REGISTERED: 'eventErrorRegistered',
      EVENT_REGISTRATION_CLOSED: 'eventErrorDeadline',
      EVENT_CAPACITY_BELOW_REGISTRATIONS: 'eventErrorCapacity',
      EVENT_FINAL: 'eventErrorFinal',
      EVENT_SERIES_HAS_REGISTRATIONS: 'eventErrorSeriesRegistrations',
      EVENT_WAITLIST_ORDER: 'eventErrorWaitlist',
      EVENT_WAITLIST_AUTOMATIC: 'eventErrorAutomaticWaitlist',
      EVENT_ORGANIZER_INVALID: 'eventErrorOrganizer',
      EVENT_PERSON_REQUIRED: 'eventErrorPerson',
      EVENT_MEMBERS_ONLY: 'eventErrorMembers',
      EVENT_NOT_PUBLISHED: 'eventErrorNotPublished',
      EVENT_CATEGORY_INACTIVE: 'ledgerInactiveReference',
      EVENT_COORDINATES: 'eventErrorCoordinates',
      EVENT_DEADLINE: 'eventErrorDeadlineDate',
      EVENT_OFFLINE_UNAVAILABLE: 'eventErrorNotPublished',
      EVENT_HAS_REGISTRATIONS: 'eventErrorCapacity',
      EVENT_NO_WAITLIST: 'eventErrorFull',
      EVENT_REGISTER_AGAIN: 'eventErrorRegistered',
      EVENT_USE_CANCEL: 'eventErrorFinal',
      eventNonexistentTime: 'eventNonexistentTime',
      eventSeriesLimit: 'eventSeriesLimit',
      eventInvalidRecurrence: 'eventInvalidRecurrence',
      eventBoundedSeries: 'eventBoundedSeries',
      eventDurationLimit: 'eventDurationLimit',
      endBeforeStart: 'endBeforeStart',
      FORBIDDEN: 'forbidden',
      CONFLICT: 'conflict',
      INVALID_RELATION: 'invalidRelation',
      VALIDATION_ERROR: 'validation',
      INVALID_ORIGIN: 'invalidOrigin',
      LAST_ADMIN: 'lastAdmin',
      RATE_LIMITED: 'rateLimited',
      MAIL_DISABLED: 'mailDisabled',
      MAIL_PREVIEW_CHANGED: 'mailPreviewChanged',
      MAIL_EVENT_UNAVAILABLE: 'mailEventUnavailable',
      MAIL_TOO_MANY: 'mailTooMany',
      MAIL_KIND_UNAVAILABLE: 'mailKindUnavailable',
      COMMUNITY_FROZEN: 'communityFrozen',
      COMMUNITY_CLOSED: 'communityClosed',
      COMMUNITY_DEADLINE: 'communityDeadline',
      NOT_FOUND: 'notFound',
      FEE_PLAN_EXISTS: 'financePlanExists',
      OVERPAYMENT: 'financeOverpayment',
      IDEMPOTENCY_MISMATCH: 'financeIdempotencyMismatch',
      STALE_VERSION: 'financeStaleVersion',
      PLAN_IN_USE: 'financePlanInUse',
      PLAN_INACTIVE: 'financePlanInactive',
      FEE_CATEGORY_MISMATCH: 'financeCategoryMismatch',
      INVALID_REDUCTION: 'financeInvalidReduction',
      ASSESSMENT_EXISTS: 'financeAssessmentExists',
      PAYMENT_REFERENCE_EXISTS: 'financeReferenceExists',
      REMINDER_NOT_DUE: 'financeReminderNotDue',
      NAME_EXISTS: 'ledgerNameExists',
      FISCAL_YEAR_EXISTS: 'ledgerYearExists',
      FISCAL_YEAR_NOT_FOUND: 'ledgerNoYear',
      INVALID_FISCAL_DATES: 'endBeforeStart',
      FISCAL_YEARS_OVERLAP: 's22YearOverlap',
      MAPPING_EXISTS: 's22MappingExists',
      INVALID_ETS_POSITION: 's22PositionInvalid',
      FEE_CATEGORY_REQUIRED: 'ledgerBookingSetup',
      EXPORT_TOO_LARGE: 's22ExportTooLarge',
      LEDGER_BOOKING_REQUIRED: 's22BookingRequired',
      PREVIOUS_YEAR_OPEN: 'ledgerPreviousYearOpen',
      BALANCE_OUT_OF_RANGE: 'ledgerBalanceOutOfRange',
      NEGATIVE_CASH: 'ledgerNegativeCash',
      FISCAL_YEAR_CLOSED: 'ledgerYearAlreadyClosed',
      FISCAL_YEAR_NOT_OPEN: 'ledgerYearNotOpen',
      INACTIVE_REFERENCE: 'ledgerInactiveReference',
      MEMBERSHIP_FEE_VIA_PAYMENT: 'ledgerFeeViaPayment',
      REVERSAL_BEFORE_ORIGINAL: 'ledgerReversalBeforeOriginal',
      NOT_REVERSIBLE: 'ledgerNotReversible',
      ALREADY_REVERSED: 'ledgerAlreadyReversed',
      USE_PAYMENT_REVERSAL: 'ledgerUsePaymentReversal',
      PAYMENT_REVERSED: 'ledgerPaymentAlreadyReversed',
      PAYMENT_ALREADY_BOOKED: 'ledgerPaymentAlreadyBooked',
      BOOKING_CATEGORY_INVALID: 'ledgerBookingCategoryInvalid',
      TEMPLATE_CATEGORY_INVALID: 'ledgerTemplateCategoryInvalid',
      TEMPLATE_NOT_VALID_FOR_YEAR: 'ledgerTemplateNotValid',
      EMPTY_FILE: 'documentFileEmpty',
      PAYLOAD_TOO_LARGE: 'documentTooLarge',
      FILE_TYPE_MISMATCH: 'documentTypeInvalid',
      DOCUMENT_ARCHIVED: 'documentArchivedLocked',
      DOCUMENT_STORAGE_ERROR: 'documentStorageError',
    };
    const fallback = `error_${error.code}`;
    return i18n.t(keys[error.code] ?? (i18n.exists(fallback) ? fallback : 'serverError'));
  }
  return i18n.t('loginNetwork');
}
export async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  for (;;) {
    const data = await api<{ items: T[]; total: number }>(
      `${path}${path.includes('?') ? '&' : '?'}pageSize=100&page=${page}`,
    );
    items.push(...data.items);
    if (items.length >= data.total || !data.items.length) break;
    page++;
  }
  return items;
}
