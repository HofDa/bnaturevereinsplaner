# REST API v1

## Vereinsleben

Alle Pfade unter `/api/v1/community`, mit Session und Organisationskontext:

- `GET /audiences`: verfügbare aktive Gruppen; normale Benutzer erhalten nur eigene Gruppenzuordnungen.
- `GET /posts?kind=news|poll&state=published|draft|archived&page=1&groupId=...`, `GET /posts/:id`: paginierte Beiträge und Details mit aktueller Zugriffsprüfung. Entwürfe/Archiv nur für Redaktion.
- `POST /posts`, `PATCH /posts/:id` (`{version,content}`): zweisprachiger Entwurf oder versionierte Korrektur. Nur Admin/Vorstand.
- `POST /posts/:id/publish|close|archive` (`{version}`): ausdrücklich bestätigter Statuswechsel.
- `PUT /posts/:id/vote` (`{version,optionId}`): eigene Stimme abgeben oder ersetzen. Vor Freigabe der Ergebnisse sind Gesamtzahl und Optionszahlen `null`; die eigene Antwort ist nur im eigenen Kontext enthalten.
- `GET /chat?groupId=...&before=...`: Nachrichten des Vereins- oder Gruppenkanals, höchstens 50 je Abschnitt, älteste zuerst. `nextBefore` ruft den vorangehenden Abschnitt auf. Cursor müssen aus demselben Kanal stammen.
- `POST /chat` (`{body,groupId?}`), `POST /chat/:id/remove` (`{version}`): Nachricht bis 2000 Zeichen senden beziehungsweise eigene Nachricht oder als Redaktion moderieren. Entfernte Texte werden nicht zurückgegeben.
- `PUT /chat/:id/reactions` (`{emoji,active}`): eigene Reaktion setzen (`active: true`) oder zurücknehmen (`false`). Erlaubt sind 👍 ❤️ 😂 😮 🎉 🙏. Der Aufruf setzt einen Zustand und schaltet nicht um; Wiederholungen ändern daher nichts. Nachrichten im Listenaufruf enthalten `reactions` mit Anzahl, eigener Auswahl und Namen der Reagierenden.

Alle Schreiboperationen benötigen `Origin` und UUID-`Idempotency-Key`. Gruppenzugang und Ergebnisfreigabe werden auch bei direktem Detailzugriff serverseitig geprüft. [Nutzung und Grenzen](../community.md).

Die versionierte [OpenAPI-Spezifikation](openapi.json) wird mit `bun run openapi` aus Fastify-/Zod-Verträgen generiert. Entwicklungs-Swagger-UI: `/api/docs`; Produktion deaktiviert. Authentifizierung liegt separat unter `/api/auth` und wird von Better Auth verwaltet.

- `POST /chat` akzeptiert zusätzlich `replyToId`, `mentionUserIds` (höchstens 10, nur Personen mit Kanalzugang) und `attachment` (`{kind:'event'|'poll',id}`). `GET /chat/members?groupId=` liefert die erwähnbaren Konten.
- `GET /schedules?state=open|closed`, `GET /schedules/:id`, `POST /schedules` (`{titleI18n,descriptionI18n,location,groupId,closesAt,slots:[{startAt,endAt}]}`), `PUT /schedules/:id/answers` (`{answers:[{slotId,answer:yes|maybe|no}]}`), `POST /schedules/:id/close` (`{version,finalSlotId}`), `POST /schedules/:id/event` (`{categoryId,visibility,status}`, Recht `events:write`, einmalig): Terminfindung; Schreibaufrufe mit `Idempotency-Key`.
- `GET /unread`: ungelesene News, Umfragen und Chatnachrichten anderer Personen (`{news,polls,chat:[{groupId,count}],total}`). Berücksichtigt den Vereinskanal und aktive Gruppen, denen das Konto über die verknüpfte Person angehört.
- `PUT /read` (`{channel,groupId?,until}`, 204): Lesemarke für `news`, `poll` oder einen Chatkanal bis zum angegebenen Zeitpunkt setzen. Die Marke wandert nur vorwärts und nie über die Serverzeit hinaus; daher ohne `Idempotency-Key`.
- `GET|PUT /notifications` (`{digest: off|daily|weekly}`): eigene Einstellung für die Zusammenfassung per E-Mail.

