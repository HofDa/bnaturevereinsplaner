import { z } from 'zod';
import { fiscalYearSchema } from './finance';
import { languageSchema } from './common';
import { accountBalanceSchema } from './ledger';

// Published definitions are append-only. Sources and temporal rules: docs/ets-reporting.md.
export const ETS_DEFINITION_VERSION = 'ets-d2020-e2026-r1';
export const ETS_RULES = {
  version: ETS_DEFINITION_VERSION,
  dFirstStartAfter: '2020-04-18',
  reformFirstStartAfter: '2024-08-03',
  eFirstYearEndingOnOrAfter: '2026-03-21',
  legacyExclusiveLimitCents: '22000000',
  dInclusiveLimitCents: '30000000',
  eInclusiveLimitCents: '6000000',
} as const;
export type EtsPosition = { code: string; direction: 'income' | 'expense'; de: string; it: string };
const positions: EtsPosition[] = [];
function section(section: string, direction: 'income' | 'expense', de: string[], it: string[]) {
  de.forEach((label, i) =>
    positions.push({ code: `${section}.${direction}.${i + 1}`, direction, de: label, it: it[i]! }),
  );
}
for (const group of ['A', 'B', 'E'])
  section(
    group,
    'expense',
    [
      'Material und Waren',
      'Dienstleistungen',
      'Nutzung fremder Güter',
      'Personal',
      'Sonstige Ausgaben',
    ],
    [
      'Materie prime, sussidiarie, di consumo e merci',
      'Servizi',
      'Godimento beni di terzi',
      'Personale',
      'Uscite diverse di gestione',
    ],
  );
section(
  'A',
  'income',
  [
    'Mitgliedsbeiträge und Gründerbeiträge',
    'Gegenseitige Leistungen für Mitglieder',
    'Leistungen an Mitglieder und Gründer',
    'Spenden',
    '5 per mille',
    'Private Förderungen',
    'Leistungen an Dritte',
    'Öffentliche Förderungen',
    'Verträge mit öffentlichen Stellen',
    'Sonstige Einnahmen',
  ],
  [
    'Quote associative e apporti dei fondatori',
    'Entrate dagli associati per attività mutuali',
    'Prestazioni e cessioni ad associati e fondatori',
    'Erogazioni liberali',
    'Entrate del 5 per mille',
    'Contributi da soggetti privati',
    'Prestazioni e cessioni a terzi',
    'Contributi da enti pubblici',
    'Contratti con enti pubblici',
    'Altre entrate',
  ],
);
section(
  'B',
  'income',
  [
    'Leistungen an Mitglieder',
    'Private Förderungen',
    'Leistungen an Dritte',
    'Öffentliche Förderungen',
    'Öffentliche Verträge',
    'Sonstige Einnahmen',
  ],
  [
    'Prestazioni e cessioni ad associati e fondatori',
    'Contributi da soggetti privati',
    'Prestazioni e cessioni a terzi',
    'Contributi da enti pubblici',
    'Contratti con enti pubblici',
    'Altre entrate',
  ],
);
for (const direction of ['income', 'expense'] as const) {
  section(
    'C',
    direction,
    [
      'Regelmäßige Mittelbeschaffung',
      'Gelegentliche Mittelbeschaffung',
      'Sonstige Mittelbeschaffung',
    ],
    ['Raccolte fondi abituali', 'Raccolte fondi occasionali', 'Altre entrate/uscite'],
  );
  section(
    'D',
    direction,
    [
      'Bankgeschäfte',
      'Finanzinvestitionen',
      'Immobilien',
      'Sonstiges Vermögen',
      'Sonstige Finanzbewegungen',
    ],
    [
      'Rapporti bancari',
      'Investimenti finanziari',
      'Patrimonio edilizio',
      'Altri beni patrimoniali',
      'Altre entrate/uscite',
    ],
  );
  section(
    'F',
    direction,
    [
      'Anlagevermögen gemeinnützige Tätigkeit',
      'Anlagevermögen andere Tätigkeit',
      'Finanz- und Vermögensanlagen',
      'Finanzierungen und Darlehen',
    ],
    [
      'Immobilizzazioni per attività di interesse generale',
      'Immobilizzazioni per attività diverse',
      'Attività finanziarie e patrimoniali',
      'Finanziamenti e prestiti',
    ],
  );
}
section(
  'E',
  'income',
  ['Personalüberlassung', 'Sonstige allgemeine Einnahmen'],
  ['Distacco del personale', 'Altre entrate di supporto generale'],
);
positions.push(
  {
    code: 'T.expense.1',
    direction: 'expense',
    de: 'Steuern laufende Tätigkeit',
    it: 'Imposte sulla gestione',
  },
  {
    code: 'T.expense.2',
    direction: 'expense',
    de: 'Steuern Investitionen',
    it: 'Imposte su investimenti e finanziamenti',
  },
);
export const ETS_POSITIONS: readonly EtsPosition[] = positions;
export const etsReportQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(1900).max(2200),
  model: z.enum(['D', 'E']).default('D'),
  language: languageSchema.default('de'),
  legalPersonality: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  // External prior-year books may be supplied when the platform has no prior-year ledger.
  priorRevenueCents: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
});
export type EtsReportQuery = z.infer<typeof etsReportQuerySchema>;
const total = z.string().regex(/^-?\d+$/);
export const etsReportSchema = z.object({
  fiscalYear: fiscalYearSchema,
  model: z.enum(['D', 'E']),
  definitionVersion: z.string(),
  status: z.enum(['open', 'closed']),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  incomeCents: total,
  expenseCents: total,
  resultCents: total,
  openingCents: total,
  closingCents: total,
  accounts: z.array(accountBalanceSchema),
  priorAccounts: z.array(accountBalanceSchema),
  priorFiscalYear: fiscalYearSchema.nullable(),
  priorRevenueCents: total.nullable(),
  eligibility: z.enum(['review', 'within_limit', 'outside_limit']),
  rows: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      incomeCents: total,
      expenseCents: total,
      resultCents: total,
      priorIncomeCents: total.nullable(),
      priorExpenseCents: total.nullable(),
      priorResultCents: total.nullable(),
    }),
  ),
  unmappedEntryIds: z.array(z.string().uuid()),
  checks: z.array(z.object({ code: z.string(), ok: z.boolean() })),
  notice: z.string(),
});
export type EtsReport = z.infer<typeof etsReportSchema>;
