import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { and, eq } from 'drizzle-orm';
import { schema as s, type Database, type Executor } from '@bnature/db';
import { formatMoney, localDate } from '@bnature/contracts';
import { HttpError } from '../../middleware/access';
import { getPayment, getAssessment } from './service';
import { annualReport } from './ledger';

const labels = {
  de: {
    receipt: 'Zahlungsbestätigung',
    reminder: 'Zahlungserinnerung – Entwurf',
    number: 'Belegnummer',
    payer: 'Zahlende Person',
    date: 'Zahlungsdatum',
    method: 'Zahlungsart',
    reference: 'Referenz',
    total: 'Gesamtbetrag',
    allocations: 'Zahlungszuordnungen',
    member: 'Mitglied',
    year: 'Beitragsjahr',
    amount: 'Betrag',
    due: 'Fällig am',
    open: 'Offener Betrag bei Vorbereitung',
    prepared: 'Vorbereitet am',
    note: 'Interner Zahlungsnachweis. Keine elektronische Signatur oder rechtliche Zertifizierung.',
    draft: 'Entwurf zur manuellen Übermittlung. Nicht automatisch versendet.',
    unsupported: 'Einzelne Zeichen konnten in der PDF-Standardschrift nicht dargestellt werden.',
    cash: 'Bar',
    bank_transfer: 'Überweisung',
    other: 'Sonstige',
    reversed: 'STORNIERT am',
    reason: 'Begründung',
    report: 'Jahresbericht Einnahmen und Ausgaben',
    fiscalYear: 'Geschäftsjahr',
    status: 'Status',
    open_status: 'offen – vorläufige Werte',
    closed_status: 'geschlossen',
    income: 'Einnahmen',
    expense: 'Ausgaben',
    result: 'Ergebnis',
    feeIncome: 'davon Mitgliedsbeiträge',
    donationIncome: 'davon Spenden',
    otherIncome: 'davon sonstige Einnahmen',
    categories: 'Nach Kategorien',
    accounts: 'Konten',
    opening: 'Anfang',
    closing: 'Ende',
    unbooked: 'Nicht verbuchte Zahlungen im Jahr',
    template: 'Berichtsvorlage',
    threshold: 'Schwellenwert Einnahmen',
    exceeded: 'überschritten – Berichtsmodell prüfen',
    notExceeded: 'nicht überschritten',
    unmapped: 'Kategorien ohne Zuordnung in der Vorlage',
    reportNote:
      'Interne Auswertung. Vorlagen sind vom Verein konfiguriert; keine amtliche Vorlage, Prüfung oder rechtliche Zertifizierung.',
  },
  it: {
    receipt: 'Conferma di pagamento',
    reminder: 'Sollecito di pagamento – Bozza',
    number: 'Numero ricevuta',
    payer: 'Pagante',
    date: 'Data di pagamento',
    method: 'Metodo di pagamento',
    reference: 'Riferimento',
    total: 'Importo totale',
    allocations: 'Attribuzioni del pagamento',
    member: 'Socio',
    year: 'Anno contributivo',
    amount: 'Importo',
    due: 'Scadenza',
    open: 'Importo aperto alla preparazione',
    prepared: 'Preparato il',
    note: 'Attestazione interna di pagamento. Nessuna firma elettronica o certificazione legale.',
    draft: 'Bozza per invio manuale. Non inviata automaticamente.',
    unsupported: 'Alcuni caratteri non sono rappresentabili nel carattere standard del PDF.',
    cash: 'Contanti',
    bank_transfer: 'Bonifico',
    other: 'Altro',
    reversed: 'STORNATO il',
    reason: 'Motivazione',
    report: 'Rendiconto annuale entrate e uscite',
    fiscalYear: 'Esercizio',
    status: 'Stato',
    open_status: 'aperto – valori provvisori',
    closed_status: 'chiuso',
    income: 'Entrate',
    expense: 'Uscite',
    result: 'Risultato',
    feeIncome: 'di cui quote associative',
    donationIncome: 'di cui donazioni',
    otherIncome: 'di cui altre entrate',
    categories: 'Per categoria',
    accounts: 'Conti',
    opening: 'Inizio',
    closing: 'Fine',
    unbooked: "Pagamenti non contabilizzati nell'anno",
    template: 'Modello di rendiconto',
    threshold: 'Soglia entrate',
    exceeded: 'superata – verificare il modello di rendiconto',
    notExceeded: 'non superata',
    unmapped: 'Categorie non attribuite nel modello',
    reportNote:
      "Elaborazione interna. Modelli configurati dall'associazione; nessun modello ufficiale, revisione o certificazione legale.",
  },
};
export async function renderPdf(
  title: string,
  organization: string,
  lines: string[],
  language: 'de' | 'it',
  note: string = labels[language].note,
  // A fixed date makes the output byte-reproducible (register snapshots).
  fixedDate?: Date,
) {
  const document = await PDFDocument.create(),
    font = await document.embedFont(StandardFonts.Helvetica),
    bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(title);
  document.setAuthor('b*nature');
  document.setLanguage(language);
  document.setCreator('b*nature Vereinsplattform');
  if (fixedDate) {
    document.setProducer('b*nature');
    document.setCreationDate(fixedDate);
    document.setModificationDate(fixedDate);
  }
  let page = document.addPage([595.28, 841.89]),
    y = 790,
    missing = false;
  const safe = (text: string, f: PDFFont) =>
    [...text.replace(/[\r\n\t]/g, ' ')]
      .map((char) => {
        try {
          f.encodeText(char);
          return char;
        } catch {
          missing = true;
          return '?';
        }
      })
      .join('');
  const draw = (text: string, size = 11, f = font) => {
    const remaining = safe(text, f);
    let line = '';
    // Character wrapping also bounds long unbroken user-provided references.
    for (const char of remaining) {
      if (f.widthOfTextAtSize(line + char, size) > 490) {
        write(line, size, f);
        line = char;
      } else line += char;
    }
    write(line, size, f);
  };
  const write = (line: string, size: number, f: PDFFont) => {
    if (y < 65) {
      page = document.addPage([595.28, 841.89]);
      y = 790;
    }
    page.drawText(line, { x: 50, y, size, font: f, color: rgb(0.15, 0.23, 0.19) });
    y -= size + 9;
  };
  draw('b*nature', 22, bold);
  y -= 10;
  draw(organization, 12, bold);
  y -= 12;
  draw(title, 19, bold);
  y -= 20;
  for (const line of lines) draw(line);
  y -= 20;
  draw(note, 9);
  if (missing) draw(labels[language].unsupported, 9);
  return Buffer.from(await document.save());
}
export async function organizationName(db: Executor, org: string) {
  const [row] = await db
    .select({ name: s.organizations.name })
    .from(s.organizations)
    .where(eq(s.organizations.id, org));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Organisation nicht gefunden.');
  return row.name;
}
export async function paymentPdf(db: Database, org: string, id: string, language: 'de' | 'it') {
  const payment = await getPayment(db, org, id),
    l = labels[language];
  const lines = [
    `${l.number}: BN-${String(payment.receiptNumber).padStart(6, '0')}`,
    `${l.payer}: ${payment.payerName}`,
    `${l.date}: ${payment.paidOn}`,
    `${l.method}: ${l[payment.method]}`,
    `${l.reference}: ${payment.reference || '–'}`,
    ...(payment.reversal
      ? [`${l.reversed} ${payment.reversal.reversedOn}`, `${l.reason}: ${payment.reversal.reason}`]
      : []),
    '',
    `${l.total}: ${formatMoney(payment.amountCents, language)}`,
    '',
    l.allocations,
  ];
  for (const allocation of payment.allocations)
    lines.push(
      `${allocation.memberName} (${allocation.membershipNumber})`,
      `${allocation.planName} · ${l.year} ${allocation.fiscalYear} · ${formatMoney(allocation.amountCents, language)}`,
      '',
    );
  return renderPdf(l.receipt, await organizationName(db, org), lines, language);
}
export async function reminderPdf(db: Database, org: string, id: string, language: 'de' | 'it') {
  const [reminder] = await db
    .select()
    .from(s.membershipFeeReminders)
    .where(
      and(eq(s.membershipFeeReminders.organizationId, org), eq(s.membershipFeeReminders.id, id)),
    );
  if (!reminder) throw new HttpError(404, 'NOT_FOUND', 'Erinnerungsentwurf nicht gefunden.');
  const assessment = await getAssessment(db, org, reminder.assessmentId),
    l = labels[language];
  return renderPdf(
    l.reminder,
    await organizationName(db, org),
    [
      `${l.member}: ${assessment.memberName} (${assessment.membershipNumber})`,
      `${assessment.planName} · ${l.year} ${assessment.fiscalYear}`,
      `${l.due}: ${assessment.dueDate}`,
      `${l.open}: ${formatMoney(reminder.openCents, language)}`,
      `${l.prepared}: ${localDate(reminder.createdAt)}`,
      `#${reminder.sequence}`,
      '',
      l.draft,
    ],
    language,
  );
}
export async function annualReportPdf(
  db: Database,
  org: string,
  fiscalYear: number,
  language: 'de' | 'it',
  templateId?: string,
) {
  const report = await annualReport(db, org, fiscalYear, templateId),
    l = labels[language],
    money = (cents: string) => formatMoney(cents, language);
  const lines = [
    `${l.fiscalYear}: ${report.fiscalYear}`,
    `${l.status}: ${report.status === 'closed' ? l.closed_status : l.open_status}`,
    '',
    `${l.income}: ${money(report.incomeCents)}`,
    `  ${l.feeIncome}: ${money(report.membershipFeeIncomeCents)}`,
    `  ${l.donationIncome}: ${money(report.donationIncomeCents)}`,
    `  ${l.otherIncome}: ${money(report.otherIncomeCents)}`,
    `${l.expense}: ${money(report.expenseCents)}`,
    `${l.result}: ${money(report.resultCents)}`,
    `${l.unbooked}: ${report.unbookedPaymentCount}`,
    '',
    l.categories,
    ...report.categories
      .filter((c) => c.totalCents !== '0')
      .map((c) => `${c.direction === 'income' ? '+' : '−'} ${c.name}: ${money(c.totalCents)}`),
    '',
    l.accounts,
    ...report.accounts.map(
      (a) =>
        `${a.name}: ${l.opening} ${money(a.openingCents)} · ${l.income} ${money(a.incomeCents)} · ${l.expense} ${money(a.expenseCents)} · ${l.closing} ${money(a.closingCents)}`,
    ),
  ];
  if (report.template) {
    const names = new Map(report.categories.map((c) => [c.categoryId, c.name]));
    lines.push(
      '',
      `${l.template}: ${report.template.name} (v${report.template.version})`,
      ...report.template.lines.map(
        (line) => `${line.code} ${line.label}: ${money(line.totalCents)}`,
      ),
    );
    if (report.template.revenueThresholdCents !== null)
      lines.push(
        `${l.threshold}: ${formatMoney(report.template.revenueThresholdCents, language)} – ${report.template.thresholdExceeded ? l.exceeded : l.notExceeded}`,
      );
    if (report.template.unmappedCategoryIds.length)
      lines.push(
        `${l.unmapped}: ${report.template.unmappedCategoryIds.map((id) => names.get(id)).join(', ')}`,
      );
  }
  return renderPdf(
    `${l.report} ${fiscalYear}`,
    await organizationName(db, org),
    lines,
    language,
    l.reportNote,
  );
}