## Konventionen

Alle fachlichen Endpunkte haben Präfix `/api/v1`. Ausnahme für Authentifizierung: `/api/auth/sign-in/email`, `/sign-out`, `/get-session`, `/change-password`, `/update-user` und Sitzungsverwaltung. Andere Auth-Endpunkte sind nicht veröffentlicht. Health ist öffentlich, Fachendpunkte erfordern ein gültiges Cookie. HttpOnly-Cookies werden nicht vom Frontend gelesen.

`X-Organization-Id: <UUID>` wählt eine Organisation, für die das Benutzerkonto eine aktuelle Rolle besitzt. Ohne Header wird deterministisch die erste berechtigte Organisation gewählt; `/me` liefert diesen Kontext und alle erlaubten Organisationen. Ein Body-Feld ersetzt niemals diesen Kontext. Jede Mutation benötigt `Origin` mit dem exakten konfigurierten `APP_URL`-Ursprung. Keine tokenbasierte oder Cross-Origin-API-Freigabe in Phase 1.

Listen: `page` ab 1, `pageSize` 1–100 (Standard 20), `search` bis 100 Zeichen, `sort=name|createdAt|joinedAt`, `direction=asc|desc`. Mitglieder unterstützen `status=active|pending|inactive|resigned`; Gruppen `active=true|false`. Antwort: `{ items, total, page, pageSize }`. Stabile ID als sekundäre Sortierung. Mitglieder sortieren nach angefordertem Feld; Gruppen nach Name/Erstellung, Mandate nach Amtsbeginn, Audit nach Zeitpunkt, Benutzer nach Name. Nicht anwendbare allgemeine Sortierfelder werden bei diesen Modulen auf das dokumentierte Hauptfeld abgebildet.

Einzelne fremde oder unbekannte IDs: 404. Fehlende Sitzung: 401. Unberechtigte Rolle oder Organisationswahl: 403. Eingabe-/Statusfehler: 422. Eindeutigkeitskonflikt bzw. letzter Administrator: 409. Zu viele Anfragen: 429. JSON-Fehlerformat: `{ error: { code, message, requestId, fields? } }`. Better-Auth-Endpunkte verwenden deren eigenes Fehlerformat. Personendaten erhalten immer `Cache-Control: no-store`.

PATCH akzeptiert ausschließlich gelieferte bekannte Felder ohne create-Defaults. Der Service lädt den aktuellen Datensatz, sperrt ihn bei Bedarf und validiert die zusammengeführte Fassung. UUIDs und Zeitstempel werden serverseitig erzeugt, Kalenderdaten als `YYYY-MM-DD`, UTC-Zeitpunkte als ISO-8601 serialisiert.

## Endpunkte

### E-Mail-Erweiterung

`GET /mail/status`, `GET /mail/messages?page=1`, `POST /mail/preview`, `POST /mail/send`, `GET/PUT /mail/settings`; jeweils unter `/api/v1`. Vorschau-Body: `{kind:"fee_reminder"}` oder `{kind:"event_invitation",eventId}`. Versand-Body: `{request,previewHash}` plus `Idempotency-Key`; Antwort 202 mit `queued` und `batchId`. Vorschau-Hash und Berechtigungen werden beim Bestätigen erneut geprüft. Einstellungen mit `automaticFeeReminders` und `reminderIntervalDays` (7–90), initial aus/14 Tage. Voransicht und Postausgang nur für die jeweils erlaubte Nachrichtenart, Einstellungen nur für Admins. Details: [E-Mail](../mail.md).

### Bisherige Endpunkte

