import { and, eq, lt, sql } from 'drizzle-orm';
import { schema as s, type Database } from '@bnature/db';
import type { Config } from '../plugins/config';
import { audit } from './audit';
import { createMailSender, MailDeliveryError, type MailSender } from './mail';
import { enqueueAutomaticMail, revalidateMail, isSupportedMailKind } from '../modules/mail';

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
        .where(eq(s.mailMessages.state, 'queued'))
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
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, row.organizationId))
        .for('no key update');
      if (!isSupportedMailKind(row.kind)) {
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
      if (!(await revalidateMail(tx, row, config))) {
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
  }
}

export function startMailWorker(db: Database, config: Config, onError: () => void) {
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
        onError();
      }
      try {
        await deliverMail(db, config, sender);
      } catch {
        onError();
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
