import { dateInTimeZone } from '@bnature/contracts';
import { useSession } from '../app/session';
export function useBusinessDate() {
  const { me } = useSession();
  return () => dateInTimeZone(me.timezone ?? 'Europe/Rome');
}