| Methode / Pfad                                                      | Zweck                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /health                                                         | Status einschließlich DB-Verbindung                                                                                                                   |
| GET /me                                                             | Konto, Organisationen, aktuelle Rolle und Berechtigungen                                                                                              |
| GET/PATCH /organizations/:id                                        | Eigenes Vereinsprofil                                                                                                                                 |
| GET/POST /members                                                   | Mitgliederliste / Person und Mitgliedschaft transaktional anlegen                                                                                     |
| GET/PATCH /members/:id                                              | Mitgliedschafts-ID mit Personendaten; Änderungen transaktional                                                                                        |
| GET/POST /groups                                                    | Gruppenliste / Anlage                                                                                                                                 |
| GET/PATCH /groups/:id                                               | Gruppe / Metadatenänderung                                                                                                                            |
| PUT /groups/:id/members                                             | Gesamte Zuordnung durch `{ personIds: UUID[] }` ersetzen; max. 500                                                                                    |
| GET/POST /board-mandates                                            | Amtszeiten / Anlage                                                                                                                                   |
| PATCH /board-mandates/:id                                           | Funktion oder Zeitraum ändern                                                                                                                         |
| GET /audit-logs                                                     | Organisationsbezogenes Audit-Protokoll                                                                                                                |
| GET /dashboard                                                      | Echte Aggregate, neue Mitglieder im laufenden UTC-Monat und aktuelle Mandate                                                                          |
| GET /dashboard/occasions                                            | Geburtstage und Mitgliedsjubiläen aktiver Mitglieder, `days` 1–90 (Standard 30)                                                                       |
| GET /reports/annual-overview?year=                                  | Jahresüberblick je Monat (Mitglieder, Veranstaltungen, bestätigte Stunden); Abschnitte ohne Leserecht sind `null`                                     |
| GET /me/volunteering · POST /me/volunteering/time-entries           | Eigene Tätigkeiten, Einsätze und Stunden; eigene Stunden nachträglich als `submitted` melden (`Idempotency-Key`)                                      |
| GET /member-fields · POST /member-fields · PATCH /member-fields/:id | Zusatzfelder lesen (`members:read`) / anlegen und ändern (`organization:write`); Art unveränderlich, höchstens 50                                     |
| GET /members?photoConsent=&dataConsent=                             | Filter nach aktuellem Einwilligungsstand (`granted`, `refused`, `missing`); Listeneinträge enthalten `photoConsent`, `dataConsent` und `customFields` |
| GET /members/:id/extras                                             | Zusatzwerte, aktuelle Einwilligungen mit Verlauf, Erziehungsberechtigte und `isMinor`                                                                 |
| PUT /members/:id/fields                                             | Zusatzwerte `{values:{feldId:wert\|null}}` typgeprüft setzen oder leeren                                                                              |
| POST /members/:id/consents                                          | Einwilligungserklärung anhängen; Datensätze sind auch in PostgreSQL unveränderlich                                                                    |
| POST · PATCH · DELETE /members/:id/guardians[/:guardianId]          | Erziehungsberechtigte verwalten (höchstens fünf)                                                                                                      |
| GET/PATCH /profile                                                  | Ausschließlich eigenes verknüpftes Personenprofil                                                                                                     |
| GET/POST /users                                                     | Berechtigte Konten anzeigen / geschlossen bereitstellen                                                                                               |
| PATCH /users/:id/role                                               | Organisationsrolle ändern; letzten Admin erhalten                                                                                                     |

`members.id` ist die Mitgliedschafts-ID, `personId` die getrennte Personen-ID. Gruppen und Mandate referenzieren `personId`. Normale Benutzerkonten werden nicht automatisch Vereinsmitglieder. Die Benutzeranlage kann optional eine bereits zur eigenen Organisation gehörende Person verknüpfen. Das Initialkonto wird ausschließlich über `bun run bootstrap` angelegt.

