// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../apps/web/src/lib/i18n';
import { MemberForm } from '../../apps/web/src/features/member-form';
import { Settings } from '../../apps/web/src/features/settings';
import { SessionContext } from '../../apps/web/src/app/session';
import { MemoryRouter } from 'react-router';
import { memberInputSchema, type Member } from '../../packages/contracts/src';
import type { Me } from '../../packages/contracts/src';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const provider = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);
describe('member UI', () => {
  it('requires a name and membership number before sending data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(provider(<MemberForm onDone={vi.fn()} onCancel={vi.fn()} />));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Bitte prüfen Sie die markierten Eingaben.')).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('validates a resigned status against its end date', async () => {
    render(provider(<MemberForm onDone={vi.fn()} onCancel={vi.fn()} />));
    await userEvent.type(screen.getByLabelText('Vorname *'), 'Anna');
    await userEvent.type(screen.getByLabelText('Nachname *'), 'Test');
    await userEvent.type(screen.getByLabelText('Mitgliedsnummer *'), '001');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'resigned');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Bitte das Austrittsdatum angeben.')).toBeVisible();
  });
  it('edits API records without submitting server-owned metadata', async () => {
    const member: Member = {
      ...memberInputSchema.parse({
        firstName: 'Anna',
        lastName: 'Test',
        membershipNumber: '001',
        joinedAt: '2026-01-01',
      }),
      id: crypto.randomUUID(),
      personId: crypto.randomUUID(),
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(member), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const done = vi.fn();
    render(provider(<MemberForm member={member} onDone={done} onCancel={vi.fn()} />));
    await userEvent.type(screen.getByLabelText('Telefon'), '+39 000');
    await userEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body.phone).toBe('+39 000');
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('createdAt');
  });
  it('changes color theme accessibly', async () => {
    const me = {
      user: { id: 'test', name: 'Test', email: 'test@example.test' },
      role: 'member',
      permissions: [],
      organizations: [],
      activeOrganizationId: 'test',
    } satisfies Me;
    render(
      <MemoryRouter>
        <SessionContext.Provider value={{ me, switchOrganization: vi.fn() }}>
          <Settings />
        </SessionContext.Provider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dunkel' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByRole('button', { name: 'Dunkel' })).toHaveAttribute('aria-pressed', 'true');
  });
});
