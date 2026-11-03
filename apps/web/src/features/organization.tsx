import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { organizationSchema, type Organization } from '@bnature/contracts';
import { api, queryClient } from '../lib/api';
import { useSession } from '../app/session';
import { ErrorState, Loading, Notice, PageHeading } from '../components/ui';
import { DataForm, type FormField } from '../components/data-form';
import { MemberFieldSettings } from './member-extras';
export function OrganizationPage() {
  const { t } = useTranslation(),
    { me } = useSession(),
    [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ['organization', me.activeOrganizationId],
    queryFn: () => api<Organization>(`/organizations/${me.activeOrganizationId}`),
  });
  const fields: FormField[] = [
    { name: 'name', label: 'organizationName', required: true },
    { name: 'fiscalCode' },
    {
      name: 'organizationType',
      type: 'select',
      options: ['ODV', 'APS', 'ETS', 'other'].map((value) => ({
        value,
        label: value === 'other' ? '—' : value,
      })),
    },
    { name: 'street' },
    { name: 'postalCode' },
    { name: 'city' },
    { name: 'country', required: true },
    {
      name: 'locale',
      label: 'language',
      type: 'select',
      options: [
        { value: 'de', label: 'Deutsch' },
        { value: 'it', label: 'Italiano' },
      ],
    },
    { name: 'timezone', required: true },
  ];
  return (
    <>
      <PageHeading title={t('organization')} description={t('organizationIntro')} />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : (
        <section className="panel form-panel">
          {saved && <Notice>{t('saved')}</Notice>}
          {me.permissions.includes('organization:write') ? (
            <DataForm
              key={query.data.id + query.data.name}
              schema={organizationSchema}
              fields={fields}
              defaults={query.data}
              onSubmit={async (data) => {
                await api(`/organizations/${me.activeOrganizationId}`, {
                  method: 'PATCH',
                  body: JSON.stringify(data),
                });
                void queryClient.invalidateQueries();
                setSaved(true);
              }}
            />
          ) : (
            <dl>
              {fields.map((field) => (
                <div key={field.name}>
                  <dt>{t(field.label ?? field.name)}</dt>
                  <dd>{String(query.data[field.name as keyof Organization] || '—')}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
      <MemberFieldSettings />
    </>
  );
}
