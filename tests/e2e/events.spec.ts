import { test, expect, request as requestFactory, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const appOrigin = `http://localhost:${process.env.E2E_WEB_PORT ?? '5174'}`;
async function login(page: Page, email = 'e2e@example.test') {
  await page.goto('/');
  await page.getByLabel('E-Mail', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
}
const writeHeaders = () => ({
  Origin: appOrigin,
  'Idempotency-Key': crypto.randomUUID(),
});
async function fixture(page: Page, title: string) {
  const initialized = await page.request.post('/api/v1/event-categories/initialize', {
    headers: writeHeaders(),
    data: {},
  });
  expect(initialized.status(), await initialized.text()).toBe(200);
  const category = (await initialized.json()).items[0];
  const response = await page.request.post('/api/v1/events', {
    headers: writeHeaders(),
    data: {
      titleI18n: { de: title, it: `${title} IT` },
      categoryId: category.id,
      startLocal: '2027-06-01T09:00',
      endLocal: '2027-06-01T12:00',
      status: 'published',
      visibility: 'members',
      capacity: 20,
      waitlistEnabled: true,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const event = await response.json();
  const registrations = [];
  for (const firstName of ['Alma', 'Bruno']) {
    const r = await page.request.post(`/api/v1/events/${event.id}/registrations`, {
      headers: writeHeaders(),
      data: { guest: { firstName, lastName: 'Offline' } },
    });
    expect(r.status(), await r.text()).toBe(201);
    registrations.push(await r.json());
  }
  const me = await (await page.request.get('/api/v1/me')).json();
  return { event, registrations, org: me.activeOrganizationId };
}
async function prepare(page: Page, eventId: string) {
  await page.goto(`/events/${eventId}?tab=attendance`);
  await expect(
    page.getByRole('button', { name: 'Für Offline-Nutzung vorbereiten', exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await page.getByRole('button', { name: 'Für Offline-Nutzung vorbereiten', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Offline-Anwesenheit', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Alma Offline', { exact: true })).toBeVisible();
}
async function a11y(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test('manages the calendar, registrations, attendance, exports and scoped documents in DE/IT', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto('/events/categories');
  await page.getByRole('button', { name: 'Startkategorien einrichten', exact: true }).click();
  await expect(page.getByText(/^Mitgliederversammlung/)).toBeVisible();
  await page.goto('/events');
  await expect(page.locator('.fc')).toBeVisible();
  await page.locator('.fc-timeGridWeek-button').click();
  await expect(page.locator('.fc-timegrid')).toBeVisible();
  await page.locator('.fc-dayGridMonth-button').click();
  await page.locator('.fc-next-button').click();
  await a11y(page);
  await page.getByRole('button', { name: 'Veranstaltung anlegen', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titel auf Deutsch *', { exact: true }).fill('Waldtag Browser');
  await dialog.getByLabel('Titel auf Italienisch *', { exact: true }).fill('Giornata nel bosco');
  await dialog.getByLabel('Beginn *', { exact: true }).fill('2027-04-12T09:00');
  await dialog.getByLabel('Ende *', { exact: true }).fill('2027-04-12T12:00');
  await dialog.getByLabel('Status', { exact: true }).selectOption('published');
  await dialog.getByLabel('Ort', { exact: true }).fill('Brixen');
  await dialog.getByLabel('Maximale Teilnehmerzahl', { exact: true }).fill('2');
  await dialog.getByLabel('Warteliste aktivieren', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'Alle Veranstaltungen', exact: true }).click();
  await page.getByRole('link', { name: 'Waldtag Browser', exact: true }).click();
  const eventId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.getByRole('tab', { name: 'Anmeldungen', exact: true }).click();
  await page.getByRole('button', { name: 'Teilnehmer anmelden', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Neue externe Person ohne Mitgliedschaft', { exact: true }).check();
  await dialog.getByLabel('Vorname *', { exact: true }).fill('Clara');
  await dialog.getByLabel('Nachname *', { exact: true }).fill('Wald');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Clara Wald', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Anwesenheit', exact: true }).click();
  const participant = page.locator('.event-checkin-list li').filter({ hasText: 'Clara Wald' });
  await participant.getByRole('button', { name: 'Anwesend', exact: true }).click();
  await expect(participant.locator('.badge')).toHaveText('Anwesend');
  await participant.getByRole('button', { name: 'Änderungsverlauf', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Anwesend');
  await dialog.getByRole('button', { name: /^Schließen/ }).click();
  for (const [name, extension] of [
    ['Anwesenheit als CSV', 'csv'],
    ['Anwesenheit als PDF', 'pdf'],
  ]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: name!, exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`bnature-attendance-${eventId}.${extension}`);
  }
  await page.getByRole('tab', { name: 'Dokumente', exact: true }).click();
  await page.getByRole('button', { name: 'Dokument hochladen', exact: true }).click();
  await page.getByLabel('Datei *', { exact: true }).setInputFiles({
    name: 'programm.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  });
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page.getByText('programm.pdf', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Sprache: DE', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Giornata nel bosco', exact: true }),
  ).toBeVisible();
  await a11y(page);
  expect(errors).toEqual([]);
});

test('retains encrypted offline check-ins through reload, survives session expiry and resolves real conflicts', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const { event, registrations, org } = await fixture(page, 'Gelände offline');
  const adminCopy = await requestFactory.newContext({
    baseURL: appOrigin,
    storageState: await context.storageState(),
  });
  const remote = await requestFactory.newContext({ baseURL: appOrigin });
  const signed = await remote.post('/api/auth/sign-in/email', {
    headers: { Origin: appOrigin },
    data: { email: 'e2e-board@example.test', password: 'E2E-only-Password-2026!' },
  });
  expect(signed.status()).toBe(200);
  try {
    await prepare(page, event.id);
    const storage = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('bnature-attendance');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const tx = db.transaction(['copies', 'keys'], 'readonly');
      const [copies, key] = await Promise.all([
        new Promise<unknown>((resolve) => {
          const r = tx.objectStore('copies').getAll();
          r.onsuccess = () => resolve(r.result);
        }),
        new Promise<{ key: CryptoKey }>((resolve) => {
          const r = tx.objectStore('keys').get('v1');
          r.onsuccess = () => resolve(r.result);
        }),
      ]);
      db.close();
      return { raw: JSON.stringify(copies), extractable: key.key.extractable };
    });
    expect(storage.raw).not.toContain('Alma');
    expect(storage.raw).not.toContain('Bruno');
    expect(storage.extractable).toBe(false);
    await context.setOffline(true);
    const alma = () => page.locator('.event-checkin-list li').filter({ hasText: 'Alma Offline' });
    const bruno = () => page.locator('.event-checkin-list li').filter({ hasText: 'Bruno Offline' });
    for (const status of ['Anwesend', 'Abwesend', 'Anwesend'])
      await alma().getByRole('button', { name: status, exact: true }).click();
    await bruno().getByRole('button', { name: 'Entschuldigt', exact: true }).click();
    await expect(page.getByText('4 ausstehende Änderungen', { exact: false })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(alma().locator('.badge')).toHaveText('Anwesend');
    await expect(bruno().locator('.badge')).toHaveText('Entschuldigt');
    await expect(page.getByText('4 ausstehende Änderungen', { exact: false })).toBeVisible();
    const remoteChange = await remote.put(
      `/api/v1/events/${event.id}/attendance/${registrations[0].id}`,
      {
        headers: { Origin: appOrigin },
        data: {
          operationId: crypto.randomUUID(),
          requestedStatus: 'absent',
          expectedVersion: 0,
          clientCreatedAt: new Date().toISOString(),
        },
      },
    );
    expect(remoteChange.status(), await remoteChange.text()).toBe(200);
    const signedOut = await adminCopy.post('/api/auth/sign-out', {
      headers: { Origin: appOrigin },
      data: {},
    });
    expect(signedOut.status()).toBe(200);
    await context.setOffline(false);
    await expect(page.getByText(/Die Sitzung ist abgelaufen/).first()).toBeVisible();
    const before = await (await remote.get(`/api/v1/events/${event.id}/attendance`)).json();
    expect(
      before.items.find((r: { registrationId: string }) => r.registrationId === registrations[1].id)
        .status,
    ).toBe('unrecorded');
    await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
    await page.getByLabel('E-Mail', { exact: true }).fill('e2e@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('E2E-only-Password-2026!');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Abmelden', exact: true })).toBeVisible();
    await page.goto(`/offline-attendance?event=${event.id}`);
    await expect(
      page.getByRole('heading', { name: 'Konflikt – Entscheidung erforderlich', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Wert auf dem Server/)).toContainText('Abwesend');
    await page
      .getByRole('button', { name: 'Lokalen Wert ausdrücklich übernehmen', exact: true })
      .click();
    await expect(page.getByText('0 ausstehende Änderungen', { exact: false })).toBeVisible();
    await expect(alma().locator('.badge')).toHaveText('Anwesend');
    const final = await (await remote.get(`/api/v1/events/${event.id}/attendance`)).json();
    expect(
      final.items.find((r: { registrationId: string }) => r.registrationId === registrations[0].id),
    ).toMatchObject({ status: 'present', version: 2 });
    expect(
      final.items.find((r: { registrationId: string }) => r.registrationId === registrations[1].id),
    ).toMatchObject({ status: 'excused', version: 1 });
    const history = await (
      await remote.get(`/api/v1/events/${event.id}/attendance/${registrations[0].id}/history`)
    ).json();
    expect(history.items).toHaveLength(2);
    await a11y(page);
    // A prepared copy expires on the next access when its lifetime has elapsed.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('bnature-attendance');
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('copies', 'readwrite'),
          store = tx.objectStore('copies'),
          r = store.getAll();
        r.onsuccess = () => {
          for (const row of r.result) store.put({ ...row, expiresAt: '2000-01-01T00:00:00Z' });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await expect(page.getByText(/Auf diesem Gerät ist keine Veranstaltung/)).toBeVisible();
    // Prepare again, then verify a real logout removes the private IndexedDB data.
    await prepare(page, event.id);
    await page.getByRole('link', { name: 'Veranstaltungen', exact: true }).click();
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
    await page.goto('/offline-attendance');
    await expect(page.getByText(/Auf diesem Gerät ist keine Veranstaltung/)).toBeVisible();
    expect(errors).toEqual([]);
    void org;
  } finally {
    await context.setOffline(false);
    await adminCopy.dispose();
    await remote.dispose();
  }
});

test('removes offline copies when leadership rights are revoked and refuses pending writes', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const { event, registrations } = await fixture(page, 'Berechtigung im Gelände');
  const admin = await requestFactory.newContext({ baseURL: appOrigin });
  await admin.post('/api/auth/sign-in/email', {
    headers: { Origin: appOrigin },
    data: { email: 'e2e@example.test', password: 'E2E-only-Password-2026!' },
  });
  let userId = '';
  try {
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
    await login(page, 'e2e-lead@example.test');
    userId = (await (await page.request.get('/api/v1/me')).json()).user.id;
    const assigned = await admin.patch(`/api/v1/events/${event.id}`, {
      headers: writeHeaders(),
      data: { organizerId: userId, version: event.version },
    });
    expect(assigned.status(), await assigned.text()).toBe(200);
    await prepare(page, event.id);
    await context.setOffline(true);
    const alma = page.locator('.event-checkin-list li').filter({ hasText: 'Alma Offline' });
    await alma.getByRole('button', { name: 'Anwesend', exact: true }).click();
    await expect(page.getByText('1 ausstehende Änderungen', { exact: false })).toBeVisible();
    const revoked = await admin.patch(`/api/v1/users/${userId}/role`, {
      headers: { Origin: appOrigin },
      data: { role: 'member' },
    });
    expect(revoked.status(), await revoked.text()).toBe(200);
    await context.setOffline(false);
    await expect(page.getByText(/Auf diesem Gerät ist keine Veranstaltung/)).toBeVisible();
    await expect(page.getByText('Alma Offline', { exact: true })).toHaveCount(0);
    const attendance = await (await admin.get(`/api/v1/events/${event.id}/attendance`)).json();
    expect(
      attendance.items.find(
        (r: { registrationId: string }) => r.registrationId === registrations[0].id,
      ),
    ).toMatchObject({ status: 'unrecorded', version: 0 });
  } finally {
    await context.setOffline(false);
    if (userId)
      await admin.patch(`/api/v1/users/${userId}/role`, {
        headers: { Origin: appOrigin },
        data: { role: 'project_lead' },
      });
    await admin.dispose();
  }
});

test('does not restore private offline data when a delayed preparation completes after logout', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const { event } = await fixture(page, 'Vorbereitung vor Abmeldung');
  await page.goto(`/events/${event.id}?tab=attendance`);
  let release!: () => void, received!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      received = resolve;
    });
  await page.route(`**/api/v1/events/${event.id}/attendance/prepare`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    received();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole('button', { name: 'Für Offline-Nutzung vorbereiten', exact: true })
      .click();
    await ready;
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
    const finished = page.waitForResponse(`**/api/v1/events/${event.id}/attendance/prepare`);
    release();
    await finished;
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
    await page.goto('/offline-attendance');
    await expect(page.getByText(/Auf diesem Gerät ist keine Veranstaltung/)).toBeVisible();
  } finally {
    release();
  }
});
