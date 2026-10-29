import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { and, eq } from 'drizzle-orm';
import { schema as s, type Database } from '@bnature/db';
import { formatMoney } from '@bnature/contracts';
import { HttpError } from '../../middleware/access';
import { getPayment, getAssessment } from './service';

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
  },
};
async function renderPdf(
  title: string,
  organization: string,
  lines: string[],
  language: 'de' | 'it',
) {
  const document = await PDFDocument.create(),
    font = await document.embedFont(StandardFonts.Helvetica),
    bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(title);
  document.setAuthor('b*nature');
  document.setLanguage(language);
  document.setCreator('b*nature Vereinsplattform');
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
  draw(labels[language].note, 9);
  if (missing) draw(labels[language].unsupported, 9);
  return Buffer.from(await document.save());
}
async function organizationName(db: Database, org: string) {
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
      `${l.prepared}: ${reminder.createdAt.toISOString().slice(0, 10)}`,
      `#${reminder.sequence}`,
      '',
      l.draft,
    ],
    language,
  );
}
