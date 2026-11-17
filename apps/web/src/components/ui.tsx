import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
  type AriaAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, ArrowRight, LoaderCircle, Search, X, Inbox } from 'lucide-react';
import { errorMessage } from '../lib/api';
export function Button({
  children,
  className = '',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}
export function Loading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="state">
      <LoaderCircle className="spin" size={25} />
      <p>{t('loading')}</p>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="state">
      <AlertCircle size={28} />
      <h3>{t('errorTitle')}</h3>
      <p>{errorMessage(error)}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}
// Loading and error states for a query; children render only once data is available.
export function QueryView<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return children(query.data);
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="state">
      <span className="empty-icon">
        <Inbox size={24} />
      </span>
      <h3>{title ?? t('empty')}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`badge badge-${status}`}>
      <span />
      {t(status)}
    </span>
  );
}
export function Avatar({ firstName, lastName }: { firstName: string; lastName: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {firstName.slice(0, 1)}
      {lastName.slice(0, 1)}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.documentElement.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="Schließen / Chiudi" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
}) {
  const generatedId = useId();
  const control = isValidElement<{ id?: string } & AriaAttributes>(children) ? children : null;
  const id = control?.props.id ?? generatedId;
  const describedBy =
    [control?.props['aria-describedby'], hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {control
        ? cloneElement(control, {
            id,
            'aria-describedby': describedBy,
            'aria-invalid': error ? true : control.props['aria-invalid'],
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  return (
    <label className="search-input">
      <Search size={18} />
      <span className="sr-only">{placeholder ?? t('search')}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t('search')}
      />
    </label>
  );
}
export function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        {total} {t('entries')}
      </span>
      <div>
        <Button
          variant="ghost"
          disabled={page <= 1}
          aria-label={t('previous')}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={16} />
        </Button>
        <span>
          {t('page')} {page} {t('of')} {pages}
        </span>
        <Button
          variant="ghost"
          disabled={page >= pages}
          aria-label={t('next')}
          onClick={() => onChange(page + 1)}
        >
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}
export function FormActions({
  pending,
  onCancel,
  create = false,
}: {
  pending: boolean;
  onCancel?: () => void;
  create?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <footer className="form-actions">
      {onCancel && (
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="spin" /> : null}
        {t(pending ? 'saving' : create ? 'create' : 'save')}
      </Button>
    </footer>
  );
}
export function formatDate(value: string | null, language: string) {
  return value
    ? new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'de-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value))
    : '—';
}
