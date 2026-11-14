// Backend-free demo: answers every /api request in the browser from recorded, invented fixtures
// (scripts/demo/record.ts). Writes change a copy kept in this browser tab only (sessionStorage).
// Only bundled when VITE_DEMO=1 (see vite.config.ts); production builds never include this file.
import adminFixtures from './fixtures/admin.json';
import memberFixtures from './fixtures/member.json';

type Json = unknown;
type Row = Record<string, unknown> & { id?: string };
type Page = { items: Row[]; total?: number };
export type DemoRole = 'admin' | 'member';
const ROLE_KEY = 'bnature-demo-role';
const uuidPart = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const realFetch = window.fetch.bind(window);

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function currentRole(): DemoRole | null {
  const value = storage()?.getItem(ROLE_KEY);
  return value === 'member' ? 'member' : value === 'none' ? null : 'admin';
}
export function setRole(role: DemoRole | null) {
  storage()?.setItem(ROLE_KEY, role ?? 'none');
  window.dispatchEvent(new Event('bnature-demo-role'));
}

// Keep the demo looking current: shift recorded timestamps forward in whole weeks (weekday stays).
function shifted(source: { recordedAt: string; responses: Record<string, Json> }) {
  const weeks = Math.floor((Date.now() - Date.parse(source.recordedAt)) / (7 * 86_400_000));
  const offset = Math.max(0, weeks) * 7 * 86_400_000;
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  const local = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2})?)$/;
  const walk = (value: Json): Json => {
    if (typeof value === 'string' && offset) {
      if (instant.test(value)) return new Date(Date.parse(value) + offset).toISOString();
      const m = local.exec(value);
      if (m)
        return new Date(Date.parse(`${m[1]}T00:00:00Z`) + offset).toISOString().slice(0, 10) + m[2];
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  return walk(structuredClone(source.responses)) as Record<string, Json>;
}

// Changes survive reloads within the same browser tab (sessionStorage), never beyond it.
const DATA_KEY = 'bnature-demo-data-';
const stores: Partial<Record<DemoRole, Record<string, Json>>> = {};
function store(role: DemoRole) {
  if (!stores[role]) {
    let saved: Record<string, Json> | undefined;
    try {
      const raw = storage()?.getItem(DATA_KEY + role);
      saved = raw ? (JSON.parse(raw) as Record<string, Json>) : undefined;
    } catch {
      saved = undefined;
    }
    stores[role] = saved ?? shifted(role === 'admin' ? adminFixtures : memberFixtures);
  }
  return stores[role];
}
function persist(role: DemoRole) {
  try {
    storage()?.setItem(DATA_KEY + role, JSON.stringify(stores[role]));
  } catch {
    // Storage full or blocked: changes then simply last until the next reload.
  }
}
export function resetDemo() {
  for (const role of ['admin', 'member'] as const) {
    delete stores[role];
    try {
      storage()?.removeItem(DATA_KEY + role);
    } catch {
      // ignore
    }
  }
}

const json = (body: Json, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const error = (status: number, code: string) =>
  json({ error: { code, message: 'Demo', requestId: 'demo' } }, status);
const isPage = (v: Json): v is Page =>
  !!v && typeof v === 'object' && Array.isArray((v as Page).items);
const rowsOf = (v: Json): Row[] | undefined =>
  Array.isArray(v) ? v : isPage(v) ? v.items : undefined;
const pattern = (path: string) =>
  path
    .split('/')
    .map((p) => (uuidPart.test(p) ? ':id' : p))
    .join('/');
const keyOf = (path: string, params: URLSearchParams) => {
  const sorted = new URLSearchParams([...params].sort(([a], [b]) => a.localeCompare(b))).toString();
  return `GET ${path}${sorted ? `?${sorted}` : ''}`;
};
function parseKey(key: string) {
  const [path, query = ''] = key.slice(4).split('?');
  return { path: path!, params: new URLSearchParams(query) };
}

function filtered(value: Json, params: URLSearchParams): Json {
  const search = params.get('search')?.trim().toLowerCase();
  const rows = rowsOf(value);
  if (!search || !rows) return value;
  const items = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search));
  return Array.isArray(value) ? items : { ...(value as Page), items, total: items.length };
}

