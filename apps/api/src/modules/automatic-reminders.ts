import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import { can } from '@bnature/contracts';
import type { Config } from '../plugins/config';
import { audit } from '../services/audit';
import { businessDate } from './finance/service';
import { deadlineReminderMail, loanReminderMail } from './mail-templates';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysUntil = (due: string, today: string) =>
  Math.round((day(due) - day(today)) / 86_400_000);
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Configured days before, the due day itself, the first day overdue and then weekly. */
export function deadlineReminderDue(daysLeft: number, reminderDays: number[]) {
  if (daysLeft > 0) return reminderDays.includes(daysLeft);
  return daysLeft === 0 || (daysLeft < 0 && (-daysLeft - 1) % 7 === 0);
}
/** Two days before, the first day overdue and then weekly. */
export function loanReminderDue(daysLeft: number) {
  return daysLeft === 2 || (daysLeft < 0 && (-daysLeft - 1) % 7 === 0);
}

type Kind = 'deadline' | 'loan';
const column = {
  deadline: {
    flag: s.mailSettings.automaticDeadlineReminders,
    run: s.mailSettings.deadlineLastRunOn,
  },
  loan: { flag: s.mailSettings.automaticLoanReminders, run: s.mailSettings.loanLastRunOn },
};

/**
 * Daily, per organization: re-checks the switch and the enabling admin under the organization
 * lock (like automatic fee reminders), queues due mails with a per-day dedupe key and records
 * the run date. A server that was down on a reminder day does not catch up on it.
 */
async function forEachDueOrganization(
  db: Database,
  kind: Kind,
  now: Date,
  work: (
    tx: Executor,
    org: typeof s.organizations.$inferSelect,
    actor: string,
    today: string,
  ) => Promise<void>,
) {
  const settings = await db.select().from(s.mailSettings).where(eq(column[kind].flag, true));
  for (const setting of settings) {
    const today = await businessDate(db, setting.organizationId, now);
    if ((kind === 'deadline' ? setting.deadlineLastRunOn : setting.loanLastRunOn) === today)
      continue;
    await db.transaction(async (tx) => {
      const [org] = await tx
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, setting.organizationId))
        .for('no key update');
      const [current] = await tx
        .select()
        .from(s.mailSettings)
        .where(eq(s.mailSettings.organizationId, setting.organizationId));
      const [role] = await tx
        .select({ role: s.organizationUserRoles.role })
        .from(s.organizationUserRoles)
        .where(
          and(
            eq(s.organizationUserRoles.organizationId, setting.organizationId),
            eq(s.organizationUserRoles.userId, setting.enabledBy),
          ),
        );
      const enabled =
        kind === 'deadline' ? current?.automaticDeadlineReminders : current?.automaticLoanReminders;
      const lastRun = kind === 'deadline' ? current?.deadlineLastRunOn : current?.loanLastRunOn;
      if (!org || !current || !enabled || role?.role !== 'admin' || lastRun === today) return;
      await work(tx, org, current.enabledBy, today);
      await tx
        .update(s.mailSettings)
        .set(kind === 'deadline' ? { deadlineLastRunOn: today } : { loanLastRunOn: today })
        .where(eq(s.mailSettings.organizationId, org.id));
    });
  }
}

async function userLanguage(tx: Executor, org: string, userId: string, fallback: 'de' | 'it') {
  const [link] = await tx
    .select({ language: s.persons.preferredLanguage })
    .from(s.personUserLinks)
    .innerJoin(
      s.persons,
      and(
        eq(s.persons.organizationId, s.personUserLinks.organizationId),
        eq(s.persons.id, s.personUserLinks.personId),
      ),
    )
    .where(and(eq(s.personUserLinks.organizationId, org), eq(s.personUserLinks.userId, userId)));
  return link?.language ?? fallback;
}

/** Responsible user, else everyone in the responsible role, else the admins; all need compliance:read. */
async function deadlineRecipients(
  tx: Executor,
  org: string,
  deadline: typeof s.complianceDeadlines.$inferSelect,
) {
  const members = await tx
    .select({
      userId: s.user.id,
      name: s.user.name,
      email: s.user.email,
      role: s.organizationUserRoles.role,
    })
    .from(s.organizationUserRoles)
    .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
    .where(eq(s.organizationUserRoles.organizationId, org));
  const allowed = members.filter((m) => can(m.role, 'compliance:read') && validEmail(m.email));
  const responsible = allowed.filter((m) => m.userId === deadline.responsibleUserId);
  if (responsible.length) return responsible;
  const byRole = deadline.responsibleRole
    ? allowed.filter((m) => m.role === deadline.responsibleRole)
    : [];
  return byRole.length ? byRole : allowed.filter((m) => m.role === 'admin');
}

