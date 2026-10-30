import type de from './mail-de';
const it: Record<keyof typeof de, string> = {
  mailTitle: 'E-mail',
  mailIntro: 'Invitare, ricordare e seguire gli invii.',
  mailCompose: 'Prepara messaggio',
  mailComposeHint: 'Controlla destinatari e contenuto prima dell’invio.',
  mailKind: 'Tipo di messaggio',
  mailKind_fee_reminder: 'Promemoria quote associative',
  mailKind_event_invitation: 'Inviti agli eventi',
  mailEvent: 'Evento',
  mailChooseEvent: 'Seleziona evento',
  mailPreview: 'Anteprima invio',
  mailFeeHint:
    'Ricorda ai soci attivi le quote scadute e non saldate. Le quote già sollecitate vengono escluse durante l’intervallo impostato.',
  mailEventHint:
    'Invita i soci attivi con account associativo a un evento futuro. Esclude chi è già iscritto e gli inviti già inviati senza modifiche.',
  mailMode_disabled: 'L’invio e-mail non è ancora configurato. Le anteprime sono già disponibili.',
  mailMode_local:
    'Casella di prova locale attiva: le e-mail vengono intercettate, senza recapito esterno.',
  mailMode_smtp:
    'L’invio e-mail è attivo. I messaggi confermati vengono inviati ai destinatari indicati.',
  mailOpenInbox: 'Apri casella di prova',
  mailOutbox: 'Posta in uscita',
  mailOutboxHint:
    'Ogni messaggio viene inviato singolarmente. Gli altri indirizzi rimangono riservati.',
  mailEmpty: 'Nessun messaggio in uscita',
  mailRecipient: 'Destinatario',
  mailSubject: 'Oggetto',
  mailCreated: 'Preparato il',
  mailPreviewCount: '{{count}} messaggi pronti per l’invio.',
  mailSkipped:
    'Esclusi: {{invalid}} senza e-mail valida, {{noAccount}} senza account, {{recent}} già contattati.',
  mailExample: 'Messaggio di esempio',
  mailConfirmHint:
    'Ogni persona riceve il messaggio nella propria lingua preferita. Destinatari e situazione vengono ricontrollati prima dell’invio.',
  mailConfirm: 'Conferma invio',
  mailQueuing: 'Preparazione …',
  mailQueuedCount: '{{count}} messaggi aggiunti alla posta in uscita.',
  mailDetails: 'Dettagli messaggio',
  mailState_queued: 'In attesa di invio',
  mailState_sending: 'Consegna in corso',
  mailState_sent: 'Accettato dal server e-mail',
  mailState_failed: 'Rifiutato',
  mailState_uncertain: 'Stato invio incerto',
  mailState_cancelled: 'Non più necessario',
  mailError_SMTP_REJECTED:
    'Il server e-mail non ha accettato il messaggio. Controllare la configurazione.',
  mailError_SMTP_UNCERTAIN:
    'La consegna è possibile ma non confermata. Controllare prima la casella o il servizio e-mail. Nessun tentativo automatico.',
  mailError_SOURCE_CHANGED:
    'Permessi, destinatario o situazione sono cambiati. Il messaggio non è stato inviato.',
  mailAutomation: 'Promemoria automatici',
  mailAutomationHint:
    'Dopo l’attivazione le quote scadute vengono controllate ogni giorno. Un nuovo promemoria rispetta l’intervallo impostato. È necessario un account amministratore valido.',
  mailAutoEnabled: 'Inviare automaticamente i promemoria delle quote',
  mailInterval: 'Intervallo minimo in giorni (7–90)',
  mailSettingsSaved: 'Impostazioni dei promemoria salvate.',
  mailDisabled: 'Configurare prima l’invio e-mail.',
  mailPreviewChanged:
    'Destinatari o contenuto sono cambiati. Chiudere l’anteprima e generarne una nuova.',
  mailEventUnavailable: 'Selezionare un evento futuro e pubblicato con iscrizioni ancora aperte.',
  mailTooMany: 'Questa anteprima supera i 250 messaggi. Contattare l’amministrazione.',
};
export default it;