function read(data: Record<string, Json>, path: string, params: URLSearchParams): Response {
  const exact = data[keyOf(path, params)];
  if (exact !== undefined) return json(exact);
  // Same endpoint, other filters: take the recording whose query matches best.
  let best: { score: number; value: Json } | undefined;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('GET ')) continue;
    const recorded = parseKey(key);
    if (recorded.path !== path) continue;
    let score = 0;
    for (const [k, v] of params) if (recorded.params.get(k) === v) score += 2;
    score -= [...recorded.params.keys()].filter((k) => !params.has(k)).length;
    if (!best || score > best.score) best = { score, value };
  }
  if (best) return json(filtered(best.value, params));
  // Detail of an item that only exists in a list (e.g. created during this demo session).
  const parts = path.split('/'),
    id = parts.at(-1)!;
  if (uuidPart.test(id)) {
    const parent = parts.slice(0, -1).join('/');
    for (const [key, value] of Object.entries(data))
      if (key.startsWith(`GET ${parent}`) && parseKey(key).path === parent) {
        const row = rowsOf(value)?.find((r) => r.id === id);
        if (row) return json(row);
      }
  }
  // Same kind of endpoint for another id: answer with an empty list of the same shape.
  const shape = pattern(path);
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('GET ') || pattern(parseKey(key).path) !== shape) continue;
    if (Array.isArray(value)) return json([]);
    if (isPage(value)) return json({ ...value, items: [], total: 0 });
    return json(value);
  }
  console.warn('[demo] no recorded response for', path);
  return error(404, 'NOT_FOUND');
}

function listsAt(data: Record<string, Json>, path: string) {
  return Object.entries(data).filter(
    ([key, value]) => key.startsWith('GET ') && parseKey(key).path === path && rowsOf(value),
  );
}
function findRow(data: Record<string, Json>, path: string, id: string) {
  const hits: Row[] = [];
  for (const [, value] of listsAt(data, path)) {
    const row = rowsOf(value)!.find((r) => r.id === id);
    if (row) hits.push(row);
  }
  const detail = data[`GET ${path}/${id}`];
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) hits.push(detail as Row);
  return hits;
}
function derived(body: Record<string, unknown>) {
  const now = new Date().toISOString();
  const extra: Record<string, unknown> = { updatedAt: now };
  for (const [from, to] of [
    ['startLocal', 'startAt'],
    ['endLocal', 'endAt'],
  ] as const)
    if (typeof body[from] === 'string') extra[to] = new Date(String(body[from])).toISOString();
  return extra;
}
const actionPatch: Record<string, Record<string, unknown>> = {
  publish: { state: 'published', status: 'published' },
  archive: { state: 'archived' },
  cancel: { status: 'cancelled' },
  close: { closed: true, isOpen: false, state: 'closed' },
  withdraw: { status: 'withdrawn' },
  retire: { status: 'retired' },
  end: { status: 'ended' },
};

