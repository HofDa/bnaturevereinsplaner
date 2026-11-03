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

export function communityDigestMail(input: {
  language: 'de' | 'it';
  organization: string;
  name: string;
  appUrl: string;
  news: string[];
  newsCount: number;
  polls: string[];
  pollCount: number;
  chat: { name: string | null; count: number }[];
}) {
  const de = input.language === 'de';
  const link = new URL('/community', input.appUrl).href;
  const settings = new URL('/profile', input.appUrl).href;
  const more = (shown: number, total: number) =>
    total > shown ? [de ? `  … und ${total - shown} weitere` : `  … e altri ${total - shown}`] : [];
  const lines: string[] = [];
  if (input.newsCount)
    lines.push(
      de ? `Neue News (${input.newsCount}):` : `Nuove notizie (${input.newsCount}):`,
      ...input.news.map((title) => `  • ${oneLine(title)}`),
      ...more(input.news.length, input.newsCount),
      '',
    );
  if (input.pollCount)
    lines.push(
      de ? `Neue Umfragen (${input.pollCount}):` : `Nuovi sondaggi (${input.pollCount}):`,
      ...input.polls.map((title) => `  • ${oneLine(title)}`),
      ...more(input.polls.length, input.pollCount),
      '',
    );
  if (input.chat.length)
    lines.push(
      de ? 'Neue Chatnachrichten:' : 'Nuovi messaggi in chat:',
      ...input.chat.map(
        (c) =>
          `  • ${c.name === null ? (de ? 'Ganzer Verein' : 'Tutta l’associazione') : oneLine(c.name)}: ${c.count}`,
      ),
      '',
    );
  return {
    subject: oneLine(
      `${input.organization}: ${de ? 'Neues im Vereinsleben' : 'Novità dalla vita associativa'}`,
    ).slice(0, 500),
    text: de
      ? `Hallo ${input.name},\n\nseit der letzten Zusammenfassung gibt es Neues:\n\n${lines.join('\n')}Zum Vereinsleben (Anmeldung erforderlich):\n${link}\n\nDiese Zusammenfassung können Sie im Profil ändern oder abbestellen:\n${settings}\n\n${input.organization}`
      : `Buongiorno ${input.name},\n\ndall’ultimo riepilogo ci sono novità:\n\n${lines.join('\n')}Vai alla vita associativa (accesso richiesto):\n${link}\n\nPuò modificare o disattivare questo riepilogo nel profilo:\n${settings}\n\n${input.organization}`,
  };
}

const dateText = (de: boolean, iso: string) =>
  new Intl.DateTimeFormat(de ? 'de-IT' : 'it-IT', { timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
export function deadlineReminderMail(input: {
  language: 'de' | 'it';
  organization: string;
  name: string;
  title: string;
  dueDate: string;
  daysLeft: number;
  appUrl: string;
  deadlineId: string;
}) {
  const de = input.language === 'de';
  const when =
    input.daysLeft > 0
      ? de
        ? `in ${input.daysLeft} ${input.daysLeft === 1 ? 'Tag' : 'Tagen'}`
        : `tra ${input.daysLeft} ${input.daysLeft === 1 ? 'giorno' : 'giorni'}`
      : input.daysLeft === 0
        ? de
          ? 'heute'
          : 'oggi'
        : de
          ? `seit ${-input.daysLeft} ${input.daysLeft === -1 ? 'Tag' : 'Tagen'} überfällig`
          : `scaduta da ${-input.daysLeft} ${input.daysLeft === -1 ? 'giorno' : 'giorni'}`;
  const link = new URL('/compliance', input.appUrl).href;
  return {
    subject: oneLine(
      `${input.organization}: ${de ? 'Frist' : 'Scadenza'} – ${input.title} (${dateText(de, input.dueDate)})`,
    ).slice(0, 500),
    text: de
      ? `Hallo ${input.name},\n\ndie Frist „${input.title}“ ist am ${dateText(de, input.dueDate)} fällig (${when}).\n\nDetails und Erledigung im Fristenmanager (Anmeldung erforderlich):\n${link}\n\nDiese Erinnerung wird automatisch versendet, solange die Frist offen ist.\n${input.organization}`
      : `Buongiorno ${input.name},\n\nla scadenza «${input.title}» è fissata al ${dateText(de, input.dueDate)} (${when}).\n\nDettagli e chiusura nello scadenzario (accesso richiesto):\n${link}\n\nQuesto promemoria viene inviato automaticamente finché la scadenza è aperta.\n${input.organization}`,
  };
}
export function loanReminderMail(input: {
  language: 'de' | 'it';
  organization: string;
  name: string;
  item: string;
  quantity: number;
  dueOn: string;
  overdue: boolean;
}) {
  const de = input.language === 'de';
  const what = input.quantity > 1 ? `${input.quantity} × ${input.item}` : input.item;
  return {
    subject: oneLine(
      `${input.organization}: ${
        input.overdue
          ? de
            ? 'Rückgabe überfällig'
            : 'Restituzione scaduta'
          : de
            ? 'Rückgabe in Kürze'
            : 'Restituzione a breve'
      } – ${input.item}`,
    ).slice(0, 500),
    text: de
      ? `Hallo ${input.name},\n\n${input.overdue ? `die Rückgabe von „${what}“ war am ${dateText(de, input.dueOn)} fällig.` : `bitte denken Sie an die Rückgabe von „${what}“ bis ${dateText(de, input.dueOn)}.`}\n\nFalls Sie den Gegenstand bereits zurückgegeben haben oder mehr Zeit brauchen, melden Sie sich bitte beim Verein.\n\nVielen Dank!\n${input.organization}`
      : `Buongiorno ${input.name},\n\n${input.overdue ? `la restituzione di «${what}» era prevista per il ${dateText(de, input.dueOn)}.` : `le ricordiamo di restituire «${what}» entro il ${dateText(de, input.dueOn)}.`}\n\nSe ha già restituito l’oggetto o le serve più tempo, contatti l’associazione.\n\nGrazie!\n${input.organization}`,
  };
}
