export default {
  mailKindUnavailable: 'Diese Nachrichtenart ist noch nicht für den Versand eingerichtet.',
  mailError_MAIL_KIND_UNAVAILABLE:
    'Diese Nachrichtenart hat noch keinen eingerichteten Versand. Es wurde keine E-Mail verschickt.',
  mailTitle: 'E-Mail',
  mailIntro: 'Einladen, erinnern und den Versand im Blick behalten.',
  mailCompose: 'Nachricht vorbereiten',
  mailComposeHint: 'Empfänger und Inhalt vor dem Versand prüfen.',
  mailKind: 'Nachrichtenart',
  mailKind_fee_reminder: 'Beitragserinnerungen',
  mailKind_event_invitation: 'Termineinladungen',
  mailKind_community_digest: 'Vereinsleben-Zusammenfassungen',
  mailEvent: 'Veranstaltung',
  mailChooseEvent: 'Veranstaltung auswählen',
  mailPreview: 'Versandvorschau',
  mailFeeHint:
    'Erinnert aktive Mitglieder mit offenen, überfälligen Beiträgen. Bereits kontaktierte Forderungen werden innerhalb des eingestellten Abstands ausgelassen.',
  mailEventHint:
    'Lädt aktive Mitglieder mit Vereinszugang zu einer kommenden Veranstaltung ein. Bereits angemeldete Personen und unverändert versendete Einladungen werden ausgelassen.',
  mailMode_disabled:
    'Der E-Mail-Versand ist noch nicht eingerichtet. Vorschauen sind bereits verfügbar.',
  mailMode_local:
    'Lokales Testpostfach aktiv: E-Mails werden abgefangen und nicht extern zugestellt.',
  mailMode_smtp:
    'Der E-Mail-Versand ist aktiv. Bestätigte Nachrichten gehen an die angezeigten Empfänger.',
  mailOpenInbox: 'Testpostfach öffnen',
  mailOutbox: 'Postausgang',
  mailOutboxHint:
    'Jede Nachricht wird einzeln zugestellt. Andere Empfängeradressen bleiben verborgen.',
  mailEmpty: 'Noch keine Nachrichten im Postausgang',
  mailRecipient: 'Empfänger',
  mailSubject: 'Betreff',
  mailCreated: 'Vorbereitet am',
  mailPreviewCount: 'Zum Versand vorbereitete Nachrichten: {{count}}',
  mailSkipped:
    'Ausgelassen: {{invalid}} ohne gültige E-Mail, {{noAccount}} ohne Vereinszugang, {{recent}} bereits kontaktiert.',
  mailExample: 'Beispielnachricht',
  mailConfirmHint:
    'Jede Person erhält die Nachricht in ihrer bevorzugten Sprache. Vor dem Versand werden Empfänger und aktueller Sachstand erneut geprüft.',
  mailConfirm: 'Versand bestätigen',
  mailQueuing: 'Wird vorbereitet …',
  mailQueuedCount: 'In den Postausgang übernommene Nachrichten: {{count}}',
  mailDetails: 'Nachrichtendetails',
  mailState_queued: 'Wartet auf Versand',
  mailState_sending: 'Wird übergeben',
  mailState_sent: 'Vom Mailserver angenommen',
  mailState_failed: 'Abgewiesen',
  mailState_uncertain: 'Versandstatus unklar',
  mailState_cancelled: 'Nicht mehr erforderlich',
  mailError_SMTP_REJECTED:
    'Der Mailserver hat die Nachricht nicht angenommen. Bitte die Versandkonfiguration prüfen.',
  mailError_SMTP_UNCERTAIN:
    'Eine Zustellung ist möglich, aber nicht bestätigt. Bitte zuerst im Postfach oder beim Mailanbieter prüfen. Es erfolgt keine automatische Wiederholung.',
  mailError_SOURCE_CHANGED:
    'Berechtigung, Empfänger oder Sachstand haben sich geändert. Die Nachricht wurde nicht versendet.',
  mailAutomation: 'Automatische Erinnerungen',
  mailAutomationHint:
    'Nach dem Aktivieren werden überfällige Beiträge täglich geprüft. Pro Forderung wird frühestens nach dem eingestellten Abstand erneut erinnert. Ein gültiger Adminzugang ist Voraussetzung.',
  mailAutoEnabled: 'Beitragserinnerungen automatisch versenden',
  mailAutoDeadlines: 'Fristen automatisch erinnern (an zuständige Person bzw. Rolle, sonst Admins)',
  mailAutoLoans:
    'Ausleihen automatisch erinnern (2 Tage vor Rückgabe, dann bei Überfälligkeit wöchentlich)',
  mailKind_deadline_reminder: 'Fristerinnerungen',
  mailKind_loan_reminder: 'Rückgabeerinnerungen',
  mailInterval: 'Mindestabstand in Tagen (7–90)',
  mailSettingsSaved: 'Einstellungen für Erinnerungen gespeichert.',
  mailDisabled: 'Bitte zuerst den E-Mail-Versand einrichten.',
  mailPreviewChanged:
    'Empfänger oder Inhalt haben sich geändert. Bitte schließen Sie die Vorschau und prüfen Sie eine neue Vorschau.',
  mailEventUnavailable:
    'Bitte eine kommende, veröffentlichte Veranstaltung mit offener Anmeldefrist auswählen.',
  mailTooMany:
    'Diese Vorschau enthält mehr als 250 Nachrichten. Bitte wenden Sie sich an die Administration.',
  mailKind_newsletter: 'Newsletter',
  mailNewsletterDraft: 'Newsletter-Entwurf',
  mailNewsletterChoose: 'Entwurf auswählen',
  mailNewsletterNew: 'Neuer Newsletter',
  mailNewsletterEdit: 'Newsletter bearbeiten',
  mailNewsletterWithdraw: 'Entwurf verwerfen',
  mailNewsletterHelp:
    'Text als Klartext auf Deutsch und Italienisch; jedes Mitglied erhält die eigene Sprache mit persönlicher Anrede und einem Hinweis zum Abbestellen. Nach dem Versand ist der Newsletter fest.',
  mailNewsletterSubjectDe: 'Betreff (DE)',
  mailNewsletterSubjectIt: 'Betreff (IT)',
  mailNewsletterBodyDe: 'Text (DE)',
  mailNewsletterBodyIt: 'Text (IT)',
  mailNewsletterAudience: 'Empfänger',
  mailNewsletterAudienceHint:
    'Ohne Auswahl erhalten ihn alle aktiven Mitglieder; sonst nur Mitglieder der gewählten Gruppen.',
  mailNewsletterSave: 'Entwurf speichern',
  mailNewsletterHint:
    'Aktive Mitglieder mit gültiger E-Mail-Adresse, die den Newsletter nicht abbestellt haben. Jeder Entwurf wird genau einmal versendet.',
  mailNewsletterProfileTitle: 'Vereins-Newsletter',
  mailNewsletterReceive: 'Newsletter per E-Mail erhalten',
  mailNewsletterProfileHint:
    'Betrifft nur den Newsletter. Erinnerungen und Einladungen werden weiterhin zugestellt.',
  mailSkippedOptOut_one: '{{count}} Mitglied hat den Newsletter abbestellt.',
  mailSkippedOptOut_other: '{{count}} Mitglieder haben den Newsletter abbestellt.',
};
