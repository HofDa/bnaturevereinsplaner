# Prüfnachweise

## Chat: Antworten, Erwähnungen, Karten – 03.11.2026

Auf `feat/chat-extras`, gestapelt auf `feat/volunteer-self-reports`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt; erneute Migrationserzeugung meldet keine Schemaabweichung nach `0022_chat_extras`.
- Neue PostgreSQL-Integrationstests: Antworten nur im selben Kanal mit Vorschau, entfernte Originale; erwähnbare Konten je Kanal, Erwähnung gruppenfremder Konten abgewiesen, Hervorhebung nur für die erwähnte Person; Umfrage- und Veranstaltungskarten mit Zugangsprüfung, Gruppenumfrage nicht im Vereinskanal, Entwürfe abgewiesen, geschlossene Umfrage, Karte entfällt nach Entfernen der Nachricht.
- **6/6 Vereinsleben-Browserabläufe** und **4/4** `chat-poll` (Desktop und Mobil): Antwort mit @-Auswahl per Tastatur, Hervorhebung beim Erwähnten, Veranstaltungskarte mit Anmeldelink, Umfrage aus dem Chat mit Bestätigung, Veröffentlichung und Karte, E-Mail-Zusammenfassung im Profil (aus dem Chatablauf verschoben), Axe.
- Hinweis: Zwei Browsersitzungen vom selben Rechner erreichten im verlängerten Chatablauf die globale API-Grenze von 150 Anfragen je Minute und IP. Für Nutzer hinter einer gemeinsamen IP (z. B. Vereinsheim-WLAN) sollte die Grenze vor dem Rollout geprüft werden.
- Kein Push, PR oder Deployment.

## Auswertungen – 03.11.2026

Auf `feat/volunteer-self-reports`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt. Keine Migration.
- Neue PostgreSQL-Integrationstests: zwölf Monate, Eintritte stimmen mit der Datenbank überein, ungültiges Jahr 422, Mitglied 403; die Summe der Freiwilligenstunden entspricht exakt den bestätigten Minuten des Jahres.
- **2/2 Browserabläufe** `reports` (Desktop und Mobil): Diagramme, Legende, Hover-Tooltip, Tabellenansicht, Axe in hellem und dunklem Design, keine horizontale Verschiebung; Mitglied ohne Menüpunkt und mit 403.
- Diagrammfarben (Blau/Orange) mit dem Paletten-Validator für beide Oberflächen geprüft (Farbsehschwäche-Abstand ≥ 24, Kontrast ≥ 3:1).
- Kein Push, PR oder Deployment.

## Selbstansicht für Freiwillige – 03.11.2026

Auf `feat/volunteer-self-reports`, gestapelt auf `feat/reminders`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt. Keine Migration.
- Neuer PostgreSQL-Integrationstest: ohne verknüpfte Person leere Ansicht; nur die eigene Tätigkeit sichtbar; eigene Stunden werden als „eingereicht“ mit korrekten Minuten angelegt; Überschneidung, Zukunftszeit, fremde Tätigkeit und Konto ohne Verknüpfung abgewiesen; nach Bestätigung durch Admin steigen die bestätigten Jahresstunden.
- **2/2 Browserabläufe** `volunteer-self` (Desktop und Mobil, eigene Suite wegen der Anmeldegrenze): Konto mit verknüpfter Person meldet Stunden im Profil, Status „Eingereicht“, Axe; Vereinsverwaltung bleibt gesperrt.
- Kein Push, PR oder Deployment.

## Automatische Frist- und Rückgabeerinnerungen – 03.11.2026

Auf `feat/reminders`, gestapelt auf `feat/member-consents`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt; erneute Migrationserzeugung meldet keine Schemaabweichung nach `0021_automatic_reminders`.
- Neue PostgreSQL-Integrationstests: Aktivierung nur durch Admin; Fristerinnerungen an zuständige Person, Rolle oder Admins in deren Sprache, nur an Erinnerungstagen und einmal je Tag, keine für erledigte Fristen; Revalidierung bei verschobener oder erledigter Frist; Rückgabeerinnerungen zwei Tage vorher und bei Überfälligkeit, keine nach Rückgabe, Abbruch beim Versand nach zwischenzeitlicher Rückgabe; Stopp, wenn das aktivierende Konto kein Admin mehr ist; Erinnerungstage.
- **4/4 E-Mail-Browserabläufe** (Desktop und Mobil) mit den zusätzlichen Schaltern; der Test wählt das Kontrollkästchen jetzt über seine Bezeichnung.
- Kein Push, PR oder Deployment; Migration nicht auf Produktionsdaten angewendet.

## Zusatzfelder, Einwilligungen und Erziehungsberechtigte – 03.11.2026