CSV-Vorschau/-Parsing findet im Browser statt. Der Export lädt die gefilterte Liste seitenweise; er ist keine konsistente Gesamtdatenbankaufnahme über mehrere Seiten. Importierte Zeilen werden über dieselben geprüften Mitglieder-Endpunkte angelegt und auditisiert. Fehlgeschlagene Zeilen bleiben nachvollziehbar sichtbar.

## Sprint 2.1 – Mitgliedsbeiträge

Alle folgenden Ressourcen verwenden die bestehende Cookie-Session und den geprüften Organisationskontext. Admin und Kassier haben Finanz-Lese-/Schreibrechte; ausschließlich Admin verwaltet Tarife. Vorstand, Projektleitung und Mitglieder erhalten keinen Zugriff, auch nicht auf PDFs.

| Methode / Pfad                         | Zweck                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET/POST /fee-plans                    | Tarife auflisten / anlegen                                                                                      |
| GET/PATCH /fee-plans/:id               | Tarif lesen / mit `version` ändern                                                                              |
| GET/POST /fee-assessments              | Forderungen auflisten / aus Tarif und Mitgliedschaft festsetzen                                                 |
| POST /fee-assessments/batch/preview    | Sammelvorschreibung: Empfänger, Summe und übersprungene Mitglieder mit `previewHash`                            |
| POST /fee-assessments/batch            | Bestätigte Sammelvorschreibung mit `previewHash` und `Idempotency-Key`; 409 `PREVIEW_STALE` bei geänderter Lage |
| GET /fee-assessments/:id               | Forderung einschließlich berechnetem Saldo und Zahlungshistorie                                                 |
| GET /finance/summary                   | Exakte Cent-Summen, offene/bezahlte/befreite Forderungen                                                        |
| GET/POST /payments                     | Zahlungsereignisse auflisten / vollständig zugeordnet erfassen                                                  |
| GET /payments/:id                      | Unveränderliche Zahlung und alle Zuordnungen                                                                    |
| GET /payments/:id/receipt?language=de  | Autorisierte PDF-Zahlungsbestätigung, alternativ `it`                                                           |
| POST /fee-assessments/:id/reminders    | Überfälligen offenen Betrag als Erinnerungsentwurf vorbereiten; Body `{}`                                       |
| GET /fee-reminders/:id/pdf?language=de | Autorisierter Erinnerungsentwurf; kein automatischer Versand                                                    |

Jede Finanzmutation benötigt den Header `Idempotency-Key` mit UUID. Erfolgreiche Wiederholung liefert denselben Status und dieselbe ursprüngliche Antwort ohne neue Daten; Header `Idempotency-Replayed` zeigt `true`/`false`. Der Schlüssel gilt organisationsweit und ist an Operation und normalisierten Inhalt gebunden. Geänderte Daten mit demselben Schlüssel ergeben 409 `IDEMPOTENCY_MISMATCH`. Der JSON-Body darf keinen Organisations-/Akteurkontext einschleusen.

Beträge: `amountCents`, `individualAmountCents`, `reductionCents` und Zuordnungsbeträge sind Integer-Centwerte; keine EUR-Fließkommazahlen oder numerischen Zeichenfolgen. Summen in `/finance/summary` sind dezimale Cent-Zeichenfolgen. Eine Zahlung enthält `payerName`, `paidOn`, `method=cash|bank_transfer|other`, optionale `reference`/`notes`, `amountCents` und `allocations: [{ assessmentId, amountCents }]`. Summe aller Zuordnungen muss exakt dem Zahlungsbetrag entsprechen. Höchstens 100 unterschiedliche Forderungen je Zahlung. Vollständige Zuordnung wird auch durch einen verzögerten SQL-Constraint am Commit erzwungen.

Eine Forderung enthält `membershipId`, `planId`, `fiscalYear`, `dueDate`, optional `individualAmountCents`, `reductionCents`, `exempt` und `adjustmentReason`. Anpassungen benötigen eine Begründung. Jahr 1900–2200; vorhandene Kategorien `ordinary|supporting|honorary`; EUR als feste Währung. Tarifänderungen erfordern die zuletzt gelesene `version`. Bereits festgesetzte Forderungen werden nicht nachträglich verändert.

