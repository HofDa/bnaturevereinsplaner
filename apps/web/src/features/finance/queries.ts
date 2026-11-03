import { useQuery } from '@tanstack/react-query';
import type { FinanceAccount, CashbookCategory, FiscalYear } from '@bnature/contracts';
import { api, queryClient } from '../../lib/api';
import { useSession } from '../../app/session';
export function useLedgerBasics() {
  const { me } = useSession();
  const accounts = useQuery({
    queryKey: ['finance-accounts', me.activeOrganizationId],
    queryFn: () => api<{ items: FinanceAccount[] }>('/finance/accounts'),
  });
  const categories = useQuery({
    queryKey: ['finance-categories', me.activeOrganizationId],
    queryFn: () => api<{ items: CashbookCategory[] }>('/finance/categories'),
  });
  const years = useQuery({
    queryKey: ['finance-fiscal-years', me.activeOrganizationId],
    queryFn: () => api<{ items: FiscalYear[] }>('/finance/fiscal-years'),
  });
  return { accounts, categories, years };
}

export const refreshFinanceQueries = () =>
  void queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0]).startsWith('finance-'),
  });