Auf `feat/member-consents`, gestapelt auf `feat/fee-batch`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt; erneute Migrationserzeugung meldet keine Schemaabweichung nach `0020_member_extras`.
- Neue PostgreSQL-Integrationstests: Felddefinitionen mit Typ- und Optionsprüfung, Werte je Typ inklusive Leeren, deaktivierte Felder, unveränderliche Feldart; Einwilligungen als Verlauf mit aktuellem Stand, Zukunftsdatum abgewiesen, Änderungen und Löschungen in PostgreSQL blockiert; Erziehungsberechtigte anlegen, teilweise ändern (ohne Überschreiben anderer Angaben), löschen; Mandantengrenzen und Rechte (Mitglied 403, Kassier nur lesend).
- **2/2 Browserabläufe** `member-extras` (Desktop und Mobil): Feld definieren, Minderjährigen-Hinweis, erziehungsberechtigte Person, Fotoeinwilligung mit vorbelegter erklärender Person und Widerruf mit Verlauf, Zusatzwert setzen, Axe und keine horizontale Verschiebung.
- Build: Workbox-Grenze für vorab gespeicherte Dateien auf 3 MiB angehoben, weil das einzelne App-Bundle mit dem Entwicklungs-React der Browsertests 2,1 MB erreicht. Aufteilung in nachgeladene Teile ist als Folgeaufgabe offen.
- Kein Push, PR oder Deployment; Migration nicht auf Produktionsdaten angewendet.

## Sammelvorschreibung – 03.11.2026

Auf `feat/fee-batch`, gestapelt auf `feat/unread-birthdays`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt. Keine Migration.
- Neue PostgreSQL-Integrationstests: Vorschau mit übersprungenen bestehenden Forderungen, Fremdmandanten und Summe; gleichzeitige Bestätigung mit demselben `Idempotency-Key` erzeugt die Forderungen genau einmal; veraltete Vorschau (`PREVIEW_STALE`) legt nichts an; leere Vorschau (`NOTHING_TO_CREATE`); Tarifkategorie, deaktivierter Tarif, fremder Tarif und Rechte (Mitglied und Vorstand 403).
- **4/4 Finanz-Browserabläufe** (Desktop und Mobil): Kassier erstellt eine Sammelvorschreibung über Vorschau und Bestätigung, erneute Vorschau meldet keine neuen Forderungen, Axe-Prüfung mit Vorschau.
- Kein Push, PR oder Deployment.

## Ungelesen, E-Mail-Zusammenfassung, Geburtstage und Jubiläen – 03.11.2026

Auf `feat/unread-birthdays`, gestapelt auf `feat/chat-emoji`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt; erneute Migrationserzeugung meldet keine Schemaabweichung nach `0019_community_unread_digest`.
- **100/100 Unit-/UI-Tests** (neu: Geburtstage im Zeitfenster, Jahreswechsel, 29. Februar, Jubiläumsstufen) und **177/177 PostgreSQL-Integrationstests** bestanden. Neu geprüft: Zählung je Kanal mit Gruppenzugehörigkeit, ohne Entwürfe, eigene und entfernte Nachrichten; Lesemarken nur vorwärts, begrenzt auf die Serverzeit und mit den millisekundengenauen API-Zeitstempeln; Mandanten- und Gruppengrenzen; Zusammenfassungseinstellung je Konto; genau eine Zusammenfassung je fälligem Tag, keine leere Zusammenfassung, Revalidierung vor dem Versand; Geburtstage nur eigener aktiver Mitglieder in Vereinszeit, Zugriff nur mit `members:read`.
- **6/6 Vereinsleben-Browserabläufe** (Desktop und Mobil) einschließlich Ungelesen-Zahl in Navigation und Chatreiter, Rücksetzen beim Öffnen des Kanals, Zusammenfassungseinstellung im Profil mit Neuladen, Geburtstagskarte mit vorbereitetem Glückwunsch im Chat und Axe-Prüfungen. **4/4 E-Mail-Browserabläufe** nach der Workeränderung erneut bestanden. Web-Produktionsbundle gebaut.
- Nicht geprüft: tatsächlicher Versand einer Zusammenfassung über SMTP in einer Browsersuite (die Erzeugung ist per Integrationstest abgedeckt) und das App-Symbol-Badge auf echten iOS-/Android-Geräten.
- Kein Push, PR oder Deployment; Migration nicht auf Produktionsdaten angewendet.

## Chat-Emojis und Reaktionen – 03.11.2026

Auf `feat/chat-emoji`, Basis `a7cbf82`:

- Typecheck, ESLint und Prettier bestanden; OpenAPI neu erzeugt; erneute Migrationserzeugung meldet keine Schemaabweichung nach `0018_chat_reactions`.
- **96/96 Unit-/UI-Tests** und **171/171 PostgreSQL-Integrationstests** bestanden. Der neue Integrationstest prüft eine Reaktion je Konto und Emoji, gleichzeitige Wiederholung mit demselben `Idempotency-Key`, Setzen/Zurücknehmen ohne Umschalten, die Emoji-Auswahl in API und Datenbank, Gruppen- und Mandantengrenzen sowie das Entfernen aller Reaktionen beim Moderieren mit Datenbanksperre für neue Reaktionen.
- **6/6 Vereinsleben-Browserabläufe** (drei Desktop, drei Mobil) einschließlich Emoji-Auswahl, Einfügen an der Cursorposition, Escape, Reaktion setzen/zurücknehmen und Axe-Prüfung mit geöffneter Reaktion. Auf Mobil liegt die Auswahl sichtbar über der unteren Navigation. Web-Produktionsbundle gebaut. Andere Browsersuiten wurden nicht erneut ausgeführt.
- Kein Push, PR oder Deployment; Migration nicht auf Produktionsdaten angewendet.

