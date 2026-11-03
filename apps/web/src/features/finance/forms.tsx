import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import {
  feePlanInputSchema,
  assessmentInputSchema,
  paymentInputSchema,
  moneyTextSchema,
  parseEuroCents,
  moneyInputValue,
  formatMoney,
  membershipTypeSchema,
  bookingInputSchema,
  paymentReversalInputSchema,
  type FeePlan,
  type FeeAssessment,
  type Payment,
  type Member,
} from '@bnature/contracts';
import { DataForm, type FormField } from '../../components/data-form';
import {
  Button,
  Field,
  FormActions,
  Notice,
  Empty,
  Loading,
  ErrorState,
} from '../../components/ui';
import { allPages, errorMessage, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
import { useFinancialWrite } from './client';
import { useLedgerBasics } from './queries';

const planFormSchema = feePlanInputSchema
  .omit({ amountCents: true, membershipType: true })
  .extend({
    amount: moneyTextSchema,
    membershipType: z.union([membershipTypeSchema, z.literal('')]).transform((v) => v || null),
  })
  .transform(({ amount, ...rest }) => ({ ...rest, amountCents: parseEuroCents(amount) }));
const assessmentFormSchema = z
  .object(assessmentInputSchema.shape)
  .omit({ fiscalYear: true, individualAmountCents: true, reductionCents: true })
  .extend({
    fiscalYear: z.coerce.number().int().min(1900).max(2200),
    individualAmount: z.union([moneyTextSchema, z.literal('')]),
    reduction: moneyTextSchema,
  })
  .transform(({ individualAmount, reduction, ...rest }) => ({
    ...rest,
    individualAmountCents: individualAmount ? parseEuroCents(individualAmount) : null,
    reductionCents: parseEuroCents(reduction),
  }))
  .superRefine((value, ctx) => {
    const result = assessmentInputSchema.safeParse(value);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });
export function PlanForm({
  plan,
  onDone,
  onCancel,
}: {
  plan?: FeePlan;
  onDone: (plan: FeePlan) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(),
    write = useFinancialWrite();
  const fields: FormField[] = [
    { name: 'name', label: 'financePlanName', required: true },
    { name: 'amount', label: 'financeAmount', required: true, inputMode: 'decimal' },
    {
      name: 'interval',
      label: 'financeInterval',
      type: 'select',
      options: [
        { value: 'annual', label: t('financeAnnual') },
        { value: 'once', label: t('financeOnce') },
      ],
    },
    {
      name: 'membershipType',
      label: 'financeCategory',
      type: 'select',
      options: [
        { value: '', label: t('financeAllCategories') },
        ...['ordinary', 'supporting', 'honorary'].map((value) => ({ value, label: t(value) })),
      ],
    },
    { name: 'description', label: 'financeDescription', type: 'textarea' },
    { name: 'active', label: 'active', type: 'checkbox' },
  ];
  return (
    <DataForm
      schema={planFormSchema}
      fields={fields}
      defaults={
        plan
          ? {
              ...plan,
              amount: moneyInputValue(plan.amountCents),
              membershipType: plan.membershipType ?? '',
            }
          : { amount: '0.00', interval: 'annual', membershipType: '', active: true }
      }
      create={!plan}
      onCancel={onCancel}
      onSubmit={async (value) => {
        try {
          onDone(
            await write<FeePlan>(
              plan ? `/fee-plans/${plan.id}` : '/fee-plans',
              plan ? { ...value, version: plan.version } : value,
              plan ? 'PATCH' : 'POST',
            ),
          );
        } catch (error) {
          void queryClient.invalidateQueries({
            predicate: (query) => String(query.queryKey[0]).startsWith('finance-'),
          });
          throw error;
        }
      }}
    />
  );
}
export function AssessmentForm({
  year,
  onDone,
  onCancel,
}: {
  year: number;
  onDone: (assessment: FeeAssessment) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(),
    { me } = useSession(),
    write = useFinancialWrite();
  const choices = useQuery({
    queryKey: ['finance-assessment-options', me.activeOrganizationId],
    queryFn: async () => {
      const [plans, members] = await Promise.all([
        allPages<FeePlan>('/fee-plans?active=true&sort=name&direction=asc'),
        allPages<Member>('/members'),
      ]);
      return { plans, members };
    },
  });
  if (choices.isPending) return <Loading />;
  if (choices.isError)
    return <ErrorState error={choices.error} retry={() => void choices.refetch()} />;
  if (!choices.data.plans.length) return <Empty description={t('financeNoPlans')} />;
  if (!choices.data.members.length) return <Empty description={t('financeNoMembers')} />;
  return (
    <>
      <p className="form-help finance-form-help">{t('financeIndividualHelp')}</p>
      <DataForm
        schema={assessmentFormSchema}
        fields={[
          {
            name: 'membershipId',
            label: 'financeMember',
            type: 'select',
            required: true,
            options: [
              { value: '', label: t('financeChooseMember') },
              ...choices.data.members.map((m) => ({
                value: m.id,
                label: `${m.firstName} ${m.lastName} · ${m.membershipNumber}`,
              })),
            ],
          },
          {
            name: 'planId',
            label: 'financePlan',
            type: 'select',
            required: true,
            options: [
              { value: '', label: t('financeChoosePlan') },
              ...choices.data.plans.map((p) => ({
                value: p.id,
                label: `${p.name} · ${formatMoney(p.amountCents)} · ${t(p.interval === 'annual' ? 'financeAnnual' : 'financeOnce')}${p.membershipType ? ` · ${t(p.membershipType)}` : ''}`,
              })),
            ],
          },
          { name: 'fiscalYear', label: 'financeYear', required: true, inputMode: 'numeric' },
          { name: 'dueDate', label: 'financeDueDate', type: 'date', required: true },
          { name: 'individualAmount', label: 'financeIndividualAmount', inputMode: 'decimal' },
          { name: 'reduction', label: 'financeReduction', required: true, inputMode: 'decimal' },
          { name: 'exempt', label: 'financeExempt', type: 'checkbox' },
          { name: 'adjustmentReason', label: 'financeAdjustmentReason', type: 'textarea' },
        ]}
        defaults={{
          membershipId: '',
          planId: '',
          fiscalYear: year,
          dueDate: `${year}-12-31`,
          individualAmount: '',
          reduction: '0.00',
          exempt: false,
          adjustmentReason: '',
        }}
        create
        onCancel={onCancel}
        onSubmit={async (value) => onDone(await write<FeeAssessment>('/fee-assessments', value))}
      />
    </>
  );
}
type DraftAllocation = { key: string; assessmentId: string; amount: string };
export function PaymentForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: FeeAssessment;
  onDone: (payment: Payment) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation(),
    { me } = useSession(),
    write = useFinancialWrite();
  const [allocations, setAllocations] = useState<DraftAllocation[]>([
    {
      key: crypto.randomUUID(),
      assessmentId: initial?.id ?? '',
      amount: initial ? moneyInputValue(initial.openCents) : '',
    },
  ]);
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const ledger = useLedgerBasics(),
    bookingAccounts = ledger.accounts.data?.items.filter((a) => a.active) ?? [],
    feeCategories =
      ledger.categories.data?.items.filter(
        (c) => c.active && c.classification === 'membership_fee',
      ) ?? [];
  const query = useQuery({
    queryKey: ['finance-payment-options', me.activeOrganizationId],
    queryFn: () =>
      allPages<FeeAssessment>('/fee-assessments?status=outstanding&sort=dueDate&direction=asc'),
  });
  let total = 0;
  for (const row of allocations) {
    try {
      total += parseEuroCents(row.amount);
    } catch {
      /* validated on submit */
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const rows = allocations.map((row) => ({
        assessmentId: row.assessmentId,
        amountCents: parseEuroCents(row.amount),
      }));
      const input = paymentInputSchema.safeParse({
        payerName: form.get('payerName'),
        paidOn: form.get('paidOn'),
        method: form.get('method'),
        reference: form.get('reference'),
        notes: form.get('notes'),
        amountCents: rows.reduce((n, row) => n + row.amountCents, 0),
        allocations: rows,
        booking: form.get('bookingAccountId')
          ? { accountId: form.get('bookingAccountId'), categoryId: form.get('bookingCategoryId') }
          : null,
      });
      if (!input.success) {
        setError(
          t(input.error.issues[0]?.message ?? 'validation', { defaultValue: t('validation') }),
        );
        return;
      }
      setPending(true);
      onDone(await write<Payment>('/payments', input.data));
    } catch (error) {
      setError(
        error instanceof Error && error.message === 'financeInvalidAmount'
          ? t('financeInvalidAmount')
          : errorMessage(error),
      );
    } finally {
      setPending(false);
    }
  }
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data.length) return <Empty description={t('financeNoOpen')} />;
  const update = (key: string, patch: Partial<DraftAllocation>) =>
    setAllocations((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="finance-form-help">{t('financePaymentHelp')}</p>
      <div className="form-grid">
        <Field label={`${t('financePayerName')} *`}>
          <input
            name="payerName"
            defaultValue={initial?.memberName ?? ''}
            required
            maxLength={160}
          />
        </Field>
        <Field label={`${t('financePaidOn')} *`}>
          <input
            type="date"
            name="paidOn"
            required
            defaultValue={new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
              new Date(),
            )}
          />
        </Field>
        <Field label={t('financeMethod')}>
          <select name="method">
            <option value="cash">{t('financeCash')}</option>
            <option value="bank_transfer">{t('financeTransfer')}</option>
            <option value="other">{t('financeOther')}</option>
          </select>
        </Field>
        <Field label={t('financeReference')} hint={t('financeReferenceHelp')}>
          <input name="reference" maxLength={120} />
        </Field>
      </div>
      <fieldset>
        <legend>{t('financeAllocations')}</legend>
        <div className="finance-allocation-list">
          {allocations.map((row, index) => (
            <div className="finance-allocation" key={row.key}>
              <Field label={`${t('financeChooseAssessment')} ${index + 1}`}>
                <select
                  required
                  value={row.assessmentId}
                  onChange={(event) => {
                    const assessment = query.data.find((a) => a.id === event.target.value);
                    update(row.key, {
                      assessmentId: event.target.value,
                      amount: assessment ? moneyInputValue(assessment.openCents) : '',
                    });
                  }}
                >
                  <option value="">{t('financeChooseAssessment')}</option>
                  {query.data
                    .filter(
                      (a) =>
                        a.id === row.assessmentId ||
                        !allocations.some((other) => other.assessmentId === a.id),
                    )
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.memberName} · {a.planName} · {a.fiscalYear} ·{' '}
                        {formatMoney(a.openCents, i18n.language)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={`${t('financeAllocationAmount')} ${index + 1}`}>
                <input
                  required
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => update(row.key, { amount: event.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                disabled={allocations.length === 1 || pending}
                aria-label={`${t('financeRemoveAllocation')} ${index + 1}`}
                onClick={() => setAllocations((rows) => rows.filter((r) => r.key !== row.key))}
              >
                <Trash2 size={17} />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={allocations.length >= 100 || allocations.length >= query.data.length || pending}
          onClick={() =>
            setAllocations((rows) => [
              ...rows,
              { key: crypto.randomUUID(), assessmentId: '', amount: '' },
            ])
          }
        >
          <Plus size={16} />
          {t('financeAddAllocation')}
        </Button>
      </fieldset>
      <div className="finance-payment-total">
        <span>{t('financePaymentTotal')}</span>
        <strong>{formatMoney(total, i18n.language)}</strong>
      </div>
      <Field label={t('financeNotes')}>
        <textarea name="notes" rows={2} maxLength={500} />
      </Field>
      {bookingAccounts.length > 0 && feeCategories.length > 0 && (
        <fieldset>
          <legend>{t('ledgerBookingLegend')}</legend>
          <p className="finance-form-help">{t('ledgerBookingHelp')}</p>
          <div className="form-grid">
            <Field label={t('ledgerAccount')}>
              <select name="bookingAccountId" defaultValue="">
                <option value="">{t('ledgerDoNotBook')}</option>
                {bookingAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('ledgerCategory')}>
              <select name="bookingCategoryId">
                {feeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>
      )}
      {error && <Notice error>{error}</Notice>}
      <FormActions pending={pending} create onCancel={onCancel} />
    </form>
  );
}
export function BookingForm({
  payment,
  onDone,
  onCancel,
}: {
  payment: Payment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(),
    write = useFinancialWrite(),
    ledger = useLedgerBasics();
  if (ledger.accounts.isPending || ledger.categories.isPending) return <Loading />;
  const accounts = ledger.accounts.data?.items.filter((a) => a.active) ?? [],
    categories =
      ledger.categories.data?.items.filter(
        (c) => c.active && c.classification === 'membership_fee',
      ) ?? [];
  if (!accounts.length || !categories.length)
    return <p className="finance-footnote">{t('ledgerBookingSetup')}</p>;
  return (
    <section className="finance-inline-form" aria-label={t('ledgerBookPayment')}>
      <h3>{t('ledgerBookPayment')}</h3>
      <p className="finance-form-help">{t('ledgerBookingHelp')}</p>
      <DataForm
        schema={bookingInputSchema}
        create
        onCancel={onCancel}
        fields={[
          {
            name: 'accountId',
            label: 'ledgerAccount',
            type: 'select',
            required: true,
            options: accounts.map((a) => ({ value: a.id, label: a.name })),
          },
          {
            name: 'categoryId',
            label: 'ledgerCategory',
            type: 'select',
            required: true,
            options: categories.map((c) => ({ value: c.id, label: c.name })),
          },
        ]}
        onSubmit={async (value) => {
          await write(`/payments/${payment.id}/booking`, value);
          onDone();
        }}
      />
    </section>
  );
}
export function PaymentReversalForm({
  payment,
  onDone,
  onCancel,
}: {
  payment: Payment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(),
    write = useFinancialWrite();
  return (
    <section className="finance-inline-form" aria-label={t('ledgerReversePayment')}>
      <h3>{t('ledgerReversePayment')}</h3>
      <p className="finance-form-help">
        {t(
          payment.cashbookEntryId ? 'ledgerPaymentReversalBookedHelp' : 'ledgerPaymentReversalHelp',
        )}
      </p>
      <DataForm
        schema={paymentReversalInputSchema}
        create
        onCancel={onCancel}
        fields={[
          { name: 'reversedOn', label: 'ledgerReversalDate', type: 'date', required: true },
          { name: 'reason', label: 'ledgerReversalReason', type: 'textarea', required: true },
        ]}
        defaults={{
          reversedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
            new Date(),
          ),
          reason: '',
        }}
        onSubmit={async (value) => {
          await write(`/payments/${payment.id}/reversal`, value);
          onDone();
        }}
      />
    </section>
  );
}
