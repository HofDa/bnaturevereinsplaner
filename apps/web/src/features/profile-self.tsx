import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreditCard, Download, Layers, Wallet } from 'lucide-react';
import { formatMoney, type OwnFees, type OwnMembershipDetail } from '@bnature/contracts';
import { api, downloadPrivateFile, errorMessage } from '../lib/api';
import { useSession } from '../app/session';
import { Badge, Button, Notice, QueryView, formatDate } from '../components/ui';

function consentBadgeClass(granted: boolean) {
  return granted ? 'badge badge-active' : 'badge badge-resigned';
}

function feeStatusKey(status: 'open' | 'partial' | 'paid' | 'exempt') {
  if (status === 'paid') return 'financeSettled';
  if (status === 'partial') return 'financePartial';
  if (status === 'exempt') return 'financeExemption';
  return 'financeOpen';
}

function feeStatusBadgeClass(status: 'open' | 'partial' | 'paid' | 'exempt', overdue: boolean) {
  if (overdue) return 'badge badge-resigned';
  if (status === 'paid' || status === 'exempt') return 'badge badge-active';
  if (status === 'partial') return 'badge badge-pending';
  return 'badge badge-inactive';
}

function paymentMethodKey(method: 'cash' | 'bank_transfer' | 'other') {
  if (method === 'cash') return 'financeCash';
  if (method === 'bank_transfer') return 'financeTransfer';
  return 'financeOther';
}

