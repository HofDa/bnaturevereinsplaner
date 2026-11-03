import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import {
  MAX_DOCUMENT_BYTES,
  detectMediaType,
  encodeDocumentMetadata,
  formatMinutes,
  type CoverageStatus,
  type Permission,
} from '@bnature/contracts';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../app/session';
import { Button, Field, Modal, Notice } from '../../components/ui';
export { useFinancialWrite as useVolunteerWrite } from '../finance/client';

export function usePermission() {
  const { me } = useSession();
  return (permission: Permission) => me.permissions.includes(permission);
}
export function VolunteerNavigation() {
  const { t } = useTranslation(),
    can = usePermission();
  const links = [
    { to: '/volunteers', key: 'volOverview', end: true },
    { to: '/volunteers/list', key: 'volList' },
    { to: '/volunteers/assignments', key: 'volAssignments' },
    { to: '/volunteers/hours', key: 'volHours' },
    { to: '/volunteers/insurance', key: 'volInsurance', permission: 'insurance:read' as const },
    { to: '/volunteers/register', key: 'volRegister', permission: 'register:read' as const },
  ];
  return (
    <nav className="finance-tabs volunteer-tabs" aria-label={t('volunteers')}>
      {links
        .filter((l) => !l.permission || can(l.permission))
        .map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {t(l.key)}
          </NavLink>
        ))}
    </nav>
  );
}
export function CoverageBadge({ status }: { status: CoverageStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge-coverage-${status}`}>
      <span />
      {t(`coverage_${status}`)}
    </span>
  );
}
export function StatusTag({ value, prefix }: { value: string; prefix: string }) {
  const { t } = useTranslation();
  return <span className={`subtle-tag tag-${value}`}>{t(`${prefix}_${value}`)}</span>;
}
export const hoursLabel = (minutes: number) => `${formatMinutes(minutes)} h`;
export function dateTime(value: string | null, language: string) {
  return value
    ? new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'de-IT', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Europe/Rome',
      }).format(new Date(value))
    : '—';
}
// <input type="datetime-local"> works in local time; the API expects an offset timestamp.
export const toInstant = (local: string) => new Date(local).toISOString();
export function toLocalInput(iso: string) {
  const d = new Date(iso),
    pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export type FormFieldSpec = {
  name: string;
  label: string;
  type?:
    'text' | 'email' | 'date' | 'datetime-local' | 'number' | 'select' | 'textarea' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string | number | boolean | null;
  hint?: string;
  min?: number;
  max?: number;
};
export type FormValues = Record<string, string | boolean>;
// Small form shell for module dialogs; server-side validation remains authoritative.
export function FormModal({
  title,
  fields,
  onSubmit,
  onClose,
  submitLabel,
  children,
  wide,
}: {
  title: string;
  fields: FormFieldSpec[];
  onSubmit: (values: FormValues) => Promise<void>;
  onClose: () => void;
  submitLabel?: string;
  children?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: FormValues = {};
    for (const f of fields)
      values[f.name] =
        f.type === 'checkbox' ? form.has(f.name) : String(form.get(f.name) ?? '').trim();
    setError('');
    setPending(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(
        e instanceof Error && /^(vol|document)/.test(e.message) ? t(e.message) : errorMessage(e),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form onSubmit={(e) => void submit(e)}>
        {children}
        <div className="form-grid">
          {fields.map((f) => (
            <Field key={f.name} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
              {f.type === 'select' ? (
                <select
                  name={f.name}
                  required={f.required}
                  defaultValue={String(f.defaultValue ?? '')}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea name={f.name} rows={3} defaultValue={String(f.defaultValue ?? '')} />
              ) : f.type === 'checkbox' ? (
                <input type="checkbox" name={f.name} defaultChecked={!!f.defaultValue} />
              ) : (
                <input
                  name={f.name}
                  type={f.type ?? 'text'}
                  required={f.required}
                  min={f.min}
                  max={f.max}
                  defaultValue={f.defaultValue === null ? '' : String(f.defaultValue ?? '')}
                />
              )}
            </Field>
          ))}
        </div>
        {error && <Notice error>{error}</Notice>}
        <footer className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <LoaderCircle size={16} className="spin" />}
            {submitLabel ?? t('save')}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
// Private evidence upload into the existing document store, with a stable retry key.
export function usePrivateUpload() {
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  return async <T,>(
    path: string,
    file: File,
    metadata: Record<string, unknown>,
    mediaType?: string,
  ): Promise<T> => {
    if (file.size === 0) throw new Error('documentFileEmpty');
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error('documentTooLarge');
    const type =
      mediaType ?? detectMediaType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!type) throw new Error('documentTypeInvalid');
    const encoded = encodeDocumentMetadata(metadata),
      signature = `${path}:${file.name}:${file.size}:${file.lastModified}:${encoded}`;
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    return api<T>(path, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': type,
        'X-Document-Metadata': encoded,
        'Idempotency-Key': attempt.current.key,
      },
    });
  };
}
export const splitList = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
export const nullable = (value: string | boolean) => (value === '' ? null : value);