Listen verwenden `page`, `pageSize`, `search`, `direction`, `sort=name|createdAt|dueDate|paidOn|amountCents`. Nicht passende Sortierungen fallen auf das dokumentierte Hauptfeld zurück. Forderungen: `fiscalYear`, `membershipId`, `planId`, `status=open|partial|paid|exempt|overdue|outstanding`; `outstanding` umfasst alle positiven Restbeträge. Tarife: `active=true|false`, `membershipType`. Zahlungen: `fiscalYear` filtert das Kalenderjahr des Zahlungsdatums, nicht das Beitragsjahr der möglichen mehreren Zuordnungen. Die Zusammenfassung filtert dagegen nach dem Beitragsjahr der Forderungen. Es gibt keinen impliziten Default-Jahresfilter in der API.

Wichtige Fehlercodes: `FEE_PLAN_EXISTS`, `ASSESSMENT_EXISTS`, `PLAN_INACTIVE`, `PLAN_IN_USE`, `STALE_VERSION`, `FEE_CATEGORY_MISMATCH`, `INVALID_REDUCTION`, `OVERPAYMENT`, `PAYMENT_REFERENCE_EXISTS`, `IDEMPOTENCY_MISMATCH`, `REMINDER_NOT_DUE`. HTTP 409 für Konflikte; 422 für ungültige Eingaben/Kategorien/Zuordnungen; 401/403/404 wie in Phase 1. Die Oberfläche übersetzt diese Codes nach DE/IT.

PDF-Erfolge verwenden `application/pdf` und `Content-Disposition: attachment`; Fehler bleiben JSON. Alle Antworten sind `no-store`. CSV-Exporte laden die gefilterten Listen autorisiert seitenweise und neutralisieren Tabellenformeln. Der Zahlungs-CSV enthält genau eine Zeile je Zahlung, damit Gesamtbeträge bei mehreren Zuordnungen nicht doppelt summiert werden. Zuordnungsdetails stehen in der Detail-API und PDF-Bestätigung.

## Sprint 2.2 – Erweiterungen

Alle Pfade unter `/api/v1`; Finanzzugriff nur Admin/Kassier, Abschluss nur Admin. Schreiboperationen erfordern `Idempotency-Key` und `Origin`.

| Methode / Pfad                                | Zweck                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| POST /finance/initialize                      | Startkategorien und eindeutig auswählbare automatische Zahlungskonten ergänzen (`language`)                                |
| GET /finance/dashboard                        | Bestände, Jahreswerte, offene Beiträge, letzte Buchungen und Monatsentwicklung                                             |
| GET /finance/cashbook/:id/history             | Originalbuchung und etwaige Gegenbuchung                                                                                   |
| GET /finance/cashbook-export/pdf              | Privates PDF, dieselben Filter wie Kassabuch plus `language`                                                               |
| GET/POST /finance/transfers                   | Interne Überträge, Liste mit `fiscalYear`                                                                                  |
| POST /finance/transfers/:id/reversal          | Exakter Rückübertrag mit Datum und Begründung                                                                              |
| POST /finance/payments/backfill               | Bis 100 historische Zahlungen nachbuchen (`accountId`, `categoryId`, `method`, `fiscalYear`); Antwort `booked`/`remaining` |
| GET /finance/ets-definitions                  | Versionierte Positionen und zeitliche Schwellenregeln                                                                      |
| GET/POST /finance/categories/:id/ets-mappings | Unveränderliche Zuordnung mit `effectiveFrom` und `position`                                                               |
| GET /finance/reports/ets                      | D/E-Vorbereitung mit Vorjahresvergleich, Prüfungen und Definitionsversion                                                  |
| GET /finance/reports/ets/pdf und /csv         | Privater exportierter Bericht mit Warnungen                                                                                |

