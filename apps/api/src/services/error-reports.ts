import { createHash } from 'node:crypto';
import { sql, desc, eq, count } from 'drizzle-orm';
import { schema as s, type Database } from '@bnature/db';
import type { Config } from '../plugins/config';
import { createMailSender } from './mail';

const r = s.errorReports;
/** Distinct problems kept; beyond that new ones are dropped so reports cannot fill the disk. */
export const MAX_REPORTS = 500;
const ALERT_PAUSE_MS = 10 * 60_000;

export type ErrorInput = {
  source: 'web' | 'api';
  name: string;
  message: string;
  stack?: string;
  location?: string;
  release?: string;
  userAgent?: string;
};
/** Notified about a problem seen for the first time. */
export type ErrorAlert = (report: Required<ErrorInput> & { id: string }) => Promise<void>;

const clip = (value: string | undefined, max: number) => (value ?? '').slice(0, max);
/**
 * Ids, numbers and quoted values differ between occurrences of the same bug and may carry
 * personal data: they are masked before a message is stored or compared.
 */
export function scrub(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/(["'`])(?:(?!\1).){0,200}\1/g, '<value>')
    .replace(/\b\d{3,}\b/g, '<n>');
}
/** Stack frames only (no message line), without origins, query strings and hashed file names. */
export function frames(stack: string) {
  return (
    stack
      .split('\n')
      .map((line) => line.trim())
      // Chrome/Node: "at fn (file:1:2)"; Firefox/Safari: "fn@file:1:2". Anything else is the
      // message, which may quote personal data and is stored separately, masked.
      .filter((line) => /^at\s/.test(line) || /^[^\s@]*@\S+:\d+(:\d+)?$/.test(line))
      .map((line) =>
        line
          .replace(/https?:\/\/[^/\s)]+/g, '')
          // Server paths: keep the part inside the project, not where it is installed.
          .replace(/(?:file:\/\/)?\/[^\s():]*?(?=\/(?:apps|packages|node_modules|tests)\/)/g, '')
          .replace(/\?[^:)\s]*/g, '')
          .replace(/-[\w-]{8}\.js/g, '.js'),
      )
      .slice(0, 12)
  );
}
export function fingerprint(input: Pick<ErrorInput, 'source' | 'name' | 'message' | 'stack'>) {
  const top = frames(input.stack ?? '')
    .slice(0, 4)
    // Line and column shift with every build; the function and file stay.
    .map((line) => line.replace(/:\d+(:\d+)?/g, ''));
  // Minified frames alone are too alike ("at e", "at t"), so the masked message counts too.
  const basis = `${scrub(input.message)}|${top.join('|')}`;
  return createHash('sha256')
    .update(`${input.source}|${input.name}|${basis}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Stores or counts a problem. Must never throw: it runs inside error handling, and a failing
 * report must not turn into a second failure.
 */
export async function recordError(db: Database, input: ErrorInput, alert?: ErrorAlert | null) {
  try {
    const row = {
      source: input.source,
      fingerprint: fingerprint(input),
      name: clip(input.name, 100) || 'Error',
      message: clip(scrub(input.message), 500),
      stack: frames(input.stack ?? '')
        .join('\n')
        .slice(0, 4000),
      location: clip(input.location, 300),
      release: clip(input.release, 60),
      userAgent: clip(input.userAgent, 300),
    };
    const [known] = await db
      .update(r)
      .set({
        occurrences: sql`${r.occurrences}+1`,
        lastSeenAt: new Date(),
        message: row.message,
        stack: row.stack,
        location: row.location,
        release: row.release,
        userAgent: row.userAgent,
      })
      .where(sql`${r.source}=${row.source} and ${r.fingerprint}=${row.fingerprint}`)
      .returning({ id: r.id });
    if (known) return { id: known.id, isNew: false };
    const [total] = await db.select({ n: count() }).from(r);
    if ((total?.n ?? 0) >= MAX_REPORTS) return null;
    const [created] = await db
      .insert(r)
      .values(row)
      .onConflictDoNothing({ target: [r.source, r.fingerprint] })
      .returning({ id: r.id });
    if (!created) return null;
    if (alert) void alert({ ...row, id: created.id }).catch(() => undefined);
    return { id: created.id, isNew: true };
  } catch {
    return null;
  }
}

export function listErrorReports(db: Database) {
  return db
    .select({
      id: r.id,
      source: r.source,
      name: r.name,
      message: r.message,
      stack: r.stack,
      location: r.location,
      release: r.release,
      userAgent: r.userAgent,
      occurrences: r.occurrences,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
    })
    .from(r)
    .orderBy(desc(r.lastSeenAt), r.id)
    .limit(200);
}
export async function dismissErrorReport(db: Database, id: string) {
  const removed = await db.delete(r).where(eq(r.id, id)).returning({ id: r.id });
  return removed.length > 0;
}

/**
 * E-mail to the operator when a problem appears for the first time, at most one every ten
 * minutes so a broken release does not flood the inbox. Off without ERROR_ALERT_EMAIL.
 */
export function createErrorAlert(config: Config): { alert: ErrorAlert | null; close(): void } {
  const recipient = config.ERROR_ALERT_EMAIL;
  if (!recipient || config.EMAIL_MODE === 'disabled') return { alert: null, close: () => {} };
  const sender = createMailSender(config);
  let last = 0;
  return {
    close: () => sender.close(),
    alert: async (report) => {
      if (Date.now() - last < ALERT_PAUSE_MS) return;
      last = Date.now();
      await sender.send({
        id: report.id,
        recipient,
        subject: `[b*nature] Neuer Fehler (${report.source}): ${report.name}`,
        text: [
          `${report.name}: ${report.message}`,
          `Ort: ${report.location || '–'}`,
          `Version: ${report.release || '–'}`,
          '',
          report.stack || '(kein Stack)',
          '',
          `Alle Fehler: ${config.APP_URL}/audit`,
          'Weitere neue Fehler der nächsten zehn Minuten werden nicht einzeln gemeldet.',
        ].join('\n'),
      });
    },
  };
}
