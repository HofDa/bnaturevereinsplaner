import { eq } from 'drizzle-orm';
import { schema as s, type Executor } from '@bnature/db';
import { dateInTimeZone } from '@bnature/contracts';
import { HttpError } from '../middleware/access';
export async function businessDate(
  db: Executor,
  organizationId: string,
  now = new Date(),
): Promise<string> {
  const [org] = await db
    .select({ timezone: s.organizations.timezone })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId));
  if (!org) throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
  return dateInTimeZone(org.timezone, now);
}