Geschäftsjahr anlegen: `startsOn` und `endsOn` optional, Standard Kalenderjahr; Jahreskennung bleibt eindeutig. Abschlussbody jetzt ausdrücklich `{ "confirm": true }`. Kassabuchfilter zusätzlich `from`, `to`, `project`; Buchungen zusätzlich `project`. Neue Dokumentkategorien `invoice`, `insurance`, `funding`; Dokumente unterstützen zusätzlich mandantengebundene `transferId` und `groupId`.

ETS-Abfrage: `fiscalYear`, `model=D|E`, `language=de|it`, `legalPersonality=yes|no|unknown`, optional ausdrücklich geprüfte `priorRevenueCents` als Ganzzahlstring. Fehlende Referenzdaten führen zum Prüfstatus, nicht zu einer Zertifizierung. Historische Nachbuchung ist ein kontrollierter Schreibvorgang, kein automatischer Seiteneffekt einer Leseabfrage oder Schema-Migration.

## Sprint 2.3 – Veranstaltungen und Anwesenheit

Alle Pfade unter `/api/v1`, authentifiziert und organisationsgebunden. `:id` bei `/events/:id` bezeichnet immer die konkrete Veranstaltungsinstanz. Admin/Vorstand verwalten alle Instanzen; Projektleitung nur selbst erstellte oder verantwortete Instanzen. Normale Benutzer sehen veröffentlichte/abgeschlossene, für Mitglieder oder öffentlich markierte Veranstaltungen und ausschließlich ihre eigenen Anmeldungen. Die Sichtbarkeit `public` stellt keinen anonymen Anmeldeendpunkt bereit.

| Methode / Pfad                                     | Zweck                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET/POST /event-categories                         | Bilinguale Kategorien lesen/anlegen                                                                           |
| POST /event-categories/initialize                  | Acht Startkategorien idempotent einrichten                                                                    |
| PATCH /event-categories/:id                        | Name/Aktivstatus mit Version ändern                                                                           |
| GET /event-people und /event-organizers            | Minimale autorisierte Personensuche bzw. Verantwortliche                                                      |
| GET/POST /events                                   | Instanzen filtern/paginieren bzw. anlegen                                                                     |
| GET/PATCH /events/:id                              | Details bzw. versionierte Einzelbearbeitung                                                                   |
| POST /events/:id/cancel                            | Begründete Absage, Anmeldungen atomar abmelden                                                                |
| GET/POST /event-series                             | Endliche RRULE-Serie lesen/anlegen                                                                            |
| PATCH /event-series/:id                            | Künftige Instanzen bearbeiten oder begründet absagen                                                          |
| GET/POST /events/:id/registrations                 | Eigene bzw. autorisierte Teilnehmerliste, Anmeldung                                                           |
| PATCH/DELETE /registrations/:id                    | Versionierter Statuswechsel bzw. Abmeldung                                                                    |
| GET /events/:id/attendance                         | Autorisierte Anwesenheitsliste                                                                                |
| GET /events/:id/attendance/prepare                 | Autorisierte minimale Offline-Projektion, sieben Tage nutzbar                                                 |
| PUT /events/:id/attendance/:registrationId         | Einzelne versionierte Operation                                                                               |
| GET /events/:id/attendance/:registrationId/history | Unveränderliche Änderungshistorie                                                                             |
| POST /attendance/sync                              | Jede Operation einzeln bestätigen, Konflikt oder Ablehnung zurückgeben                                        |
| GET /events/:id/attendance/export                  | Privates PDF/CSV (`format`, `language`)                                                                       |
| GET /events/calendar.ics                           | Gefilterter ICS-Export ohne Teilnehmerdaten                                                                   |
| /events/:eventId/documents                         | Vorhandene private Dokument-API einschließlich Versionen/Downloads, auf eine verantwortete Instanz beschränkt |