export function OwnMembershipPanel() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const language = i18n.language === 'it' ? 'it' : 'de';
  const query = useQuery({
    queryKey: ['own-membership', me.activeOrganizationId],
    queryFn: () => api<OwnMembershipDetail>('/profile/membership'),
  });

  return (
    <section className="panel member-self-card">
      <div className="panel-header">
        <div>
          <h2>{t('memberMembershipTitle')}</h2>
          <p className="muted">{query.data?.organization.name ?? 'b*nature'}</p>
        </div>
        <span className="quick-icon" aria-hidden="true">
          <CreditCard size={18} />
        </span>
      </div>
      <QueryView query={query}>
        {(data) =>
          !data.linked ? (
            <p className="muted">{t('profileUnlinked')}</p>
          ) : (
            <div className="member-card-layout">
              <div className="member-id-card">
                <div className="member-id-card-top">
                  <div>
                    <small>{t('memberCardTitle')}</small>
                    <h3>
                      {data.person
                        ? `${data.person.firstName} ${data.person.lastName}`
                        : me.user.name}
                    </h3>
                  </div>
                  {data.membership && <Badge status={data.membership.status} />}
                </div>
                {data.membership ? (
                  <dl className="member-card-facts">
                    <div>
                      <dt>{t('memberNumber')}</dt>
                      <dd>{data.membership.membershipNumber}</dd>
                    </div>
                    <div>
                      <dt>{t('membershipType')}</dt>
                      <dd>{t(data.membership.membershipType)}</dd>
                    </div>
                    <div>
                      <dt>{t('memberSince')}</dt>
                      <dd>{formatDate(data.membership.joinedAt, language)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="muted">{t('memberFeesNoMembership')}</p>
                )}
              </div>

              <div className="member-self-details">
                <div>
                  <h3>{t('memberMyGroups')}</h3>
                  {data.groups.length ? (
                    <ul className="member-group-chips">
                      {data.groups.map((group) => (
                        <li key={group.id}>
                          <Link
                            className="member-group-chip"
                            to={`/community?kind=chat&groupId=${group.id}`}
                          >
                            <Layers size={14} />
                            <span>{group.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">{t('memberGroupsNone')}</p>
                  )}
                </div>

                <div>
                  <h3>{t('consentsTitle')}</h3>
                  <ul className="member-consent-summary">
                    {(['data_processing', 'photos'] as const).map((kind) => {
                      const decision = data.consents[kind];
                      return (
                        <li key={kind}>
                          <span>{t(`consent_${kind}`)}</span>
                          {decision ? (
                            <span className={consentBadgeClass(decision.granted)}>
                              <span />
                              {t(decision.granted ? 'consentGranted' : 'consentRefused')}
                              {' · '}
                              {formatDate(decision.decidedOn, language)}
                            </span>
                          ) : (
                            <span className="badge badge-inactive">
                              <span />
                              {t('consentNone')}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {data.extraFields.length > 0 && (
                  <div>
                    <h3>{t('memberExtraFieldsTitle')}</h3>
                    <dl className="member-extra-facts">
                      {data.extraFields.map((field) => (
                        <div key={field.id}>
                          <dt>{field.labelI18n[language]}</dt>
                          <dd>
                            {typeof field.value === 'boolean'
                              ? t(field.value ? 'memberFieldYes' : 'memberFieldNo')
                              : field.type === 'date' && typeof field.value === 'string'
                                ? formatDate(field.value, language)
                                : String(field.value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            </div>
          )
        }
      </QueryView>
    </section>
  );
}

export function OwnFeesPanel() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const [downloadError, setDownloadError] = useState('');
  const language = i18n.language === 'it' ? 'it' : 'de';
  const query = useQuery({
    queryKey: ['own-fees', me.activeOrganizationId],
    queryFn: () => api<OwnFees>('/profile/fees'),
  });

  return (
    <section className="panel member-fees-panel" id="my-fees">
      <div className="panel-header">
        <div>
          <h2>{t('memberMyFeesTitle')}</h2>
          <p>{t('memberMyFeesIntro')}</p>
        </div>
        <span className="quick-icon" aria-hidden="true">
          <Wallet size={18} />
        </span>
      </div>
      {downloadError && <Notice error>{downloadError}</Notice>}
      <QueryView query={query}>
        {(data) => {
          if (!data.linked) return <p className="muted">{t('profileUnlinked')}</p>;
          if (!data.hasMembership) return <p className="muted">{t('memberFeesNoMembership')}</p>;
          return (
            <div className="member-fees-content">
              {data.openCount > 0 && (
                <div className="member-fees-banner">
                  <strong>
                    {t('memberFeesSummaryOpen')}: {formatMoney(data.openCents, i18n.language)}
                  </strong>
                  {data.overdueCount > 0 && (
                    <span className="badge badge-resigned">
                      <span />
                      {t('memberFeesOverdueHint', { count: data.overdueCount })}
                    </span>
                  )}
                </div>
              )}

              {data.assessments.length ? (
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={t('memberMyFeesTitle')}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>{t('fiscalYear')}</th>
                        <th>{t('financePlan')}</th>
                        <th>{t('financeDueDate')}</th>
                        <th className="align-right">{t('financeAmount')}</th>
                        <th className="align-right">{t('memberFeesPaidAmount')}</th>
                        <th className="align-right">{t('financeOutstanding')}</th>
                        <th>{t('status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.assessments.map((item) => (
                        <tr key={item.id}>
                          <td>{item.fiscalYear}</td>
                          <td>{item.planName}</td>
                          <td>{formatDate(item.dueDate, language)}</td>
                          <td className="align-right">
                            {formatMoney(item.amountCents, i18n.language)}
                          </td>
                          <td className="align-right">
                            {formatMoney(item.paidCents, i18n.language)}
                          </td>
                          <td className="align-right">
                            {formatMoney(item.openCents, i18n.language)}
                          </td>
                          <td>
                            <span className={feeStatusBadgeClass(item.status, item.overdue)}>
                              <span />
                              {t(feeStatusKey(item.status))}
                              {item.overdue ? ` · ${t('memberFeesOverdueBadge')}` : ''}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">{t('memberFeesNone')}</p>
              )}

              {data.payments.length > 0 && (
                <div className="member-payments-block">
                  <h3>{t('memberFeesPayments')}</h3>
                  <ul className="member-payment-list">
                    {data.payments.map((payment) => (
                      <li key={payment.id} className="member-payment-row">
                        <div>
                          <strong>
                            BN-{String(payment.receiptNumber).padStart(6, '0')} ·{' '}
                            {formatMoney(payment.amountCents, i18n.language)}
                          </strong>
                          <p className="muted">
                            {formatDate(payment.paidOn, language)} ·{' '}
                            {t(paymentMethodKey(payment.method))}
                            {payment.reference ? ` · ${payment.reference}` : ''}
                          </p>
                          <p className="finance-cell-note">
                            {payment.allocations
                              .map(
                                (alloc) =>
                                  `${alloc.planName} (${alloc.fiscalYear}): ${formatMoney(alloc.amountCents, i18n.language)}`,
                              )
                              .join(' · ')}
                          </p>
                        </div>
                        <div className="member-payment-actions">
                          {payment.status === 'reversed' && (
                            <span className="badge badge-resigned">
                              <span />
                              {t('memberFeesReversed')}
                            </span>
                          )}
                          {payment.receiptAvailable ? (
                            <Button
                              variant="secondary"
                              onClick={async () => {
                                setDownloadError('');
                                try {
                                  await downloadPrivateFile(
                                    `/profile/fees/payments/${payment.id}/receipt?language=${language}`,
                                    `receipt-${String(payment.receiptNumber).padStart(6, '0')}.pdf`,
                                  );
                                } catch (error) {
                                  setDownloadError(errorMessage(error));
                                }
                              }}
                            >
                              <Download size={15} />
                              {t('memberFeesReceipt')}
                            </Button>
                          ) : (
                            <small className="muted">{t('memberFeesPooledNote')}</small>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }}
      </QueryView>
    </section>
  );
}
