import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { memberInputSchema, type Member, type MemberInput } from '@bnature/contracts';
import { api, errorMessage, queryClient } from '../lib/api';
import { Field, FormActions, Notice } from '../components/ui';
type Input = z.input<typeof memberInputSchema>;
export function MemberForm({
  member,
  onDone,
  onCancel,
}: {
  member?: Member;
  onDone: (member: Member) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const form = useForm<Input, unknown, MemberInput>({
    resolver: zodResolver(memberInputSchema),
    defaultValues: member
      ? memberInputSchema.strip().parse(member)
      : {
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          dateOfBirth: null,
          fiscalCode: '',
          street: '',
          postalCode: '',
          city: '',
          country: 'IT',
          preferredLanguage: 'de',
          membershipNumber: '',
          membershipType: 'ordinary',
          status: 'active',
          joinedAt: new Date().toISOString().slice(0, 10),
          endedAt: null,
        },
  });
  const mutation = useMutation({
    mutationFn: (value: MemberInput) =>
      api<Member>(member ? `/members/${member.id}` : '/members', {
        method: member ? 'PATCH' : 'POST',
        body: JSON.stringify(value),
      }),
    onSuccess: (value) => {
      void queryClient.invalidateQueries();
      onDone(value);
    },
  });
  const input = (name: FieldPath<Input>, type = 'text', required = false) => (
    <Field
      key={name}
      label={`${t(name === 'membershipNumber' ? 'memberNumber' : name === 'joinedAt' ? 'joined' : name)}${required ? ' *' : ''}`}
      error={
        form.formState.errors[name]?.message
          ? t(form.formState.errors[name]?.message ?? 'validation')
          : undefined
      }
    >
      <input
        type={type}
        required={required}
        aria-invalid={!!form.formState.errors[name]}
        {...form.register(name, {
          ...(type === 'date' && name !== 'joinedAt'
            ? { setValueAs: (v: string) => v || null }
            : {}),
          ...(name === 'fiscalCode' ? { setValueAs: (v: string) => v.toUpperCase() } : {}),
        })}
      />
    </Field>
  );
  return (
    <form onSubmit={form.handleSubmit((value) => mutation.mutate(value))} noValidate>
      <p className="form-help">* {t('required')}</p>
      {mutation.isError && <Notice error>{errorMessage(mutation.error)}</Notice>}
      {form.formState.isSubmitted && Object.keys(form.formState.errors).length > 0 && (
        <Notice error>{t('validation')}</Notice>
      )}
      <fieldset>
        <legend>{t('personData')}</legend>
        <div className="form-grid">
          {input('firstName', 'text', true)}
          {input('lastName', 'text', true)}
          {input('email', 'email')}
          {input('phone', 'tel')}
          {input('dateOfBirth', 'date')}
          {input('fiscalCode')}
          <Field label={t('language')}>
            <select {...form.register('preferredLanguage')}>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
            </select>
          </Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('membershipData')}</legend>
        <div className="form-grid">
          {input('membershipNumber', 'text', true)}
          <Field label={t('membershipType')}>
            <select {...form.register('membershipType')}>
              {['ordinary', 'supporting', 'honorary'].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('status')}>
            <select {...form.register('status')}>
              {['active', 'pending', 'inactive', 'resigned'].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          {input('joinedAt', 'date', true)}
          {input('endedAt', 'date')}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('address')}</legend>
        <div className="form-grid">
          {input('street')}
          {input('postalCode')}
          {input('city')}
          {input('country')}
        </div>
      </fieldset>
      <FormActions pending={mutation.isPending} onCancel={onCancel} create={!member} />
    </form>
  );
}
