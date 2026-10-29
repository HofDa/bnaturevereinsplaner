import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { errorMessage } from '../lib/api';
import { Field, FormActions, Notice } from './ui';
export type FormField = {
  name: string;
  label?: string;
  type?: 'text' | 'email' | 'password' | 'date' | 'checkbox' | 'textarea' | 'select';
  required?: boolean;
  options?: { value: string; label: string }[];
  nullable?: boolean;
  autoComplete?: string;
  minLength?: number;
  inputMode?: 'text' | 'numeric' | 'decimal';
};
export function DataForm({
  schema,
  fields,
  defaults = {},
  onSubmit,
  onCancel,
  create = false,
}: {
  schema: z.ZodType<Record<string, unknown>>;
  fields: FormField[];
  defaults?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
  create?: boolean;
}) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const input = Object.fromEntries(
      fields.map((field) => [
        field.name,
        field.type === 'checkbox'
          ? form.has(field.name)
          : field.nullable
            ? form.get(field.name) || null
            : form.get(field.name),
      ]),
    );
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join('.'),
            t(issue.message, { defaultValue: t('validation') }),
          ]),
        ),
      );
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        {fields.map((field) => (
          <Field
            label={`${t(field.label ?? field.name)}${field.required ? ' *' : ''}`}
            error={errors[field.name]}
            key={field.name}
          >
            {field.type === 'select' ? (
              <select
                name={field.name}
                required={field.required}
                defaultValue={String(defaults[field.name] ?? '')}
              >
                {field.options?.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                name={field.name}
                rows={4}
                defaultValue={String(defaults[field.name] ?? '')}
              />
            ) : field.type === 'checkbox' ? (
              <input type="checkbox" name={field.name} defaultChecked={!!defaults[field.name]} />
            ) : (
              <input
                name={field.name}
                type={field.type ?? 'text'}
                inputMode={field.inputMode}
                required={field.required}
                minLength={field.minLength}
                autoComplete={
                  field.autoComplete ?? (field.type === 'password' ? 'new-password' : undefined)
                }
                defaultValue={String(defaults[field.name] ?? '')}
                aria-invalid={!!errors[field.name]}
              />
            )}
          </Field>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      <FormActions pending={pending} onCancel={onCancel} create={create} />
    </form>
  );
}
