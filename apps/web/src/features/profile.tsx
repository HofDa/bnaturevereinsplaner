import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { personSchema, type MemberInput } from '@bnature/contracts';
import { api, queryClient } from '../lib/api';
import { authClient } from '../lib/auth';
import { useSession } from '../app/session';
import { DataForm } from '../components/data-form';
import { ErrorState, Loading, Notice, PageHeading } from '../components/ui';
const profileSchema = personSchema.pick({
  phone: true,
  street: true,
  postalCode: true,
  city: true,
  country: true,
  preferredLanguage: true,
});
export function Profile() {
  const { t } = useTranslation(),
    { me } = useSession();
  const [saved, setSaved] = useState('');
  const query = useQuery({
    queryKey: ['profile', me.activeOrganizationId],
    queryFn: () => api<{ person: MemberInput | null }>('/profile'),
  });
  return (
    <>
      <PageHeading title={t('profile')} description={t('profileIntro')} />
      {saved && <Notice>{saved}</Notice>}
      <div className="detail-grid">
        <section className="panel form-panel">
          <h2>{t('account')}</h2>
          <p className="muted">
            {me.user.email} · {t(me.role)}
          </p>
          <DataForm
            schema={z.object({ name: z.string().trim().min(1).max(100) })}
            fields={[{ name: 'name', label: 'accountName', required: true }]}
            defaults={{ name: me.user.name }}
            onSubmit={async (data) => {
              const result = await authClient.updateUser({ name: String(data.name) });
              if (result.error) throw new Error(result.error.message);
              void queryClient.invalidateQueries();
              setSaved(t('accountSaved'));
            }}
          />
          <hr />
          <h2>{t('changePassword')}</h2>
          <DataForm
            schema={z.object({
              currentPassword: z.string().min(1),
              newPassword: z.string().min(12).max(128),
            })}
            fields={[
              {
                name: 'currentPassword',
                type: 'password',
                autoComplete: 'current-password',
                required: true,
              },
              { name: 'newPassword', type: 'password', minLength: 12, required: true },
            ]}
            onSubmit={async (data) => {
              const result = await authClient.changePassword({
                currentPassword: String(data.currentPassword),
                newPassword: String(data.newPassword),
                revokeOtherSessions: true,
              });
              if (result.error) throw new Error(result.error.message);
              setSaved(t('passwordChanged'));
            }}
          />
        </section>
        <section className="panel form-panel">
          <h2>{t('contact')}</h2>
          {query.isPending ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState error={query.error} />
          ) : query.data.person ? (
            <DataForm
              schema={profileSchema}
              defaults={query.data.person}
              fields={[
                { name: 'phone' },
                { name: 'street' },
                { name: 'postalCode' },
                { name: 'city' },
                { name: 'country', required: true },
                {
                  name: 'preferredLanguage',
                  label: 'language',
                  type: 'select',
                  options: [
                    { value: 'de', label: 'Deutsch' },
                    { value: 'it', label: 'Italiano' },
                  ],
                },
              ]}
              onSubmit={async (data) => {
                await api('/profile', { method: 'PATCH', body: JSON.stringify(data) });
                void queryClient.invalidateQueries();
                setSaved(t('saved'));
              }}
            />
          ) : (
            <p className="muted">{t('profileUnlinked')}</p>
          )}
        </section>
      </div>
    </>
  );
}
