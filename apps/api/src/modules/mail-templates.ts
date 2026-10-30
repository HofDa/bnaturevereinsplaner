const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
export function feeReminderMail(input: {
  language: 'de' | 'it';
  organization: string;
  name: string;
  plan: string;
  amountCents: number;
  dueDate: string;
}) {
  const de = input.language === 'de';
  const amount = new Intl.NumberFormat(de ? 'de-IT' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(input.amountCents / 100);
  const date = new Intl.DateTimeFormat(de ? 'de-IT' : 'it-IT', { timeZone: 'UTC' }).format(
    new Date(`${input.dueDate}T12:00:00Z`),
  );
  return {
    subject: oneLine(
      `${input.organization}: ${de ? 'Erinnerung an Ihren Mitgliedsbeitrag' : 'Promemoria quota associativa'}`,
    ),
    text: de
      ? `Hallo ${input.name},\n\nfür „${input.plan}“ sind noch ${amount} offen. Die Zahlung war am ${date} fällig.\n\nBitte begleichen Sie den offenen Betrag. Falls Sie die Zahlung gerade veranlasst haben, wenden Sie sich bei Fragen an Ihren Verein.\n\nVielen Dank!\n${input.organization}`
      : `Buongiorno ${input.name},\n\nper «${input.plan}» risultano ancora da versare ${amount}. La scadenza era il ${date}.\n\nLa preghiamo di saldare l’importo. Se ha appena effettuato il pagamento, contatti l’associazione per eventuali chiarimenti.\n\nGrazie!\n${input.organization}`,
  };
}
export function eventInvitationMail(input: {
  language: 'de' | 'it';
  organization: string;
  name: string;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location: string;
  appUrl: string;
  eventId: string;
}) {
  const de = input.language === 'de';
  const format = new Intl.DateTimeFormat(de ? 'de-IT' : 'it-IT', {
    timeZone: input.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const link = new URL(`/events/${input.eventId}`, input.appUrl).href;
  return {
    subject: oneLine(
      `${input.organization}: ${de ? 'Einladung' : 'Invito'} – ${input.title}`,
    ).slice(0, 500),
    text: de
      ? `Hallo ${input.name},\n\nwir laden Sie zu „${input.title}“ ein.\n\nBeginn: ${format.format(input.startAt)}\nEnde: ${format.format(input.endAt)}\nOrt: ${input.location || 'siehe Veranstaltung'}\n\nDetails und Anmeldung mit Ihrem Vereinszugang:\n${link}\n\n${input.organization}`
      : `Buongiorno ${input.name},\n\nla invitiamo a «${input.title}».\n\nInizio: ${format.format(input.startAt)}\nFine: ${format.format(input.endAt)}\nLuogo: ${input.location || 'vedere evento'}\n\nDettagli e iscrizione con il suo account associativo:\n${link}\n\n${input.organization}`,
  };
}
