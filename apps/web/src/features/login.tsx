import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, ShieldCheck, Globe2 } from 'lucide-react';
import { Button, Field, Notice } from '../components/ui';
import { authClient } from '../lib/auth';
import { broadcastSessionChange } from '../lib/session-events';
import { setLanguage } from '../lib/i18n';
const schema = z.object({ email: z.email(), password: z.string().min(1) });
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState('');
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <div className="login-layout">
      <div className="login-story">
        <a href={import.meta.env.BASE_URL} className="brand">
          b<span>*</span>nature<small>{t('app')}</small>
        </a>
        <div className="login-copy">
          <span className="eyebrow">SÜDTIROL · ALTO ADIGE</span>
          <h1>{t('welcome')}</h1>
          <p>{t('dashboardIntro')}</p>
          <div className="contour" aria-hidden="true">
            <svg viewBox="0 0 600 210">
              <path d="M0 180 Q80 160 130 90T300 110T470 70T600 25M0 200Q90 190 145 120T300 140T470 100T600 55M0 220Q90 220 160 150T300 170T470 130T600 85M0 160Q70 130 115 60T300 80T470 40T600 -5" />
            </svg>
          </div>
        </div>
        <p className="login-foot">b*nature · {t('privacyNote')}</p>
      </div>
      <main className="login-main">
        <button
          className="language-switch"
          onClick={() => void setLanguage(i18n.language === 'de' ? 'it' : 'de')}
        >
          <Globe2 size={16} />
          {i18n.language === 'de' ? 'IT' : 'DE'}
        </button>
        <form
          onSubmit={form.handleSubmit(async (value) => {
            setError('');
            try {
              const result = await authClient.signIn.email(value);
              if (result.error) setError(t('loginError'));
              else {
                broadcastSessionChange();
                onSuccess();
              }
            } catch {
              setError(t('loginNetwork'));
            }
          })}
          className="login-form"
        >
          <span className="section-mark">
            <ShieldCheck size={24} />
          </span>
          <h2>{t('loginTitle')}</h2>
          <p>{t('loginIntro')}</p>
          {error && <Notice error>{error}</Notice>}
          <Field
            label={t('email')}
            error={form.formState.errors.email ? t('validation') : undefined}
          >
            <input type="email" autoComplete="username" required {...form.register('email')} />
          </Field>
          <Field label={t('password')}>
            <input
              type="password"
              autoComplete="current-password"
              required
              {...form.register('password')}
            />
          </Field>
          <Button disabled={form.formState.isSubmitting}>
            {t('login')}
            <ArrowRight size={18} />
          </Button>
          <small>{t('loginNote')}</small>
        </form>
      </main>
    </div>
  );
}
