import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Member, MemberField } from '@bnature/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../app/session';
import { fieldLabel } from '../lib/member-fields';
import { api, errorMessage, queryClient } from '../lib/api';
import { previewCsv, encodeCsv, downloadCsv, type CsvPreview } from '../lib/csv';
import { Button, Notice, Field } from '../components/ui';
export function CsvImport({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const fieldsQuery = useQuery({
    queryKey: ['member-fields', me.activeOrganizationId],
    queryFn: () => api<{ items: MemberField[] }>('/member-fields'),
  });
  const fields = (fieldsQuery.data?.items ?? []).filter((f) => f.active);
  const fieldHeaders = fields.map((f) => fieldLabel(f, i18n.language));
  const [rows, setRows] = useState<CsvPreview[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [failures, setFailures] = useState<string[]>([]);
  const valid = rows.filter((row) => row.data && !row.imported);
  return (
    <div className="import-content">
      <p>{t('importIntro')}</p>
      <p className="form-help">{t('importFieldsHint')}</p>
      <Button
        variant="secondary"
        onClick={() =>
          downloadCsv(
            'bnature-vorlage.csv',
            encodeCsv(
              [
                {
                  firstName: 'Maria',
                  lastName: 'Beispiel',
                  membershipNumber: '2026-001',
                  joinedAt: '2026-10-01',
                  status: 'active',
                  membershipType: 'ordinary',
                  preferredLanguage: 'de',
                  country: 'IT',
                },
              ],
              [
                'firstName',
                'lastName',
                'membershipNumber',
                'joinedAt',
                'status',
                'membershipType',
                'preferredLanguage',
                'country',
                ...fieldHeaders,
              ],
            ),
          )
        }
      >
        {t('downloadTemplate')}
      </Button>
      <Field label="CSV">
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            setRows([]);
            setDone(false);
            setError('');
            setFailures([]);
            if (!file) return;
            if (file.size > 2_000_000) {
              setError(t('csvLimit'));
              return;
            }
            try {
              setRows(previewCsv(await file.text(), fields));
            } catch (error) {
              setError(t(error instanceof Error ? error.message : 'csvError'));
            }
          }}
        />
      </Field>
      {error && <Notice error>{error}</Notice>}
      {rows.length > 0 && (
        <>
          <div className="import-count">
            <strong>
              {valid.length} {t('importValid')}
            </strong>
            <span>
              {rows.filter((row) => row.errors.length).length} {t('importInvalid')}
            </span>
          </div>
          <div className="table-scroll import-preview">
            <table>
              <thead>
                <tr>
                  <th>{t('row')}</th>
                  <th>{t('name')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.line}>
                    <td>{row.line}</td>
                    <td>{row.name}</td>
                    <td>
                      {row.imported ? (
                        '✓'
                      ) : row.errors.length ? (
                        <span className="error-text">
                          {row.errors
                            .map((error) => {
                              const [field, message] = error.split(': ');
                              return `${t(field ?? 'validation')}: ${t(message ?? 'validation', { defaultValue: t('validation') })}`;
                            })
                            .join('; ')}
                        </span>
                      ) : (
                        '✓'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {busy && <Notice>{t('importProgress')}</Notice>}
      {done && (
        <Notice error={failures.length > 0}>
          {t(failures.length ? 'importFailures' : 'importDone')}
          {failures.map((value) => (
            <p key={value}>{value}</p>
          ))}
        </Notice>
      )}
      <footer className="form-actions">
        <Button
          disabled={!valid.length || busy}
          onClick={async () => {
            setBusy(true);
            onBusy(true);
            setDone(false);
            const failed: string[] = [];
            for (const row of valid) {
              try {
                const member = await api<Member>('/members', {
                  method: 'POST',
                  body: JSON.stringify(row.data),
                });
                row.imported = true;
                if (Object.keys(row.fieldValues).length)
                  await api(`/members/${member.id}/fields`, {
                    method: 'PUT',
                    body: JSON.stringify({ values: row.fieldValues }),
                  });
              } catch (error) {
                failed.push(`${t('row')} ${row.line}: ${errorMessage(error)}`);
              }
            }
            setRows([...rows]);
            setFailures(failed);
            setBusy(false);
            onBusy(false);
            setDone(true);
            void queryClient.invalidateQueries();
          }}
        >
          {t(busy ? 'saving' : 'importCommit')}
        </Button>
      </footer>
    </div>
  );
}
