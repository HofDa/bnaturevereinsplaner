import { useTranslation } from 'react-i18next';
import { formatMoney } from '@bnature/contracts';
export function Amount({
  cents,
  direction,
}: {
  cents: number | string;
  direction?: 'income' | 'expense';
}) {
  const { i18n } = useTranslation();
  const sign = direction === 'expense' ? '−' : direction === 'income' ? '+' : '';
  return (
    <span className={`finance-money ledger-amount ledger-${direction ?? 'neutral'}`}>
      {sign} {formatMoney(cents, i18n.language)}
    </span>
  );
}