Allgemeine Schreiboperationen benötigen `Origin` und UUID-`Idempotency-Key`. Änderungen verwenden `version`; Absagen zusätzlich `reason`. Veranstaltungseingaben enthalten `titleI18n`, `descriptionI18n`, `categoryId`, `startLocal`, `endLocal`, `timezone` (Europe/Rome), `location`, optionale Koordinaten, `organizerId`, `project`, `status`, `visibility`, `registrationRequired`, `capacity`, `registrationDeadline` und `waitlistEnabled`. Zeitpunkte werden als ISO-Instant ausgegeben. Filter: `from`, `to`, `categoryId`, `status`, `project`, `search`, `mine`, `page`, `pageSize`.

Anmeldung: `{personId}` oder für Berechtigte `{guest:{firstName,lastName,email?}}`; ohne Person wird die verknüpfte eigene Identität verwendet. Gäste erzeugen keine Mitgliedschaft. Doppelanmeldungen liefern 409. Wartelistenstatus entsteht automatisch bei der Anmeldung; eine bestätigte Anmeldung wird nicht per PATCH auf die Warteliste zurückgestuft (`EVENT_WAITLIST_AUTOMATIC`). Atomare Kapazitätskontrolle und FIFO nach exaktem `(registered_at,id)` gelten auch bei Parallelität. `overrideDeadline` ist eine ausdrückliche Verwaltungsentscheidung. Nach Ablauf von Frist/Beginn erfolgt kein automatisches Nachrücken.

Sync-Body: `{operations:[{operationId,organizationId,eventOccurrenceId,registrationId,requestedStatus,expectedVersion,clientCreatedAt}]}`. Die Identität stammt ausschließlich aus der serverseitigen Session. Pro Operation enthält `results` den Status `applied`, `conflict` oder `rejected`, optional `code` und den autorisierten aktuellen Datensatz sowie `replayed`. Statuswerte sind `unrecorded|present|absent|excused`. Erfolgreiche Wiederholungen derselben UUID/Inhalte erzeugen keine neue Version und keinen zweiten Audit-Eintrag. Konfliktauflösung benötigt eine neue UUID mit bewusst übernommener Serverversion. Ungültige Session: 401; verlorenes Recht: 403. Die gesamte Anfrage wird vor Verarbeitung gegen das strikte Schema geprüft; fachliche Fehler einzelner gültiger Operationen beeinflussen erfolgreiche Nachbaroperationen nicht.

RRULE: DAILY/WEEKLY/MONTHLY, benutzerdefiniertes INTERVAL und unterstützte BY-Felder, zwingend COUNT oder UNTIL, maximal 366 Instanzen/732 Tage. Serienänderungen schützen Vergangenheit, abgeschlossene Termine und Einzel-Ausnahmen. Strukturelle Änderung mit aktiven Anmeldungen: `EVENT_SERIES_HAS_REGISTRATIONS` (409). Die explizite Serienabsage schließt verschobene künftige Instanzen ein.

## Freiwillige, Versicherungen, Register und Compliance (Sprint 2.4)

Alle Schreibvorgänge benötigen `Origin` und UUID-`Idempotency-Key`; Änderungen verwenden `version`. Antworten wiederholter Schlüssel werden frisch gelesen (`Idempotency-Replayed: true`).