## Zusammenführung auf master – 31.10.2026

Inventar (`d26034f`) und Vereinsleben/E-Mail (`e88ad40`) sind gemeinsam integriert. Navigation, API-Registrierung, Verträge und Rollen behalten beide Funktionsbereiche. Die kollidierenden Migrationen sind als Inventar `0013`, Mail `0014`, News/Umfragen `0015` und Chat `0016` eingeordnet. Die ursprünglichen SQL-Inhalte und Zeitstempel bleiben erhalten; `0017_merge_reconciliation` ergänzt fehlende Module bei bereits migrierten Datenbanken aus beiden Branches. Die Snapshots bilden eine gemeinsame Kette; erneute Migrationserzeugung meldet keine Schemaabweichung.

- Typecheck, ESLint und Prettier bestanden; OpenAPI für beide Module neu erzeugt.
- **96/96 Unit-/UI-Tests** und **170/170 PostgreSQL-Integrationstests** bestanden.
- Zwei neue Upgrade-Tests starten mit der jeweiligen Branch-Historie und prüfen erhaltene Inventardaten beziehungsweise News, Chat und Newsletter-Abmeldung sowie die gemeinsame Triggerinstallation und wiederholte Migration. Nach Ergänzung der Abmeldungsprüfung beide gezielt erneut bestanden. Der bestehende Phase-1-Upgrade-Test prüft zusätzlich die vollständige Migrationsfolge aus einem älteren Datenbestand.
- API-Produktionsbundle und Node-Smoke für Datenbank-Health, anonymen Zugriffsschutz und No-Store-Header bestanden.
- **14/14 gezielte Browserabläufe** für Inventar, Vereinsleben und E-Mail auf Desktop und Mobil bestanden, einschließlich Axe-Prüfungen, DE/IT, Rollen, Ausleihe/Rückgabe, News, Umfragen, Gruppenchat/Moderation und lokalem SMTP. Dabei wurde das Web-Produktionsbundle für jede Suite gebaut. Die übrigen Browsersuiten wurden bei diesem Merge nicht erneut ausgeführt.

Keine Entwicklungsdatenbank zurückgesetzt oder migriert; kein Push oder Deployment.

## Inventar und Ausleihe – 31.10.2026

Auf `feat/inventory`, ausgehend von `8d65d35`, lokal in einem eigenen Worktree mit eigener Testdatenbank (`bnature_test`, eigener Container) und eigenen Browser-Ports geprüft:

- Typecheck, ESLint und Prettier bestanden.
- Unit/UI: **93/93** in zehn Dateien, davon vier neue Inventartests (Defaults, Teil-Patches, Datumsregeln, Rollenmatrix).
- PostgreSQL-Integration: **155/155** in zehn Dateien, davon 14 neue Inventartests: Rollen und anonymer Zugriff, eindeutige Inventarnummern, Suche mit literalen Platzhaltern, Versionen, Sammelbestände bis zur verfügbaren Stückzahl, parallele Ausleihe des letzten Stücks (genau eine erfolgreich), Rückgabe mit Zustandsübernahme bei Einzelstücken, Rückgabedatum nicht vor Ausgabe und nicht in der Zukunft, Überfälligkeit in Vereinszeitzone, Verlängerung, Ausmustern nur ohne offene Ausleihen, Idempotenz-Replay und 409 bei abweichendem Inhalt, Mandantentrennung inklusive fremder Personen, datensparsame Personenauswahl, „Meine Ausleihen“, direkte SQL-Änderungen gegen die Trigger sowie CSV mit neutralisierten Formeln.
- Playwright: **44/44** (neun Suiten, 22 Desktop, 22 Mobil), darunter die neue Inventarsuite mit Anlage, Ausleihe, Überfälligkeit, Verlängerung, Rückgabe, Detailhistorie, CSV-Download, Ausmustern, DE/IT, Axe auf allen Ansichten und Rollengrenzen. Axe fand während der Entwicklung eine unzulässige `dl`-Struktur und einen nicht fokussierbaren Scrollbereich auf Mobil; beides ist behoben.
- Produktionsbuild und Node-Smoke bestanden; Migrationserzeugung ohne Schemaabweichung; OpenAPI erneut erzeugt und hashgleich.
- Die Browser-Ports sind über `E2E_WEB_PORT`/`E2E_API_PORT` überschreibbar (Standard unverändert 5174/3002), damit parallele Worktrees getrennt testen können.

Keine Migration gegen Entwicklungs- oder Produktivdaten, kein Push und keine Veröffentlichung. Die Migration heißt `0013_inventory`; parallel entstehende Erweiterungen verwenden ebenfalls die Nummer `0013` und müssen beim Zusammenführen neu nummeriert werden. Fachliche Beschreibung: [Inventar](inventory.md).

## Vereinsleben und E-Mail-Reparatur – 31.10.2026

Auf `feat/community-news-polls`, Basis `8d65d35`:

