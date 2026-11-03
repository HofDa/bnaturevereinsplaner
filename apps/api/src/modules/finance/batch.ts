import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import {
  MAX_ASSESSMENT_BATCH,
  type AssessmentBatchPreview,
  type AssessmentBatchRequest,
} from '@bnature/contracts';
import { HttpError, type Access } from '../../middleware/access';
import { audit } from '../../services/audit';
import { canonicalJson, financialOperation, readSnapshot } from './operations';
import { getPlan } from './service';

const a = s.membershipFeeAssessments;

/**
 * Active members who should receive this plan's claim: matching membership category and no
 * claim for the same plan (and fiscal year, for annual plans) yet. Ordered by name.
 */
async function candidates(
  db: Executor,
  org: string,
  request: AssessmentBatchRequest,
): Promise<AssessmentBatchPreview & { planVersion: number }> {
  const plan = await getPlan(db, org, request.planId);
  if (!plan.active) throw new HttpError(409, 'PLAN_INACTIVE', 'Dieser Tarif ist deaktiviert.');
  const members = await db
    .select({
      id: s.memberships.id,
      membershipType: s.memberships.membershipType,
      membershipNumber: s.memberships.membershipNumber,
      firstName: s.persons.firstName,
      lastName: s.persons.lastName,
    })
    .from(s.memberships)
    .innerJoin(
      s.persons,
      and(
        eq(s.persons.id, s.memberships.personId),
        eq(s.persons.organizationId, s.memberships.organizationId),
      ),
    )
    .where(and(eq(s.memberships.organizationId, org), eq(s.memberships.status, 'active')))
    .orderBy(asc(s.persons.lastName), asc(s.persons.firstName), asc(s.memberships.id));
  const existing = new Set(
    (
      await db
        .select({ membershipId: a.membershipId })
        .from(a)
        .where(
          and(
            eq(a.organizationId, org),
            eq(a.planId, plan.id),
            plan.interval === 'annual' ? eq(a.fiscalYear, request.fiscalYear) : undefined,
          ),
        )
    ).map((r) => r.membershipId),
  );
  let skippedExisting = 0,
    skippedCategory = 0;
  const items: AssessmentBatchPreview['items'] = [];
  for (const m of members) {
    if (plan.membershipType && plan.membershipType !== m.membershipType) skippedCategory++;
    else if (existing.has(m.id)) skippedExisting++;
    else
      items.push({
        membershipId: m.id,
        memberName: `${m.firstName} ${m.lastName}`,
        membershipNumber: m.membershipNumber,
        amountCents: plan.amountCents,
      });
  }
  if (items.length > MAX_ASSESSMENT_BATCH)
    throw new HttpError(
      422,
      'BATCH_TOO_LARGE',
      `Höchstens ${MAX_ASSESSMENT_BATCH} Forderungen je Sammelvorschreibung.`,
    );
  const previewHash = createHash('sha256')
    .update(
      canonicalJson({
        request,
        planVersion: plan.version,
        items: items.map((i) => [i.membershipId, i.memberName, i.membershipNumber, i.amountCents]),
      }),
    )
    .digest('hex');
  return {
    planName: plan.name,
    planVersion: plan.version,
    amountCents: plan.amountCents,
    items,
    totalCents: items.reduce((n, i) => n + i.amountCents, 0),
    skippedExisting,
    skippedCategory,
    previewHash,
  };
}

export function previewAssessmentBatch(
  db: Database,
  access: Access,
  request: AssessmentBatchRequest,
): Promise<AssessmentBatchPreview> {
  return readSnapshot(db, async (tx) => {
    const preview: AssessmentBatchPreview & { planVersion?: number } = await candidates(
      tx,
      access.organizationId,
      request,
    );
    delete preview.planVersion;
    return preview;
  });
}

/**
 * Creates exactly the previewed claims in one transaction. If members, existing claims or the
 * plan changed since the preview, the fingerprint differs and nothing is created.
 */
export function createAssessmentBatch(
  db: Database,
  access: Access,
  key: string,
  input: AssessmentBatchRequest & { previewHash: string },
) {
  return financialOperation(
    db,
    access,
    key,
    'fee-assessments:batch',
    input,
    'finance:write',
    async (tx) => {
      const { previewHash, ...request } = input;
      const current = await candidates(tx, access.organizationId, request);
      if (current.previewHash !== previewHash)
        throw new HttpError(
          409,
          'PREVIEW_STALE',
          'Mitglieder, Tarif oder Forderungen haben sich geändert. Bitte die Vorschau neu laden.',
        );
      if (!current.items.length)
        throw new HttpError(409, 'NOTHING_TO_CREATE', 'Es sind keine neuen Forderungen anzulegen.');
      const plan = await getPlan(tx, access.organizationId, request.planId);
      const rows = await tx
        .insert(a)
        .values(
          current.items.map((item) => ({
            organizationId: access.organizationId,
            membershipId: item.membershipId,
            planId: plan.id,
            fiscalYear: request.fiscalYear,
            dueDate: request.dueDate,
            memberName: item.memberName,
            membershipNumber: item.membershipNumber,
            planName: plan.name,
            interval: plan.interval,
            planAmountCents: plan.amountCents,
            baseAmountCents: plan.amountCents,
            reductionCents: 0,
            exempt: false,
            adjustmentReason: '',
            amountCents: item.amountCents,
            createdBy: access.userId,
          })),
        )
        .returning({ id: a.id });
      for (const row of rows)
        await audit(tx, access, 'create', 'membership_fee_assessment', row.id, ['batch']);
      return { created: rows.length, totalCents: current.totalCents };
    },
  );
}
