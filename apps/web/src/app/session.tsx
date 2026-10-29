import { createContext, useContext } from 'react';
import type { Me } from '@bnature/contracts';
export const SessionContext = createContext<{
  me: Me;
  switchOrganization: (id: string) => void;
} | null>(null);
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('Session provider missing');
  return context;
}
