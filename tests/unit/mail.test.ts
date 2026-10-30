import { describe, expect, it } from 'vitest';
import { eventInvitationMail, feeReminderMail } from '../../apps/api/src/modules/mail-templates';
import { readConfig } from '../../apps/api/src/plugins/config';
import { mailSendSchema, mailSettingsInputSchema, can } from '../../packages/contracts/src';

describe('transactional email', () => {
  it('renders localized amounts without exposing recipient lists or accepting subject line injection', () => {
    const input = {
      organization: 'b*nature\r\nBcc: other@example.test',
      name: 'Lena Test',
      plan: 'Jahresbeitrag',
      amountCents: 12345,
      dueDate: '2026-01-31',
    };
    const de = feeReminderMail({ ...input, language: 'de' });
    const it = feeReminderMail({ ...input, language: 'it' });
    expect(de.subject).not.toMatch(/[\r\n]/);
    expect(de.text).toContain('123,45');
    expect(it.text).toContain('123,45');
    expect(it.subject).toContain('Promemoria');
    expect(de.subject).toContain('Erinnerung');
  });
  it('links invitations to authenticated event details and displays the event timezone', () => {
    const message = eventInvitationMail({
      language: 'it',
      organization: 'b*nature',
      name: 'Giulia Test',
      title: 'Bosco',
      startAt: new Date('2027-01-10T08:00:00Z'),
      endAt: new Date('2027-01-10T10:00:00Z'),
      timezone: 'Europe/Rome',
      location: 'Bressanone',
      appUrl: 'https://verein.example.org',
      eventId: 'event-id',
    });
    expect(message.text).toContain('09:00');
    expect(message.text).toContain('https://verein.example.org/events/event-id');
    expect(message.text).toContain('account associativo');
  });
  it('disables delivery by default and refuses incomplete or unsafe production configuration', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/bnature',
      AUTH_SECRET: 'test-only-secret-more-than-32-characters',
    };
    expect(readConfig(env).EMAIL_MODE).toBe('disabled');
    expect(readConfig({ ...env, SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '' }).EMAIL_MODE).toBe(
      'disabled',
    );
    expect(() => readConfig({ ...env, EMAIL_MODE: 'smtp' })).toThrow('SMTP_HOST');
    expect(() => readConfig({ ...env, SMTP_USER: 'test' })).toThrow('configured together');
    expect(() =>
      readConfig({
        ...env,
        NODE_ENV: 'production',
        APP_URL: 'https://verein.example.org',
        EMAIL_MODE: 'local',
      }),
    ).toThrow('Local email capture');
    expect(() =>
      readConfig({
        ...env,
        NODE_ENV: 'production',
        APP_URL: 'https://verein.example.org',
        EMAIL_MODE: 'smtp',
        SMTP_HOST: 'smtp.example.org',
      }),
    ).toThrow('real sender');
  });
  it('requires a reviewed preview and constrains automatic reminder frequency and roles', () => {
    expect(
      mailSendSchema.safeParse({
        request: {
          kind: 'event_invitation',
          eventId: crypto.randomUUID(),
          recipient: 'other@example.test',
        },
        previewHash: 'a'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      mailSettingsInputSchema.safeParse({ automaticFeeReminders: true, reminderIntervalDays: 1 })
        .success,
    ).toBe(false);
    expect(can('member', 'mail:read')).toBe(false);
    expect(can('board', 'mail:invite')).toBe(true);
    expect(can('treasurer', 'mail:invite')).toBe(false);
  });
});