function write(
  data: Record<string, Json>,
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  const parts = path.split('/'),
    last = parts.at(-1)!,
    parent = parts.slice(0, -1).join('/');
  const changes = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'version'));
  if (method === 'POST' && listsAt(data, path).length) {
    const lists = listsAt(data, path);
    const template = structuredClone(rowsOf(lists[0]![1])![0] ?? {});
    const now = new Date().toISOString();
    const me = (data['GET /me'] as { user?: { id?: string; name?: string } } | undefined)?.user;
    // The template is another existing row; reset what would otherwise belong to someone else.
    const own: Record<string, unknown> = {};
    for (const key of ['authorName', 'createdByName', 'recordedByName'])
      if (key in template) own[key] = me?.name ?? '';
    for (const key of ['authorId', 'createdBy']) if (key in template) own[key] = me?.id ?? '';
    if ('personId' in template) own.personId = crypto.randomUUID();
    if ('isOwn' in template) own.isOwn = true;
    if ('canRemove' in template) own.canRemove = true;
    if ('reactions' in template) own.reactions = [];
    if ('mentionsMe' in template) own.mentionsMe = false;
    if ('removedAt' in template) own.removedAt = null;
    const row: Row = {
      ...template,
      ...own,
      ...changes,
      ...derived(changes),
      id: crypto.randomUUID(),
      version: 1,
      createdAt: now,
    };
    for (const [key, value] of lists) {
      const rows = rowsOf(value)!;
      // Chronological lists (chat) get new rows at the end, everything else at the top.
      const first = rows[0]?.createdAt,
        last = rows.at(-1)?.createdAt;
      if (rows.length > 1 && typeof first === 'string' && typeof last === 'string' && first < last)
        rows.push(row);
      else rows.unshift(row);
      if (isPage(value)) data[key] = { ...value, total: (value.total ?? rows.length - 1) + 1 };
    }
    data[`GET ${path}/${row.id}`] = row;
    return json(row, 201);
  }
  if ((method === 'PATCH' || method === 'PUT') && uuidPart.test(last)) {
    const rows = findRow(data, parent, last);
    for (const row of rows)
      Object.assign(row, changes, derived(changes), { version: Number(row.version ?? 1) + 1 });
    if (rows[0]) return json(rows[0]);
  }
  if (method === 'DELETE' && uuidPart.test(last)) {
    for (const [, value] of listsAt(data, parent)) {
      const rows = rowsOf(value)!,
        index = rows.findIndex((r) => r.id === last);
      if (index >= 0) rows.splice(index, 1);
    }
    return json(null, 204);
  }
  if (method === 'POST' && actionPatch[last] && uuidPart.test(parts.at(-2) ?? '')) {
    const rows = findRow(data, parts.slice(0, -2).join('/'), parts.at(-2)!);
    for (const row of rows)
      Object.assign(row, actionPatch[last], { version: Number(row.version ?? 1) + 1 });
    return json(rows[0] ?? { ok: true });
  }
  // Settings-like singletons (profile, mail settings, organization, …).
  const single = data[`GET ${path}`];
  if (single && typeof single === 'object' && !Array.isArray(single) && !isPage(single)) {
    Object.assign(single, changes);
    return json(single);
  }
  return json({ ok: true, id: crypto.randomUUID() });
}

function auth(path: string, body: Record<string, unknown>): Response {
  const role = currentRole();
  const me = role && (store(role)['GET /me'] as { user?: Row } | undefined);
  if (path.endsWith('/sign-in/email')) {
    const email = String(body.email ?? '').toLowerCase();
    const next: DemoRole = /mitglied|member|socio|sofia/.test(email) ? 'member' : 'admin';
    setRole(next);
    const user = (store(next)['GET /me'] as { user: Row }).user;
    return json({ redirect: false, token: 'demo', user });
  }
  if (path.endsWith('/sign-out')) {
    setRole(null);
    return json({ success: true });
  }
  if (path.endsWith('/get-session'))
    return json(me ? { session: { id: 'demo', userId: me.user?.id }, user: me.user } : null);
  return json({ status: true, user: me?.user ?? null });
}

const download = (path: string) => {
  const csv = /csv|export/.test(path);
  const body = csv
    ? 'Demo;Keine echten Daten\n'
    : path.endsWith('.ics')
      ? 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//b*nature Demo//DE\r\nEND:VCALENDAR\r\n'
      : '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';
  return new Response(body, {
    headers: {
      'Content-Type': csv
        ? 'text/csv'
        : path.endsWith('.ics')
          ? 'text/calendar'
          : 'application/pdf',
    },
  });
};

async function handle(url: URL, method: string, init?: RequestInit): Promise<Response> {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  let body: Record<string, unknown> = {};
  if (typeof init?.body === 'string')
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  if (url.pathname.startsWith('/api/auth/')) return auth(url.pathname, body);
  const role = currentRole();
  if (!role) return error(401, 'UNAUTHENTICATED');
  const path = url.pathname.replace(/^\/api\/v1/, '');
  if (method === 'GET' && /\/(pdf|csv|content|export|receipt|calendar\.ics)$|\/files\//.test(path))
    return download(path);
  const data = store(role);
  if (method === 'GET' || method === 'HEAD') return read(data, path, url.searchParams);
  const response = write(data, method, path, body);
  persist(role);
  return response;
}

export function installDemo() {
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/'))
      return realFetch(input, init);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    return handle(url, method, init);
  };
}
