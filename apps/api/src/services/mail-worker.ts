import { and, eq, lt, sql, or, isNull } from 'drizzle-orm';
import { schema as s, type Database } from '@bnature/db';
import type { Config } from '../plugins/config';
import { audit } from './audit';
import { createMailSender, MailDeliveryError, type MailSender } from './mail';
import { enqueueAutomaticMail, revalidateMail, isSupportedMailKind } from '../modules/mail';
import { enqueueCommunityDigests, revalidateDigest } from '../modules/community-notify';
import {
  enqueueDeadlineReminders,
  enqueueLoanReminders,
  revalidateReminder,
} from '../modules/automatic-reminders';

export async function deliverMail(db: Database, config: Config, sender: MailSender, limit = 10) {
  if (config.EMAIL_MODE === 'disabled') return;
  // A process may have died after SMTP acceptance. Such messages require investigation.
  await db
    .update(s.mailMessages)
    .set({ state: 'uncertain', errorCode: 'SMTP_UNCERTAIN' })
    .where(
      and(
        eq(s.mailMessages.state, 'sending'),
        lt(s.mailMessages.attemptedAt, new Date(Date.now() - 120_000)),
      ),
    );
  for (let i = 0; i < limit; i++) {
    const row = await db.transaction(async (tx) => {
      const [queued] = await tx
        .select()
        .from(s.mailMessages)
        .where(
          and(
            eq(s.mailMessages.state, 'queued'),
            or(
              isNull(s.mailMessages.attemptedAt),
              lt(s.mailMessages.attemptedAt, new Date(Date.now() - 60_000)),
            ),
          ),
        )
        .orderBy(s.mailMessages.createdAt, s.mailMessages.id)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!queued) return null;
      const [claimed] = await tx
        .update(s.mailMessages)
        .set({
          state: 'sending',
          attemptedAt: new Date(),
          attempts: sql`${s.mailMessages.attempts}+1`,
        })
        .where(eq(s.mailMessages.id, queued.id))
        .returning();
      return claimed!;
    });
    if (!row) return;
    // Keep the organization lock through SMTP handoff so concurrent payment/role changes serialize.
    let handedOff = false;
    try {
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(s.organizations)
          .where(eq(s.organizations.id, row.organizationId))
          .for('no key update');
        const digest = row.kind === 'community_digest';
        const reminder = row.kind === 'deadline_reminder' || row.kind === 'loan_reminder';
        if (!digest && !reminder && !isSupportedMailKind(row.kind)) {
          await tx
            .update(s.mailMessages)
            .set({ state: 'failed', errorCode: 'MAIL_KIND_UNAVAILABLE' })
            .where(eq(s.mailMessages.id, row.id));
          await audit(
            tx,
            { organizationId: row.organizationId, userId: row.actorUserId },
            'failed',
            'mail_message',
            row.id,
            ['state'],
          );
          return;
        }
        const valid = digest
          ? await revalidateDigest(tx, row)
          : reminder
            ? await revalidateReminder(tx, row)
            : await revalidateMail(tx, row, config);
        if (!valid) {
          await tx
            .update(s.mailMessages)
            .set({ state: 'cancelled', errorCode: 'SOURCE_CHANGED' })
            .where(eq(s.mailMessages.id, row.id));
          await audit(
            tx,
            { organizationId: row.organizationId, userId: row.actorUserId },
            'cancel',
            'mail_message',
            row.id,
            ['state'],
          );
          return;
        }
        let state: 'sent' | 'uncertain' | 'failed' = 'sent';
        let errorCode: string | null = null;
        try {
          handedOff = true;
          await sender.send({
            id: row.id,
            recipient: row.recipient,
            subject: row.subject,
            text: row.body,
          });
        } catch (error) {
          state = error instanceof MailDeliveryError && !error.uncertain ? 'failed' : 'uncertain';
          errorCode = state === 'failed' ? 'SMTP_REJECTED' : 'SMTP_UNCERTAIN';
        }
        await tx
          .update(s.mailMessages)
          .set({ state, errorCode, sentAt: state === 'sent' ? new Date() : null })
          .where(eq(s.mailMessages.id, row.id));
        await audit(
          tx,
          { organizationId: row.organizationId, userId: row.actorUserId },
          state,
          'mail_message',
          row.id,
          ['state'],
        );
      });
    } catch (error) {
      if (!handedOff) {
        await db
          .update(s.mailMessages)
          .set({
            state: row.attempts < 5 ? 'queued' : 'failed',
            errorCode: 'PRE_SEND_FAILURE',
          })
          .where(and(eq(s.mailMessages.id, row.id), eq(s.mailMessages.state, 'sending')));
      }
      throw new MailWorkerError(row.id, handedOff ? 'handoff' : 'validation', error);
    }
  }
}

export class MailWorkerError extends Error {
  constructor(
    public messageId: string,
    public stage: string,
    cause: unknown,
  ) {
    super('Mail worker failed', { cause });
  }
}

export function startMailWorker(
  db: Database,
  config: Config,
  onError: (context: { stage: string; messageId?: string }) => void,
) {
  if (config.EMAIL_MODE === 'disabled') return async () => {};
  const sender = createMailSender(config);
  let stopped = false;
  let running: Promise<void> | undefined;
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      try {
        await enqueueAutomaticMail(db, config);
      } catch {
        onError({ stage: 'fee-enqueue' });
      }
      for (const enqueue of [
        enqueueCommunityDigests,
        enqueueDeadlineReminders,
        enqueueLoanReminders,
      ])
        try {
          await enqueue(db, config);
        } catch {
          onError({ stage: enqueue.name });
        }
      try {
        await deliverMail(db, config, sender);
      } catch (error) {
        onError(
          error instanceof MailWorkerError
            ? { stage: error.stage, messageId: error.messageId }
            : { stage: 'delivery' },
        );
      }
    })().finally(() => {
      running = undefined;
    });
  };
  const timer = setInterval(tick, 15_000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
    sender.close();
  };
}