- Typecheck, ESLint und Prettier bestanden.
- **92/92 Unit-/UI-Tests** in zehn Dateien, davon drei neue Prüfungen für Veröffentlichungs-, Rollen- und Ergebnisregeln.
- **154/154 PostgreSQL-Integrationstests** in zehn Dateien. Neu sind zwölf News-/Umfrage-/Chat-Tests und eine zusätzliche Mail-Vertragsprüfung. Abgedeckt: Verein/Gruppen/Mandanten, Entwürfe, Veröffentlichung/Archiv, versionierte Änderungen, doppelte Requests, eine veränderbare Stimme je Konto, Ergebnisfreigabe, Frist/Abschluss, SQL-Sperren, Chatverlauf mit Cursor, Moderation und geleerte Nachrichtentexte sowie Status-/Einstellungs-/Postausgangsfelder des erweiterten Mailvertrags.
- Bestehender lokaler Adminzugang, Dashboard, E-Mail-Seite und der neue Vereinsbereich mit Chat unter `localhost:5173` im Browser geprüft; keine JavaScript-Fehler. Entwicklungsdaten wurden nicht zurückgesetzt.
- Migrationen bis `0015` lokal angewendet. Erneute Migrationserzeugung meldet keine Schemaänderung. OpenAPI regeneriert und bei erneuter Erzeugung hashgleich.
- API-Bundle gebaut; Node-Smoke für Datenbank-Health, anonymen Zugriffsschutz und No-Store-Header bestanden.
- **6/6 Vereinsleben-Browserabläufe** (drei Desktop, drei Mobil): Newsentwurf mit separater Veröffentlichung, DE/IT, reine Textdarstellung statt HTML-Ausführung, Mitgliederansicht, Stimmabgabe und Stimmänderung, Abschluss/Ergebnisse, private Gruppennews, Chat mit zwei bewusst gleichen Nachrichten, Moderation und verweigerter Zugriff gruppenfremder Konten. Axe-Prüfungen auf Redaktion, News, Abstimmung und Chat bestanden. Die bisherigen Plattform-/Finanz-/Dokument-/Veranstaltungs-/Freiwilligen-Browsersuiten wurden in diesem Durchlauf nicht erneut ausgeführt.
- **4/4 E-Mail-Browserabläufe** (zwei Desktop, zwei Mobil) nach der Cachekorrektur bestanden, einschließlich echtem lokalem SMTP, Postausgang, erneut geöffneten Einstellungen und Sprachumschaltung. Insgesamt zehn gezielte Browserabläufe erfolgreich.

Ein erster mobiler Chatlauf fand zusammengedrückte Nachrichten und einen dadurch verdeckten Moderationsknopf. Chatkarten schrumpfen jetzt nicht mehr im Scrollbereich; Scrollabstände halten Aktionen von der fixierten Navigation fern. Der gezielte mobile Wiederholungslauf bestand vollständig.

Ein erster E-Mail-Browserlauf zeigte beim schnellen Wiederöffnen des Einstellungsdialogs einen alten Eingabewert trotz erfolgreicher Speicherung. Die Mutation übernimmt jetzt die gespeicherte Serverantwort direkt in den Query-Cache. Die begonnene Mail-Schemaerweiterung bleibt erhalten; nicht eingerichtete Mailarten werden ausdrücklich abgewiesen. Es wurden keine externen E-Mails verschickt.

Nutzung und Grenzen: [Vereinsleben](community.md), [E-Mail](mail.md). Ein Push, PR oder Deployment wurde in diesem Durchlauf nicht vorgenommen.

## Kommunikationserweiterung – 30.10.2026

Auf `feat/communication-email`, ausgehend von `786a035`, lokal geprüft:

- Typecheck und ESLint bestanden.
- Unit/UI: **89/89** in neun Dateien, davon vier neue Mailtests.
- PostgreSQL-Integration: **141/141** in neun Dateien, davon zehn neue Mailtests. Die dedizierte Datenbank `bnature_test` wurde verwendet; Entwicklungsdaten wurden nicht zurückgesetzt.
- Mail-Browsersuite: **4/4** (zwei Desktop, zwei Mobil). Beitragserinnerung und Termineinladung wurden über echtes SMTP an das lokale Mailpit übergeben, einschließlich DE/IT, Empfängervorschau, Postausgang, funktionierendem Veranstaltungslink, gespeicherten Einstellungen und verweigertem Mitgliederzugriff. Axe-Prüfungen auf Vorschau und Postausgang bestanden. Vollständiger Browserlauf vor dem Commit: **40/40** (alle acht Suiten, 20 Desktop, 20 Mobil). Ein vorheriger Gesamtlauf brach einmal in `volunteers / desktop` ab, weil der Hauptbereich von `/volunteers/register` nach der Navigation leer blieb. Gezielte Wiederholung und erneuter Gesamtlauf bestanden ohne Codeänderung; die Ursache ist nicht geklärt und wird als möglicher Flake beobachtet.
- Ein erster Mobilversuch fand fehlenden Tastaturzugriff auf die scrollbare Empfängerliste. Nach Ergänzung von Fokus und Regionsbeschriftung bestand der erneute Lauf auf beiden Formaten.
- Bestehender lokaler Adminzugang, Dashboard, Datenbank-Health und neue Mail-Seite unter `localhost:5173` im Browser erfolgreich geprüft, ohne JavaScript-Fehler.
- Paketprüfung `bun audit --audit-level=moderate` erfolgreich.
- Formatprüfung und Produktionsbuild bestanden; OpenAPI erneut erzeugt und hashgleich, Migrationserzeugung ohne Schemaabweichung. Node-Runtime-Smoke mit Datenbank-Health, anonymem Zugriffsschutz und No-Store-Headern bestanden. Das Startlimit wurde nach einem Timeout beim kalten Node-Start von fünf auf 30 Sekunden erhöht; der separat gestartete Node-Server beantwortete die Health-Prüfung ebenfalls erfolgreich.