export async function enqueueDeadlineReminders(db: Database, config: Config, now = new Date()) {
  if (config.EMAIL_MODE === 'disabled') return;
  await forEachDueOrganization(db, 'deadline', now, async (tx, org, actor, today) => {
    const d = s.complianceDeadlines;
    const open = await tx
      .select()
      .from(d)
      .where(and(eq(d.organizationId, org.id), inArray(d.status, ['open', 'in_progress'])));
    let queued = 0;
    for (const deadline of open) {
      const left = daysUntil(deadline.dueDate, today);
      if (!deadlineReminderDue(left, deadline.reminderDays)) continue;
      for (const recipient of await deadlineRecipients(tx, org.id, deadline)) {
        const language = await userLanguage(tx, org.id, recipient.userId, org.locale);
        const mail = deadlineReminderMail({
          language,
          organization: org.name,
          name: recipient.name,
          title: deadline.titleI18n[language],
          dueDate: deadline.dueDate,
          daysLeft: left,
          appUrl: config.APP_URL,
          deadlineId: deadline.id,
        });
        const rows = await tx
          .insert(s.mailMessages)
          .values({
            organizationId: org.id,
            kind: 'deadline_reminder',
            userId: recipient.userId,
            deadlineId: deadline.id,
            actorUserId: actor,
            recipient: recipient.email,
            language,
            subject: mail.subject,
            body: mail.text,
            dedupeKey: `deadline:${deadline.id}:${deadline.dueDate}:${today}:${recipient.userId}`,
          })
          .onConflictDoNothing()
          .returning({ id: s.mailMessages.id });
        queued += rows.length;
      }
    }
    if (queued)
      await audit(tx, { organizationId: org.id, userId: actor }, 'queue', 'mail_batch', org.id, [
        'deadline_reminder',
      ]);
  });
}

export async function enqueueLoanReminders(db: Database, config: Config, now = new Date()) {
  if (config.EMAIL_MODE === 'disabled') return;
  await forEachDueOrganization(db, 'loan', now, async (tx, org, actor, today) => {
    const l = s.inventoryLoans;
    const open = await tx
      .select({
        loan: l,
        item: s.inventoryItems.name,
        firstName: s.persons.firstName,
        lastName: s.persons.lastName,
        email: s.persons.email,
        language: s.persons.preferredLanguage,
      })
      .from(l)
      .innerJoin(
        s.inventoryItems,
        and(
          eq(s.inventoryItems.organizationId, l.organizationId),
          eq(s.inventoryItems.id, l.itemId),
        ),
      )
      .innerJoin(
        s.persons,
        and(eq(s.persons.organizationId, l.organizationId), eq(s.persons.id, l.personId)),
      )
      .where(and(eq(l.organizationId, org.id), isNull(l.returnedOn)));
    let queued = 0;
    for (const row of open) {
      const left = daysUntil(row.loan.dueOn, today);
      if (!loanReminderDue(left) || !validEmail(row.email)) continue;
      const mail = loanReminderMail({
        language: row.language,
        organization: org.name,
        name: `${row.firstName} ${row.lastName}`,
        item: row.item,
        quantity: row.loan.quantity,
        dueOn: row.loan.dueOn,
        overdue: left < 0,
      });
      const rows = await tx
        .insert(s.mailMessages)
        .values({
          organizationId: org.id,
          kind: 'loan_reminder',
          personId: row.loan.personId,
          loanId: row.loan.id,
          actorUserId: actor,
          recipient: row.email,
          language: row.language,
          subject: mail.subject,
          body: mail.text,
          dedupeKey: `loan:${row.loan.id}:${row.loan.dueOn}:${today}`,
        })
        .onConflictDoNothing()
        .returning({ id: s.mailMessages.id });
      queued += rows.length;
    }
    if (queued)
      await audit(tx, { organizationId: org.id, userId: actor }, 'queue', 'mail_batch', org.id, [
        'loan_reminder',
      ]);
  });
}

/** The due date the reminder was queued for; it is the third segment of the dedupe key. */
const queuedDue = (row: typeof s.mailMessages.$inferSelect) => row.dedupeKey.split(':')[2];

/** Right before SMTP handoff: still open, same due date, recipient still valid. */
export async function revalidateReminder(db: Executor, row: typeof s.mailMessages.$inferSelect) {
  if (row.kind === 'deadline_reminder' && row.deadlineId && row.userId) {
    const [current] = await db
      .select({ status: s.complianceDeadlines.status, dueDate: s.complianceDeadlines.dueDate })
      .from(s.complianceDeadlines)
      .where(
        and(
          eq(s.complianceDeadlines.organizationId, row.organizationId),
          eq(s.complianceDeadlines.id, row.deadlineId),
        ),
      );
    const [account] = await db
      .select({ role: s.organizationUserRoles.role, email: s.user.email })
      .from(s.organizationUserRoles)
      .innerJoin(s.user, eq(s.user.id, s.organizationUserRoles.userId))
      .where(
        and(
          eq(s.organizationUserRoles.organizationId, row.organizationId),
          eq(s.organizationUserRoles.userId, row.userId),
        ),
      );
    return (
      !!current &&
      ['open', 'in_progress'].includes(current.status) &&
      queuedDue(row) === current.dueDate &&
      !!account &&
      can(account.role, 'compliance:read') &&
      account.email === row.recipient
    );
  }
  if (row.kind === 'loan_reminder' && row.loanId && row.personId) {
    const [current] = await db
      .select({ dueOn: s.inventoryLoans.dueOn, email: s.persons.email })
      .from(s.inventoryLoans)
      .innerJoin(
        s.persons,
        and(
          eq(s.persons.organizationId, s.inventoryLoans.organizationId),
          eq(s.persons.id, s.inventoryLoans.personId),
        ),
      )
      .where(
        and(
          eq(s.inventoryLoans.organizationId, row.organizationId),
          eq(s.inventoryLoans.id, row.loanId),
          sql`${s.inventoryLoans.returnedOn} is null`,
        ),
      );
    return !!current && queuedDue(row) === current.dueOn && current.email === row.recipient;
  }
  return false;
}
