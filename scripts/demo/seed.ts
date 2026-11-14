/* eslint-disable @typescript-eslint/no-explicit-any -- seed data script: responses are only read for ids. */
// Fills the disposable bnature_test database with invented demo data through the real API, so
// recorded responses (scripts/demo/record.ts) match the contracts exactly. Never run against real data.
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createDatabase, schema as s } from '../../packages/db/src';
import { bootstrap } from '../../apps/api/src/services/bootstrap';
import { createAuth } from '../../apps/api/src/auth';
import { readConfig } from '../../apps/api/src/plugins/config';
import { DEMO_ADMIN, DEMO_PASSWORD } from './accounts';
import { encodeDocumentMetadata } from '../../packages/contracts/src';

const config = readConfig();
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('/bnature_test'))
  throw new Error('Only the dedicated bnature_test database may be reset');
const base = `http://127.0.0.1:${config.PORT}`,
  origin = new URL(config.APP_URL).origin;

const { db, pool } = createDatabase(config.DATABASE_URL);
await migrate(db, { migrationsFolder: 'packages/db/migrations' });
await db.execute(sql`truncate table organizations, users cascade`);
const boot = await bootstrap(db, config, {
  name: 'Anna Pichler',
  email: DEMO_ADMIN,
  password: DEMO_PASSWORD,
  organizationName: 'b*nature Brixen (Demo)',
  slug: 'bnature-demo',
});
const org = boot.organizationId;
const provision = createAuth(db, config, true);
const staff = [
  ['treasurer', 'Markus Gruber', 'markus.gruber@demo.bnature.example'],
  ['board', 'Giulia Rossi', 'giulia.rossi@demo.bnature.example'],
  ['project_lead', 'Lukas Mair', 'lukas.mair@demo.bnature.example'],
  ['member', 'Sofia Pernter', 'sofia.pernter@demo.bnature.example'],
] as const;
for (const [role, name, email] of staff) {
  const created = await provision.api.signUpEmail({
    body: { name, email, password: DEMO_PASSWORD },
  });
  await db
    .insert(s.organizationUserRoles)
    .values({ organizationId: org, userId: created.user.id, role });
}