| Methode / Pfad                                                            | Zweck                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET /volunteers/overview                                                  | Kennzahlen; Versicherungs-, Register- und Fristwerte nur mit passendem Recht               |
| GET/POST /volunteers                                                      | Liste ohne Registerdaten (Filter Art, Status, Zuordnungsstatus) bzw. Registrierung         |
| GET/PATCH /volunteers/:id                                                 | Detail mit Historie, Veranstaltungen, Zuordnungsprüfung; Registerdaten nur für Berechtigte |
| POST /volunteers/:id/end                                                  | Austritt mit Datum und Grund                                                               |
| GET /volunteer-people                                                     | Vorhandene Personen (Mitglied/Gast) für die Registrierung                                  |
| GET/POST /volunteer-assignments, PATCH /:id                               | Einsätze planen, ändern, abschließen, absagen                                              |
| POST /volunteer-assignments/:id/attendance-draft                          | Unbestätigter Stundenentwurf aus Anwesenheit „anwesend“                                    |
| GET/POST /volunteer-time-entries, GET /:id                                | Zeiten mit Summen (`totals.confirmedMinutes`) bzw. Erfassung                               |
| POST /volunteer-time-entries/:id/correction                               | Korrektur mit Pflichtgrund; bestätigte Einträge benötigen erneute Bestätigung              |
| POST /volunteer-time-entries/:id/decision                                 | `submit`, `confirm`, `reject`                                                              |
| GET /volunteer-time-entries/export                                        | CSV/PDF (`format`, `language`, Filter)                                                     |
| GET/POST /insurance-policies, GET/PATCH /:id                              | Policen                                                                                    |
| GET/POST /insurance-policies/:id/coverages                                | Zuordnungen von Personen und Zeiträumen                                                    |
| POST /insurance-coverages/:id/end                                         | Zuordnung begründet beenden                                                                |
| GET /insurance-coverage                                                   | Zuordnungsprüfung je Person (`date`), Lücken, auslaufende Policen                          |
| GET /insurance-policies/:id/notification-list                             | Meldeliste JSON/CSV/PDF mit SHA-256                                                        |
| GET /insurance-policies/:id/notifications, POST /insurer-notifications    | Meldungen dokumentieren; Nachweise über `/documents` mit `insurerNotificationId`           |
| GET/PATCH /volunteer-register/settings                                    | Sektion, Signaturintervall/-verfahren, Aufbewahrung, rechtliche Freigabe (Admin)           |
| GET /volunteer-register?section=main\|occasional                          | Laufender Stand, chronologische Einträge, ausstehende Vorgänge                             |
| GET /volunteer-register/verify                                            | Hash-Kette beider Sektionen neu berechnen                                                  |
| POST /volunteer-register/entries                                          | `admission`, `exit`, `correction` (mit `correctsEntryId` und `reason`)                     |
| GET /register-snapshots, GET /register-snapshots/validation               | Stände bzw. Prüfung eines Stichtags                                                        |
| POST /register-snapshots                                                  | Stand festschreiben (Status `signature_pending`)                                           |
| GET /register-snapshots/:id/integrity                                     | Reproduktion und Dateiintegrität prüfen                                                    |
| GET /register-snapshots/:id/files/:kind                                   | `snapshot`, `signed`, `timestamp` (privat)                                                 |
| POST /register-snapshots/:id/signature-files                              | Rohdatei; Metadaten `{"kind":"signed\|timestamp","filename"}` in `X-Document-Metadata`     |
| POST /register-snapshots/:id/verification                                 | Externes Prüfergebnis dokumentieren                                                        |
| GET/POST /compliance-rules, PATCH /:id, POST /compliance-rules/initialize | Versionierte Regeln, Aktivierung, Startregeln                                              |
| GET/POST /compliance-deadlines, PATCH /:id                                | Fristen, Status, Zuständigkeit, Verschiebung mit Begründung                                |
| POST /compliance-deadlines/generate                                       | Fristen für einen Zeitraum berechnen (idempotent)                                          |
| POST /compliance-deadlines/:id/evidence, /complete                        | Nachweis hinterlegen bzw. mit Datum und Protokollnummer abschließen                        |

Fehlercodes u. a.: `VOLUNTEER_EXISTS`, `ASSIGNMENT_OVERLAP`, `TIME_OVERLAP`, `TIME_SELF_CONFIRM`, `ATTENDANCE_NOT_PRESENT`, `REGISTER_DATA_INCOMPLETE`, `REGISTER_NOT_READY`, `SIGNATURE_MISSING`, `COVERAGE_OUTSIDE_POLICY`, `EVIDENCE_REQUIRED`, `OVERLAP` (Datenbanksperre gegen Überschneidung).