Lokales Testpostfach: `localhost:8025`. Kein externer E-Mail-Versand, kein Push und keine Veröffentlichung im Rahmen dieser Erweiterung. Automatische Beitragserinnerungen bleiben im Entwicklungsverein ausgeschaltet. Einrichtung, Betrieb und bekannte Grenzen: [E-Mail](mail.md).

## Nachweise bis Sprint 2.4

Stand: 30.10.2026 (Sprint 2.4). Alle Angaben beziehen sich auf den lokal implementierten Stand von Phase 1 und Sprints 2.1–2.4 auf `feat/sprint-2.4`. Damit ist weder eine Veröffentlichung auf einem öffentlichen Server noch eine Zertifizierung verbunden.

| Prüfung                | Ergebnis                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun                    | 1.3.14, direkte Paketversionen und Lockfile gepinnt                                                                                                                                                                                     |
| TypeScript Strict Mode | bestanden                                                                                                                                                                                                                               |
| ESLint                 | bestanden                                                                                                                                                                                                                               |
| Prettier               | bestanden                                                                                                                                                                                                                               |
| Unit-/UI-Tests         | **85 bestanden** (8 Dateien; +11 Freiwillige/Compliance)                                                                                                                                                                                |
| PostgreSQL-Integration | **131 bestanden** (8 Dateien: API 29, Finanzen 37, Kassabuch 15, Sprint 2.2 10, Dokumente 8, Veranstaltungen 16, Freiwillige 15, Migration-Upgrade 1), echte PostgreSQL-17-Datenbank und Better-Auth-Sessions                           |
| Playwright Desktop     | **18 bestanden** (5 Plattform, 2 Beiträge, 2 Kassabuch, 2 Dokumente, 1 Sprint-2.2-Ablauf, 4 Veranstaltungen/Offline, 2 Freiwillige/Compliance), Produktionsbuild in Chrome                                                              |
| Playwright Mobilformat | **18 bestanden** (gleiche Aufteilung), Chromium mit iPhone-13-Viewport und Touch-Emulation                                                                                                                                              |
| Produktionsbuild       | Web-PWA und Node-kompatibles API-Bundle bestanden; Web-Chunk 1.576,7 kB minifiziert / 458,3 kB gzip mit Größenwarnung, Maßnahmen als [PERF-Tickets](sprints/tickets.md#performance--bundle-aufteilung-geplant-nicht-teil-von-sprint-24) |
| Migrationen            | `0000`–`0011` angewendet; Upgrade mit Phase-1-Daten und geschlossenem Kassabuch geprüft; erneute Generierung meldet keine Schemaänderung                                                                                                |
| OpenAPI                | aus den registrierten Routen generiert; erneute Erzeugung deterministisch                                                                                                                                                               |
| Node-Runtime           | Health mit Datenbank, anonymer Zugriffsschutz und No-Store-Header bestanden                                                                                                                                                             |
| Docker                 | Vorheriger Nachweis vor dieser Erweiterung: Images und Dokumentvolume geprüft; Container-Images in diesem Durchlauf nicht erneut gebaut                                                                                                 |
| Caddy                  | Vorheriger Nachweis: unveränderte Konfiguration im Container erfolgreich validiert                                                                                                                                                      |
| Paket-Audit            | keine mittleren/hohen/kritischen Hinweise nach esbuild-Override; **ein niedriger Build-Hinweis bleibt offen**, siehe [Sicherheit](security.md#abhängigkeitsprüfung-vom-29102026)                                                        |

## Inhalt der Tests

Geschäftslogik: Trennung von Person/Mitgliedschaft, Status-/Datumsregeln, Pflichtfelder, unbekannte Felder, Rollenmatrix, Pagination-Grenzen und literal behandelte Suchwildcards. Ein eigener Regressionstest verhindert, dass PATCH-Defaults ungesendete Werte löschen. UI-Tests prüfen erforderliche Daten, Austrittsdatum, Metadatenfreiheit beim Bearbeiten und die Theme-Auswahl.

CSV: BOM, Komma-/Semikolon, Quotes, doppelte Quotes, mehrzeilige Felder, fehlerhafte Zeilen, doppelte Nummern, Zeilenlimit, Roundtrip und Tabellenformel-Neutralisierung. Der Browserablauf prüft Vorschau mit gültiger/ungültiger Zeile und tatsächliches Speichern ausschließlich der bestätigten gültigen Zeile.

Datenbank: Anonyme Requests, echte Anmeldung, Passwort-Hash statt Klartext, Cookieattribute einschließlich Secure in Produktion, gesperrte Registrierung, falsche Origins, Bootstrap-Wiederholung, fremde Organisationskontexte, fremde Mitglieds-IDs bei Lesen und Schreiben, Datenbank-FKs über Organisationsgrenzen, Vorstands-/Gruppen-/Personenbeziehungen, Audit-Filter, Rollenrechte und Schutz des letzten Administrators. Duplicate-Insert und ungültige Statusänderung verändern keinen unvollständigen Datensatz. Mehrfache Anmeldefehler erreichen ein aktives Rate-Limit.

Browser: Anmeldung, Anlage/Bearbeitung/Suche eines Mitglieds, CSV-Download, Gruppenanlage und Zuordnung, Amtszeit, persistiertes Vereinsprofil, DE/IT, Hell/Dunkel, Abmeldung und Cache-Leerung auch im zweiten Tab. Der Service Worker wird tatsächlich registriert und kontrolliert die Seite; der Test prüft Cache-Inhalte und Wiederöffnung der statischen App-Shell ohne Netz, dann Online-Wiederherstellung. Es werden keine API-Antworten gecacht.

Finanzen: Cent-Parsing ohne Rundung, BigInt-Summen, Zahlungsstände, Überfälligkeit in der Organisationszeitzone und Rollenmatrix. Gegen PostgreSQL: Tarifversionen und Periodizitätssperre, Wiederholungssperre für Forderungen, begründete Anpassungen, Teil- und Mehrfachzuordnungen, Überzuordnung und unvollständige Zuordnung per Trigger, Unveränderlichkeit, Idempotenz-Replay und 409 bei abweichendem Inhalt, parallele Zahlungen ohne Überschreitung, Rücknahme ohne Teilbuchung, eindeutige Bankreferenz, fremde Organisationen und IDs inklusive PDF-Routen sowie Audit in derselben Transaktion. Ein Upgrade-Test migriert eine Datenbank mit Phase-1-Bestandsdaten auf `0001` und prüft deren Erhalt. Der Browserablauf legt Tarif und Forderungen an, erfasst Teil- und Vollzahlungen als Kassier, lädt echte PDFs und prüft, dass Vorstand und normale Mitglieder Finanzansichten weder sehen noch öffnen können.

Kassabuch (Sprint 2.2a): Gegen PostgreSQL werden Konten/Kategorien mit Versionen und Namenskonflikten, IBAN-Prüfung, einmalige Jahreseröffnung, negative Kassenbestände, Übertrag aus dem geschlossenen Vorjahr und Abweichungshinweis, fortlaufende Nummern bei parallelen Buchungen, Sperre für manuelle Beitragsbuchungen, Storno nur einmal, nicht vor dem Original und nicht für Stornos, Idempotenz-Replay paralleler Stornos, Verbuchung beim Erfassen und nachträglich, Rücknahme einer Zahlung mit ungültiger Verbuchung, Zahlungsstorno mit Wiederöffnung der Forderung und gleichzeitiger Gegenbuchung, Freigabe der Bankreferenz nach Storno, Abschluss nur durch Admin und nur bei geschlossenen Vorjahren, Ablehnung von Buchungen und Zahlungsstornos im geschlossenen Jahr ohne Teilzustand, Berichtssummen nach Klassifizierung, Vorlagenversionen mit Schwellenwert und Gültigkeitszeitraum, PDF-Bericht und Cross-Tenant-Zugriffe geprüft. Direkte SQL-Änderungen, -Löschungen und regelwidrige Einfügungen werden von den Triggern abgewiesen. Der Browserablauf richtet Konten, Kategorien und Jahr ein, bucht und storniert, verbucht und storniert eine Beitragszahlung, erstellt eine Vorlage, lädt CSV und PDF und schließt das Jahr ab; der Kassier sieht keinen Abschluss.

Dokumente (Sprint 2.2b): Gegen PostgreSQL und ein temporäres Speicherverzeichnis werden Signaturprüfung, getarnte, leere, fremdtypisierte und zu große Dateien, fehlerhafte Metadaten, SHA-256 und byte-genauer Download, Dateinamenbereinigung, Download-Header, Entfernen der Datei bei fehlgeschlagener Transaktion und bei parallelem Idempotenz-Replay, Versionen, Archivsperre, veraltete Versionen, Sichtbarkeit von Kassabuchbelegen nur mit Finanzrechten, Ablehnung für Mitglied, Projektleitung, anonyme Anfragen und fremde Organisationen, Versions-IDs anderer Dokumente sowie manipulierte Speicherdateien geprüft. Der Browserablauf lädt als Vorstand hoch, weist eine getarnte Datei ab, lädt eine neue Version, lädt v1 herunter, archiviert und prüft, dass keine API-Antworten im Service-Worker-Cache landen; im Kassabuch wird ein Beleg zur Buchung abgelegt.

Axe prüft Dashboard, Mitgliederliste, Mitgliederdialog, Einstellungen sowie Finanz-, Kassabuch-, Konten-, Berichts- und Dokumentansichten mit ihren Dialogen einschließlich dunkler Darstellung und italienischer Sprache gegen WCAG-2-/2.1-/2.2-A/AA-Regeln. Die geprüften Ansichten haben dabei keine gemeldeten Verstöße. Das ist keine vollständige manuelle WCAG-Konformitätsbewertung.

Desktop- und Mobilprojekt starten getrennte API-Prozesse. Die Rate-Limits bleiben in beiden Projekten aktiv; die Anfragen der beiden synthetischen Nutzungsreihen werden dadurch nicht auf dieselbe IP-Zählung addiert. Datenbanktests und Browsertests werden nacheinander gegen die geschützte Testdatenbank ausgeführt.

## Grenzen

- Mobile Emulation ist kein Test auf einem echten iPhone oder in WebKit. Native Installation, reale iOS-Tastatur und VoiceOver/TalkBack sind zusätzlich zu prüfen.
- Keine öffentliche TLS-/DNS-Auslieferung, Backup-Wiederherstellung, Lastprüfung oder externe Sicherheitsprüfung durchgeführt.
- Ein niedriger transitiver Build-Hinweis ohne veröffentlichte Korrektur ist offen und wird nicht unterdrückt.
- Automatische Prüfungen belegen konkrete getestete Abläufe und Grenzen, keine allgemeine Fehlerfreiheit oder rechtliche Zertifizierung.

Reproduzierbare Befehle und Konfiguration stehen in der [Startanleitung](../README.md). Die GitHub-Actions-Konfiguration enthält Typecheck, Lint, Format, Unit/UI, PostgreSQL-Integration, Build, Spec-Drift-Prüfung, Node-Smoke und beide Browserprojekte. Ein GitHub-Actions-Lauf kann erst nach Bereitstellung des Repositorys auf GitHub stattfinden.

## Sprint 2.2 – zusätzliche Abnahme

`tests/integration/sprint22.test.ts` ergänzt zehn transaktionale Abnahmetests: neutrale Überträge mit parallelem Idempotenz-Replay und exaktem Storno; positive/negative Kontobewegungen; Fremdkonten ohne Teilzustand; datumsbasierte Geschäftsjahre; automatische einmalige Beitragsverbuchung trotz zweier Teilzuordnungen; atomare Zahlungsstornos; kontrollierte historische Nachbuchung; ausdrücklich bestätigter Abschluss; unveränderliche Kategorie-/ETS-Snapshots; DE/IT-PDF/CSV; Berichtssummen und Anfangs-/Endbestände; Berechtigungen für Finanzdaten und private Übertragsbelege; Kontenvortrag und Vorjahresvergleich. Zwölf gleichzeitige Dashboard-Abfragen prüfen, dass sich die Snapshot-Transaktionen nicht an der Verbindungspool-Grenze blockieren.

Der erweiterte Upgrade-Test migriert über den früheren Stand `0003` mit einer bereits abgeschlossenen Jahresbuchung, zwischenzeitlich umbenannter Kategorie und gespeicherten Idempotenzantworten. Abschlussstatus, Betrag, rekonstruierbarer Kategoriename und Wiederholungsantworten bleiben erhalten; Schreibsperren bleiben aktiv.

`tests/e2e/sprint22.spec.ts` prüft auf Desktop und Mobil: Startkategorien/Konten, abweichendes Geschäftsjahr, Bank-Kasse-Übertrag, Projektbuchung im Folgekalenderjahr, Buchungshistorie, echte Bestände, Modell-E-Tabellenexport, italienischen PDF-Export, Layoutbreite und Axe-Prüfung. Die bisherigen vier Browser-Suiten bestehen ebenfalls. Reproduzierbar: `bun run test:e2e` oder gezielt `bun run test:e2e sprint22 ledger documents`.

Amtliche Quellen, zeitliche Schwellenregeln und notwendige fachliche Prüfung stehen in [ETS-Berichte](ets-reporting.md). Die Software erstellt eine prüfbare Vorbereitung. Fachliche Zuordnungen, historische Referenzwerte und die ergänzenden Erläuterungsberichte sind vor Verwendung als Vereinsabschluss verantwortlich zu prüfen. Eine produktive Migration/Veröffentlichung wurde nicht durchgeführt.

## Sprint 2.3

16 zusätzliche PostgreSQL-Integrationstests prüfen CRUD/Rollen/Mandanten, DST und endliche Serien samt Ausnahmen, unveränderte vergangene Instanzen, Metadatenänderung mit erhaltener Anmeldung, strukturelle Sperre bei aktiven Anmeldungen, begründete Serienabsage einschließlich verschobener Termine, Kategorieversionen, Gäste ohne Mitgliedschaft, Doppelanmeldung, konkurrierende letzte Plätze, exakte FIFO-Warteliste und automatisches/manuelles Nachrücken. Hinzu kommen mehrstufige Anwesenheit, Idempotenz mit einmaligem Audit, direkte SQL-Sperren, Teilbatch-Konflikte, Sessionablauf, Rechteentzug, private Veranstaltungsdokumente, PDF/CSV/ICS und unveränderte Finanzdaten bei Anmeldungen/Absagen.

Fünf zusätzliche Unit-Tests prüfen lokale Uhrzeiten über beide Zeitumstellungen, nicht existierende Uhrzeiten, Intervall-/Materialisierungsgrenzen, eingeschleuste Akteurfelder und UTF-8-ICS-Faltung. Vier neue Browserabläufe je Desktop/Mobilformat verwenden echte Datenbank, autorisierte Sessions und den Produktionsbuild: Kalender/Verwaltung/DE-IT/Exporte/Dokumente mit Axe; verschlüsselte Offline-Queue über Netzunterbrechung und Neuladen, abgelaufene Session und erneute Anmeldung, mehrere abhängige Änderungen, echter konkurrierender Serverstand, sichtbare manuelle Konfliktauflösung, Ablauf und Logout; Rechteentzug mit Bereinigung und verweigerter Übertragung; verzögert eintreffende Offline-Vorbereitung nach Logout ohne Wiederherstellung privater Daten.

Keine physische iOS-/Safari-Installation oder echter Flugmodus wurde in dieser Umgebung geprüft. Touch-/iPhone-Viewport läuft in Chromium und ersetzt diese Geräteabnahme nicht. Der Node-Starttest hat Datenbank-Health, anonymen Zugriffsschutz und No-Store-Header bestanden. Migrationserzeugung meldet nach `0010` keine Schemaabweichung.

## Sprint 2.4

Lauf vom 30.10.2026 auf `feat/sprint-2.4` (Basis `dd7988d`), gegen die dedizierte Testdatenbank `bnature_test` (Container `postgres-test`) und nacheinander ausgeführt:

| Prüfung                           | Ergebnis                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Typecheck, ESLint, Prettier       | bestanden                                                                                                                            |
| Unit/UI (`bun run test`)          | 85/85 in 8 Dateien                                                                                                                   |
| PostgreSQL (`test:integration`)   | 131/131 in 8 Dateien, davon 15 in `tests/integration/volunteers.test.ts`                                                             |
| Playwright (`test:e2e`, 7 Suiten) | 36/36: 18 Desktop, 18 Mobil; keine Wiederholungen (`retries` lokal 0), keine übersprungenen Tests                                    |
| Build, Node-Smoke                 | bestanden; Bundle-Warnung > 500 kB bleibt offen (PERF-01 bis PERF-06)                                                                |
| Migration/OpenAPI-Drift           | `db:generate` ohne Schemaänderung; OpenAPI regeneriert                                                                               |
| `git diff --check`, Artefakt-Scan | ohne Befund; keine Secrets, `.env`-Dateien, Dumps, Testartefakte oder echten Personendaten (Steuernummern in Tests sind synthetisch) |

Ein erster Playwright-Versuch brach vor dem ersten Test ab, weil der Testdatenbank-Container gestoppt war (`ECONNREFUSED 127.0.0.1:55440`). Nach `docker compose --profile test up -d --wait postgres-test` lief die gesamte Suite ohne Codeänderung durch.

Neu abgedeckt: Freiwillige regulär/gelegentlich mit Statushistorie, Einsätze und Stunden, Policen und Zuordnungsprüfung inkl. 24-Uhr-Regel, append-only Register mit Hash-Kette und SQL-Trigger-Sperren, Registerstände mit reproduzierbarem PDF und Integritätsprüfung, technische Prüfung importierter Signatur-/Zeitstempeldateien, Fristenregeln mit Versionen, Rollen- und Mandantentrennung, DE/IT und Axe im Browser. Die rechtlichen Grundlagen und ihr Prüfstand stehen in der [Validierungsgrundlage](legal/volunteer-register-validation.md). Die Tests belegen das technische Verhalten, **keine** rechtliche Konformität oder Zertifizierung.

## Offene Release-Gates

Vor einer Produktivfreigabe der Sprints 2.2–2.4 sind folgende Prüfungen offen und nicht durch die automatisierten Tests abgedeckt:

- [ ] **PWA auf echtem iPhone:** installierte PWA in Safari/iOS im Flugmodus (Vorbereitung, Offline-Check-ins, Neustart, Wiederverbindung, Konflikte, Logout-Bereinigung). Chromium mit iPhone-Viewport ersetzt diese Geräteabnahme nicht.
- [ ] **Migrationen an Produktionsdatenkopie:** `0004`–`0011` gegen eine aktuelle, gesicherte Kopie der Produktionsdaten ausführen und Bestände, geschlossene Jahre, Kategorienamen und Idempotenzantworten abgleichen. Keine Migration gegen Produktivdaten ohne Backup.
- [ ] **Fachliche Freigabe ETS:** Zuordnungen der Kategorien zu den ETS-Modellen D/E, Schwellenwerte und historische Referenzwerte durch die verantwortliche Person prüfen und freigeben (siehe [ETS-Berichte](ets-reporting.md)).
- [ ] **Rechtliche Freigabe Sprint 2.4:** Register- und Signaturverfahren, Startregeln des Fristenmanagers, Aufbewahrungs-/Löschfristen und Datenschutz durch fachkundige Person prüfen (offene Fragen in der [Validierungsgrundlage](legal/volunteer-register-validation.md#5-offene-rechtliche-fragen)).
- [ ] **Probelauf mit realem Signaturmittel:** Registerstand festschreiben, extern qualifiziert signieren und zeitstempeln, importieren und extern validieren.
- [ ] **Versicherer:** Format und Frist der Meldelisten mit der konkreten Versicherung abstimmen.