let ip = 1;
const sessions = new Map<string, string>();
async function session(email: string) {
  if (sessions.has(email)) return sessions.get(email)!;
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'X-Forwarded-For': `10.0.0.${ip++}`,
    },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (res.status === 429) {
    console.log('sign-in rate limit, waiting 61 s …');
    await new Promise((r) => setTimeout(r, 61_000));
    return session(email);
  }
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  sessions.set(email, cookie);
  return cookie;
}
let failures = 0;
function client(cookie: string) {
  return async function call<T = any>(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<T> {
    const raw = body instanceof Uint8Array;
    const key = ['POST', 'PUT', 'PATCH'].includes(method) ? randomUUID() : undefined;
    for (;;) {
      const res = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          Cookie: cookie,
          Origin: origin,
          'X-Organization-Id': org,
          'X-Forwarded-For': `10.1.${Math.floor(ip / 250)}.${ip++ % 250}`,
          ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...extra,
        },
        body:
          body === undefined
            ? undefined
            : raw
              ? (body as Uint8Array<ArrayBuffer>)
              : JSON.stringify(body),
      });
      if (res.status === 429) {
        const waitSeconds = Math.max(1, Number(res.headers.get('retry-after') ?? 60)) + 1;
        console.log(`api rate limit on ${method} ${path}, waiting ${waitSeconds} s …`);
        await new Promise((r) => setTimeout(r, waitSeconds * 1000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        failures++;
        console.warn(`✗ ${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
        return undefined as T;
      }
      return (text ? JSON.parse(text) : undefined) as T;
    }
  };
}
const admin = client(await session(DEMO_ADMIN));
const items = (r: any) => (Array.isArray(r) ? r : (r?.items ?? r?.data ?? []));

// --- Dates relative to today, so the demo always looks current.
const today = new Date();
const day = (offset: number) =>
  new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const local = (offset: number, hm: string) => `${day(offset)}T${hm}`;
const instant = (offset: number, hm: string) =>
  new Date(`${day(offset)}T${hm}:00+01:00`).toISOString();
const year = today.getFullYear();

// --- Members
const people = [
  ['Anna', 'Pichler', 'Brixen', 'de'],
  ['Markus', 'Gruber', 'Brixen', 'de'],
  ['Giulia', 'Rossi', 'Bozen', 'it'],
  ['Lukas', 'Mair', 'Klausen', 'de'],
  ['Sofia', 'Pernter', 'Brixen', 'de'],
  ['Matteo', 'Bianchi', 'Brixen', 'it'],
  ['Hannah', 'Oberhofer', 'Vahrn', 'de'],
  ['Elias', 'Kofler', 'Natz-Schabs', 'de'],
  ['Chiara', 'Ferrari', 'Bozen', 'it'],
  ['Jakob', 'Unterkircher', 'Lüsen', 'de'],
  ['Lena', 'Hofer', 'Brixen', 'de'],
  ['Paul', 'Plank', 'Feldthurns', 'de'],
  ['Martina', 'Costa', 'Brixen', 'it'],
  ['Simon', 'Messner', 'Villnöß', 'de'],
  ['Laura', 'Thaler', 'Brixen', 'de'],
  ['Davide', 'Moretti', 'Klausen', 'it'],
  ['Magdalena', 'Rainer', 'Vahrn', 'de'],
  ['Tobias', 'Fischnaller', 'Brixen', 'de'],
  ['Elisa', 'Ricci', 'Bozen', 'it'],
  ['Florian', 'Kerschbaumer', 'Mühlbach', 'de'],
  ['Valentina', 'Gallo', 'Brixen', 'it'],
  ['Maximilian', 'Brunner', 'Brixen', 'de'],
  ['Theresa', 'Gasser', 'Lajen', 'de'],
  ['Andrea', 'Romano', 'Brixen', 'it'],
] as const;
const members: any[] = [];
for (const [i, [firstName, lastName, city, lang]] of people.entries()) {
  const status = i === 21 ? 'pending' : i === 22 ? 'inactive' : 'active';
  const m = await admin('POST', '/members', {
    firstName,
    lastName,
    email:
      `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + '@demo.bnature.example',
    phone: `+39 333 ${String(1000000 + i * 7919).slice(0, 7)}`,
    street:
      ['Domplatz', 'Großer Graben', 'Via Roma', 'Fischzuchtweg', 'Plosestraße'][i % 5] +
      ` ${i + 3}`,
    postalCode: city === 'Bozen' ? '39100' : '39042',
    city,
    preferredLanguage: lang,
    dateOfBirth: `${1960 + ((i * 7) % 45)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
    membershipNumber: `BN-${String(i + 1).padStart(3, '0')}`,
    membershipType: i % 9 === 4 ? 'supporting' : i === 13 ? 'honorary' : 'ordinary',
    status,
    joinedAt: `${2015 + (i % 11)}-0${(i % 9) + 1}-01`,
  });
  if (m) members.push(m);
}
console.log(`members: ${members.length}`);
const personOf = (i: number) => members[i]?.personId;
const accountEmails = [DEMO_ADMIN, ...staff.map((entry) => entry[2])];
const accountRows = await db
  .select({ id: s.user.id, email: s.user.email })
  .from(s.user)
  .where(inArray(s.user.email, accountEmails));
const userByEmail = new Map(accountRows.map((row) => [row.email.toLowerCase(), row.id]));
for (const [index, email] of accountEmails.entries()) {
  const userId = userByEmail.get(email.toLowerCase());
  const personId = personOf(index);
  if (userId && personId) {
    await db
      .insert(s.personUserLinks)
      .values({ organizationId: org, userId, personId })
      .onConflictDoNothing();
  }
}
await pool.end();

// --- Groups and board
const groupDefs = [
  ['Lebensräume', 'Pflege von Feuchtwiesen, Hecken und Trockenmauern.', [0, 3, 6, 7, 9, 13, 16]],
  [
    'Amphibienschutz',
    'Krötenzäune im Frühjahr, Monitoring an den Laichgewässern.',
    [1, 4, 10, 14, 17],
  ],
  ['Umweltbildung', 'Führungen und Projekttage mit Schulen und Familien.', [2, 5, 8, 12, 18, 20]],
  ['Jugendgruppe', 'Naturerlebnis für 12- bis 18-Jährige.', [11, 15, 19, 23]],
] as const;
const groups: any[] = [];
for (const [name, description, idx] of groupDefs) {
  const g = await admin('POST', '/groups', { name, description });
  if (!g) continue;
  groups.push(g);
  await admin('PUT', `/groups/${g.id}/members`, { personIds: idx.map(personOf).filter(Boolean) });
}
for (const [i, position, start] of [
  [0, 'Präsidentin', '2024-04-15'],
  [2, 'Vizepräsidentin', '2024-04-15'],
  [1, 'Kassier', '2024-04-15'],
  [6, 'Schriftführerin', '2024-04-15'],
  [3, 'Beirat', '2022-04-10'],
] as const)
  await admin('POST', '/board-mandates', { personId: personOf(i), position, startDate: start });

// --- Events
await admin('POST', '/event-categories/initialize', {});
let categories = items(await admin('GET', '/event-categories'));
if (!categories.length) {
  for (const [de, it] of [
    ['Arbeitseinsatz', 'Giornata di lavoro'],
    ['Exkursion', 'Escursione'],
    ['Vortrag', 'Conferenza'],
    ['Sitzung', 'Riunione'],
  ])
    await admin('POST', '/event-categories', { nameI18n: { de, it } });
  categories = items(await admin('GET', '/event-categories'));
}
const cat = (n: number) => categories[n % categories.length].id;
const eventDefs: [string, string, number, string, string, string, number, number | null, string][] =
  [
    [
      'Heckenpflege am Raiermoos',
      'Cura delle siepi al Raiermoos',
      -24,
      '09:00',
      '13:00',
      'Raiermoos, Vahrn',
      0,
      20,
      'completed',
    ],
    [
      'Vogelkundliche Exkursion',
      'Escursione ornitologica',
      -10,
      '07:30',
      '10:30',
      'Treffpunkt Bahnhof Brixen',
      1,
      15,
      'completed',
    ],
    [
      'Vortrag: Insektensterben',
      'Conferenza: la moria degli insetti',
      -3,
      '19:30',
      '21:00',
      'Forum Brixen',
      2,
      80,
      'completed',
    ],
    [
      'Vorstandssitzung November',
      'Riunione del direttivo di novembre',
      2,
      '19:00',
      '21:00',
      'Vereinslokal, Domplatz 3',
      3,
      null,
      'published',
    ],
    [
      'Trockenmauer-Workshop',
      'Workshop muri a secco',
      6,
      '09:00',
      '16:00',
      'Feldthurns, Hof Plank',
      0,
      12,
      'published',
    ],
    [
      'Wintervögel füttern – Familiennachmittag',
      'Pomeriggio per famiglie: nutrire gli uccelli',
      12,
      '14:00',
      '17:00',
      'Hofburggarten Brixen',
      1,
      25,
      'published',
    ],
    [
      'Nistkästen bauen',
      'Costruiamo nidi artificiali',
      19,
      '09:00',
      '12:30',
      'Werkstatt Jugendhaus Kassianeum',
      0,
      10,
      'published',
    ],
    [
      'Weihnachtsfeier',
      'Festa di Natale',
      34,
      '18:30',
      '22:00',
      'Gasthof Fischer, Klausen',
      3,
      60,
      'published',
    ],
    [
      'Vortrag: Wölfe in Südtirol',
      'Conferenza: il lupo in Alto Adige',
      45,
      '19:30',
      '21:00',
      'Forum Brixen',
      2,
      100,
      'draft',
    ],
    [
      'Krötenzaun-Aufbau',
      'Montaggio barriere per rospi',
      120,
      '08:00',
      '12:00',
      'Vahrner See',
      0,
      25,
      'draft',
    ],
  ];
const events: any[] = [];
for (const [de, it, off, start, end, location, c, capacity, status] of eventDefs) {
  const e = await admin('POST', '/events', {
    titleI18n: { de, it },
    descriptionI18n: {
      de: `${de}. Bitte wetterfeste Kleidung mitbringen. Für Verpflegung ist gesorgt.`,
      it: `${it}. Si prega di portare abbigliamento adatto. Il ristoro è garantito.`,
    },
    categoryId: cat(c),
    startLocal: local(off, start),
    endLocal: local(off, end),
    location,
    latitude: location.includes('Feldthurns')
      ? 46.6687
      : location.includes('Hofburggarten')
        ? 46.7155
        : null,
    longitude: location.includes('Feldthurns')
      ? 11.5944
      : location.includes('Hofburggarten')
        ? 11.6562
        : null,
    project: c === 0 ? 'Lebensraum Eisacktal' : '',
    status: status === 'completed' ? 'published' : status,
    visibility: c === 3 ? 'internal' : 'members',
    capacity,
    waitlistEnabled: capacity !== null && capacity <= 12,
  });
  if (e) events.push(e);
}
for (const [n, e] of events.entries()) {
  if (e.status === 'draft') continue;
  const count = e.capacity
    ? Math.min(e.capacity + (e.waitlistEnabled ? 2 : 0), 6 + ((n * 5) % 12))
    : 7;
  const registered = new Set<number>();
  for (let k = 0; k < count; k++) {
    const idx = (n * 3 + k) % members.length;
    registered.add(idx);
    await admin('POST', `/events/${e.id}/registrations`, {
      personId: personOf(idx),
      overrideDeadline: true,
    });
  }
  if ((n === 4 || n === 5) && !registered.has(4) && personOf(4))
    await admin('POST', `/events/${e.id}/registrations`, {
      personId: personOf(4),
      overrideDeadline: true,
    });
}
// Past events: mark attendance where possible.
for (const e of events.filter((ev) => ev.startAt < today.toISOString())) {
  const sheet = await admin('GET', `/events/${e.id}/attendance`);
  for (const [k, r] of items(sheet?.participants ?? sheet).entries())
    await admin('PUT', `/events/${e.id}/attendance/${r.registrationId}`, {
      operationId: randomUUID(),
      requestedStatus: k % 6 === 5 ? 'absent' : k % 9 === 8 ? 'excused' : 'present',
      expectedVersion: r.version,
      clientCreatedAt: new Date().toISOString(),
    });
}
await admin('POST', '/event-series', {
  event: {
    titleI18n: { de: 'Offener Vereinsabend', it: 'Serata aperta dell’associazione' },
    descriptionI18n: {
      de: 'Austausch, Planung und Kuchen. Gäste willkommen.',
      it: 'Scambio, pianificazione e torta. Ospiti benvenuti.',
    },
    categoryId: cat(3),
    startLocal: local(9, '19:30'),
    endLocal: local(9, '21:30'),
    location: 'Vereinslokal, Domplatz 3',
    status: 'published',
    visibility: 'members',
    registrationRequired: false,
  },
  recurrenceRule: 'FREQ=MONTHLY;COUNT=6',
});

// --- Volunteers
const engagements: any[] = [];
for (const [i, type, focus, activity] of [
  [0, 'regular', ['Lebensräume', 'Leitung'], 'Koordination Arbeitseinsätze'],
  [3, 'regular', ['Trockenmauern'], 'Anleitung Trockenmauerbau'],
  [4, 'regular', ['Amphibienschutz'], 'Betreuung Krötenzaun'],
  [6, 'regular', ['Umweltbildung'], 'Führungen mit Schulklassen'],
  [7, 'occasional', ['Lebensräume'], 'Helfer bei Arbeitseinsätzen'],
  [10, 'regular', ['Amphibienschutz', 'Monitoring'], 'Laichgewässer-Monitoring'],
  [12, 'occasional', ['Umweltbildung'], 'Unterstützung bei Familientagen'],
  [16, 'occasional', ['Lebensräume'], 'Heckenpflege'],
  [18, 'regular', ['Öffentlichkeitsarbeit'], 'Social Media und Fotos'],
] as const) {
  const m = members[i];
  const e = await admin('POST', '/volunteers', {
    personId: m?.personId,
    volunteerType: type,
    startedOn: day(-400 + i * 11),
    focusAreas: focus,
    activity,
    registerData: {
      fiscalCode: '',
      dateOfBirth: m?.dateOfBirth ?? null,
      birthPlace: m?.city ?? 'Brixen',
      street: m?.street ?? '',
      postalCode: m?.postalCode ?? '',
      city: m?.city ?? '',
    },
  });
  if (e) engagements.push(e);
}
const users = items(await admin('GET', '/users'));
const lead = users.find((u: any) => u.email?.startsWith('lukas'))?.id ?? null;
const assignments: any[] = [];
for (const [n, eng] of engagements.entries()) {
  const ev = events[n % 7];
  if (!ev) continue;
  const a = await admin('POST', '/volunteer-assignments', {
    engagementId: eng.id,
    eventOccurrenceId: ev.id,
    role: n === 0 ? 'lead' : 'helper',
    task: [
      'Werkzeug vorbereiten',
      'Gruppe anleiten',
      'Anmeldung betreuen',
      'Material transportieren',
      'Fotos machen',
    ][n % 5],
    plannedStart: ev.startAt,
    plannedEnd: ev.endAt,
    responsibleUserId: lead,
    project: ev.project ?? '',
  });
  if (a) assignments.push(a);
}
for (const [n, eng] of engagements.entries())
  for (let k = 0; k < 3; k++) {
    const off = -60 + n * 4 + k * 13;
    if (off >= -1) continue;
    await admin('POST', '/volunteer-time-entries', {
      engagementId: eng.id,
      actualStart: instant(off, '08:30'),
      actualEnd: instant(off, k === 1 ? '16:00' : '12:30'),
      breakMinutes: k === 1 ? 45 : 0,
      description: [
        'Heckenschnitt',
        'Trockenmauer ausbessern',
        'Krötenzaun kontrollieren',
        'Führung Grundschule Milland',
      ][(n + k) % 4],
      project: 'Lebensraum Eisacktal',
      submit: true,
    });
  }
const entries = items(await admin('GET', '/volunteer-time-entries?status=submitted&pageSize=100'));
for (const [k, t] of entries.entries())
  if (k % 3 !== 2)
    await admin('POST', `/volunteer-time-entries/${t.id}/decision`, {
      version: t.version,
      decision: 'confirm',
    });
const policy = await admin('POST', '/insurance-policies', {
  insurer: 'Assicurazioni Alpine (Demo)',
  policyNumber: 'DEMO-2026-0815',
  coverageTypes: ['accident', 'liability'],
  startsOn: `${year}-01-01`,
  endsOn: `${year}-12-31`,
  insuredGroup: 'all',
  notes: 'Pflichtversicherung für Freiwillige nach Art. 18 D.lgs. 117/2017.',
});
if (policy)
  await admin('POST', `/insurance-policies/${policy.id}/coverages`, {
    engagementIds: engagements.slice(0, 7).map((e) => e.id),
    coveredFrom: `${year}-01-01`,
  });

// --- Finance
await admin('POST', '/finance/initialize', {});
const plan = await admin('POST', '/fee-plans', {
  name: `Mitgliedsbeitrag ${year}`,
  description: 'Ordentliche Mitglieder',
  amountCents: 2500,
  interval: 'annual',
  membershipType: 'ordinary',
});
const supportPlan = await admin('POST', '/fee-plans', {
  name: `Förderbeitrag ${year}`,
  description: 'Fördernde Mitglieder',
  amountCents: 6000,
  interval: 'annual',
  membershipType: 'supporting',
});
await admin('POST', '/fee-plans', {
  name: 'Jugendbeitrag',
  description: 'Bis 18 Jahre',
  amountCents: 1000,
  interval: 'annual',
  membershipType: null,
});
let accounts = items(await admin('GET', '/finance/accounts'));
if (!accounts.length) {
  await admin('POST', '/finance/accounts', { name: 'Kassa', kind: 'cash' });
  await admin('POST', '/finance/accounts', {
    name: 'Raiffeisenkasse Eisacktal',
    kind: 'bank',
    iban: 'IT60X0542811101000000123456',
  });
  accounts = items(await admin('GET', '/finance/accounts'));
}
const ledgerCats = items(await admin('GET', '/finance/categories'));
const fy = items(await admin('GET', '/finance/fiscal-years'));
if (!fy.some((f: any) => f.year === year))
  await admin('POST', '/finance/fiscal-years', {
    year,
    openingBalances: accounts.map((a: any, k: number) => ({
      accountId: a.id,
      amountCents: k ? 842_350 : 31_520,
    })),
  });
const bank = accounts.find((a: any) => a.kind === 'bank') ?? accounts[0];
const cash = accounts.find((a: any) => a.kind === 'cash') ?? accounts[0];
const feeCat = ledgerCats.find((c: any) => c.classification === 'membership_fee');
if (plan)
  for (const [k, m] of members.entries()) {
    const memberPlan = m.membershipType === 'supporting' ? supportPlan : plan;
    if (!memberPlan || m.status !== 'active' || m.membershipType === 'honorary') continue;
    const a = await admin('POST', '/fee-assessments', {
      membershipId: m.id,
      planId: memberPlan.id,
      fiscalYear: year,
      dueDate: `${year}-03-31`,
    });
    if (a && k % 4 !== 3)
      await admin('POST', '/payments', {
        payerName: `${m.firstName} ${m.lastName}`,
        paidOn: day(-200 + k * 5),
        method: k % 3 ? 'bank_transfer' : 'cash',
        reference: `Beitrag ${year} ${m.membershipNumber}`,
        amountCents: memberPlan.amountCents,
        allocations: [{ assessmentId: a.id, amountCents: memberPlan.amountCents }],
        booking:
          feeCat && bank ? { accountId: k % 3 ? bank.id : cash.id, categoryId: feeCat.id } : null,
      });
  }
const income = ledgerCats.filter(
  (c: any) => c.direction === 'income' && c.classification === 'other',
);
const expense = ledgerCats.filter((c: any) => c.direction === 'expense');
for (const [k, [desc, amount, dir, counterparty]] of (
  [
    ['Beitrag Gemeinde Brixen – Projekt Feuchtwiesen', 150000, 'in', 'Gemeinde Brixen'],
    ['Spende Raiffeisenkasse', 50000, 'in', 'Raiffeisenkasse Eisacktal'],
    ['Werkzeug Heckenpflege', 18990, 'out', 'Baumarkt Brixen'],
    ['Saalmiete Forum – Vortrag', 24000, 'out', 'Forum Brixen'],
    ['Druck Jahresprogramm', 41250, 'out', 'Athesia Druck'],
    ['Versicherungsprämie Freiwillige', 32000, 'out', 'Assicurazioni Alpine'],
    ['Getränke Arbeitseinsatz', 6420, 'out', 'Despar Vahrn'],
    ['Erlös Kuchenverkauf', 38550, 'in', 'Familiennachmittag'],
  ] as const
).entries()) {
  const list = dir === 'in' ? income : expense;
  if (!list.length || !bank) continue;
  await admin('POST', '/finance/cashbook', {
    accountId: k % 3 === 2 ? cash.id : bank.id,
    categoryId: list[k % list.length].id,
    project: k === 0 ? 'Lebensraum Eisacktal' : '',
    amountCents: amount,
    bookingDate: day(-180 + k * 19),
    documentDate: day(-181 + k * 19),
    documentNumber: `B-${year}-${String(k + 1).padStart(3, '0')}`,
    description: desc,
    counterparty,
  });
}

// --- Inventory
const inventory: any[] = [];
for (const [k, [name, category, location, condition, quantity, value]] of (
  [
    ['Astschere', 'Werkzeug', 'Lager Vahrn', 'good', 6, 4500],
    ['Motorsense Stihl FS 131', 'Maschinen', 'Lager Vahrn', 'good', 1, 69000],
    ['Schubkarre', 'Werkzeug', 'Lager Vahrn', 'worn', 3, 8900],
    ['Fernglas 8x42', 'Optik', 'Vereinslokal', 'good', 8, 21000],
    ['Spektiv mit Stativ', 'Optik', 'Vereinslokal', 'new', 1, 129000],
    ['Krötenzaun (Rolle 50 m)', 'Amphibienschutz', 'Lager Vahrn', 'good', 12, 6500],
    ['Kescher', 'Umweltbildung', 'Vereinslokal', 'damaged', 10, 1500],
    ['Pavillon 3x3 m', 'Veranstaltung', 'Lager Vahrn', 'good', 2, 25000],
    ['Beamer Epson', 'Technik', 'Vereinslokal', 'good', 1, 54000],
    ['Wildkamera', 'Monitoring', 'Vereinslokal', 'good', 4, 11900],
  ] as const
).entries()) {
  const item = await admin('POST', '/inventory/items', {
    inventoryNumber: `INV-${String(k + 1).padStart(3, '0')}`,
    name,
    category,
    location,
    condition,
    quantity,
    valueCents: value,
    purchasedOn: `${2019 + (k % 7)}-0${(k % 9) + 1}-15`,
    description: '',
  });
  if (item) inventory.push(item);
}
for (const [k, [itemIdx, person, issued, due]] of (
  [
    [3, 5, -20, 10],
    [9, 10, -45, -5],
    [0, 3, -2, 5],
    [4, 8, -8, 20],
    [8, 2, -1, 1],
  ] as const
).entries())
  if (inventory[itemIdx])
    await admin('POST', '/inventory/loans', {
      itemId: inventory[itemIdx].id,
      personId: personOf(person),
      quantity: k === 2 ? 2 : 1,
      issuedOn: day(issued),
      dueOn: day(due),
      notes: '',
    });

// --- Community
const posts = [
  {
    kind: 'news',
    pinned: true,
    titleI18n: { de: 'Jahresprogramm 2027 ist online', it: 'Il programma 2027 è online' },
    bodyI18n: {
      de: 'Liebe Mitglieder, das Jahresprogramm für 2027 steht! Ihr findet alle Termine im Kalender. Wir freuen uns auf viele gemeinsame Einsätze.',
      it: 'Cari soci, il programma per il 2027 è pronto! Trovate tutte le date nel calendario.',
    },
  },
  {
    kind: 'news',
    titleI18n: {
      de: 'Rückblick: Heckenpflege am Raiermoos',
      it: 'Resoconto: cura delle siepi al Raiermoos',
    },
    bodyI18n: {
      de: '18 Freiwillige haben über 400 m Hecke gepflegt. Danke an alle! Besonders die Jugendgruppe war mit vollem Einsatz dabei.',
      it: '18 volontari hanno curato oltre 400 m di siepe. Grazie a tutti!',
    },
  },
  {
    kind: 'news',
    titleI18n: { de: 'Neue Ferngläser für Exkursionen', it: 'Nuovi binocoli per le escursioni' },
    bodyI18n: {
      de: 'Dank einer Spende konnten wir acht neue Ferngläser anschaffen. Sie können ab sofort im Inventar ausgeliehen werden.',
      it: 'Grazie a una donazione abbiamo acquistato otto nuovi binocoli, disponibili in prestito.',
    },
  },
  {
    kind: 'poll',
    titleI18n: {
      de: 'Wohin geht der Vereinsausflug 2027?',
      it: 'Dove andiamo per la gita sociale 2027?',
    },
    bodyI18n: {
      de: 'Stimmt ab – Ergebnisse nach eurer Stimme.',
      it: 'Votate – i risultati dopo il vostro voto.',
    },
    options: [
      { de: 'Nationalpark Stilfserjoch', it: 'Parco Nazionale dello Stelvio' },
      { de: 'Naturpark Puez-Geisler', it: 'Parco naturale Puez-Odle' },
      { de: 'Biotop Castelfeder', it: 'Biotopo Castelfeder' },
    ],
    closesAt: instant(14, '23:00'),
    resultsVisibility: 'after_vote',
  },
] as const;
for (const p of posts) {
  const created = await admin('POST', '/community/posts', p);
  const post = created && (await admin('GET', `/community/posts/${created.id}`));
  if (post)
    await admin('POST', `/community/posts/${created.id}/publish`, { version: post.version });
}
const chatters = [DEMO_ADMIN, ...staff.map((x) => x[2])];
const chatLines = [
  [1, 'Hat jemand die Schlüssel für das Lager in Vahrn?'],
  [3, 'Ja, liegen im Vereinslokal in der Schublade beim Beamer.'],
  [0, 'Danke Lukas! Für Samstag haben sich schon 9 Leute angemeldet 🎉'],
  [2, 'Ottimo! Porto io il caffè per tutti.'],
  [4, 'Ich bringe Kuchen mit. Treffpunkt wie immer am Parkplatz?'],
  [
    0,
    'Genau, 8:45 am Parkplatz. Bitte Arbeitshandschuhe nicht vergessen. Infos: https://www.bnature.bz',
  ],
] as const;
for (const [who, body] of chatLines) {
  const c = client(await session(chatters[who]!));
  await c('POST', '/community/chat', { body });
}
if (groups[1]) {
  const sofia = client(await session(staff[3][2]));
  await sofia('POST', '/community/chat', {
    groupId: groups[1].id,
    body: 'Treffpunkt für die Laichgewässer-Runde: https://www.bnature.bz',
  });
}
const schedule = await admin('POST', '/community/schedules', {
  titleI18n: { de: 'Termin für die Jahreshauptversammlung', it: 'Data per l’assemblea generale' },
  descriptionI18n: {
    de: 'Bitte tragt ein, wann ihr könnt.',
    it: 'Indicate quando siete disponibili.',
  },
  location: 'Forum Brixen',
  closesAt: instant(20, '20:00'),
  slots: [
    [60, '19:00'],
    [62, '19:00'],
    [67, '19:00'],
  ].map(([o, h]) => ({
    startAt: instant(o as number, h as string),
    endAt: instant(o as number, '21:30'),
  })),
});
if (schedule) {
  const detail = await admin('GET', `/community/schedules/${schedule.id}`);
  const slots = detail?.slots ?? [];
  for (const [k, email] of chatters.entries()) {
    const c = client(await session(email));
    await c('PUT', `/community/schedules/${schedule.id}/answers`, {
      answers: slots.map((sl: any, j: number) => ({
        slotId: sl.id,
        answer: (['yes', 'maybe', 'no'] as const)[(k + j) % 3],
      })),
    });
  }
}

// --- Compliance, mail, documents
await admin('POST', '/compliance-rules/initialize', {});
await admin('POST', '/compliance-deadlines/generate', {
  from: `${year}-01-01`,
  to: `${year + 1}-12-31`,
});
for (const g of groups.slice(0, 1))
  await admin('POST', '/mail/newsletters', {
    subjectI18n: { de: 'Einladung zur Weihnachtsfeier', it: 'Invito alla festa di Natale' },
    bodyI18n: {
      de: 'Liebe Mitglieder,\n\nwir laden euch herzlich zur Weihnachtsfeier ein.',
      it: 'Cari soci,\n\nvi invitiamo cordialmente alla festa di Natale.',
    },
    groupIds: [g.id],
  });
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
for (const [title, category, filename] of [
  ['Statut b*nature (Fassung 2024)', 'statute', 'statut-2024.pdf'],
  ['Protokoll Vollversammlung 2026', 'minutes', 'protokoll-vv-2026.pdf'],
  ['Versicherungspolizze Freiwillige', 'insurance', 'polizze-2026.pdf'],
  ['Förderzusage Gemeinde Brixen', 'funding', 'foerderung-gemeinde.pdf'],
  ['Rechnung Baumarkt', 'invoice', 'rechnung-baumarkt.pdf'],
] as const)
  await admin('POST', '/documents', pdf, {
    'Content-Type': 'application/pdf',
    'X-Document-Metadata': encodeDocumentMetadata({ title, category, filename, description: '' }),
  });

console.log(
  failures ? `Demo seed finished with ${failures} failed request(s).` : 'Demo seed finished.',
);
