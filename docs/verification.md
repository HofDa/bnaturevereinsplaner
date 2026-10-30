# Prüfnachweise

Stand: 30.10.2026 (Sprint 2.3). Alle Angaben beziehen sich auf den lokal implementierten Stand von Phase 1 und Sprints 2.1–2.3. Eine Veröffentlichung auf einem öffentlichen Server oder Zertifizierung ist damit nicht verbunden.

| Prüfung                | Ergebnis                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun                    | 1.3.14, direkte Paketversionen und Lockfile gepinnt                                                                                                                              |
| TypeScript Strict Mode | bestanden                                                                                                                                                                        |
| ESLint                 | bestanden                                                                                                                                                                        |
| Prettier               | bestanden                                                                                                                                                                        |
| Unit-/UI-Tests         | **74 bestanden**                                                                                                                                                                 |
| PostgreSQL-Integration | **116 bestanden**, echte PostgreSQL-17-Datenbank und Better-Auth-Sessions, inklusive Upgrade-Test der Migration                                                                  |
| Playwright Desktop     | **16 bestanden** (5 Plattform, 2 Beiträge, 2 Kassabuch, 2 Dokumente, 1 Sprint-2.2-Ablauf, 4 Veranstaltungen/Offline), Produktionsbuild in Chrome                                 |
| Playwright Mobilformat | **16 bestanden** (5 Plattform, 2 Beiträge, 2 Kassabuch, 2 Dokumente, 1 Sprint-2.2-Ablauf, 4 Veranstaltungen/Offline), Chromium mit iPhone-13-Viewport und Touch-Emulation        |
| Produktionsbuild       | Web-PWA und Node-kompatibles API-Bundle bestanden                                                                                                                                |
| Migrationen            | `0000`–`0010` angewendet; Upgrade mit Phase-1-Daten und geschlossenem Kassabuch geprüft; erneute Generierung ohne Schemaänderung                                                 |
| OpenAPI                | aus den registrierten Routen generiert                                                                                                                                           |
| Node-Runtime           | Health mit Datenbank, anonymer Zugriffsschutz und No-Store-Header bestanden                                                                                                      |
| Docker                 | Vorheriger Nachweis vor dieser Erweiterung: Images und Dokumentvolume geprüft; Container-Images in diesem Durchlauf nicht erneut gebaut                                          |
| Caddy                  | Vorheriger Nachweis: unveränderte Konfiguration im Container erfolgreich validiert                                                                                               |
| Paket-Audit            | keine mittleren/hohen/kritischen Hinweise nach esbuild-Override; **ein niedriger Build-Hinweis bleibt offen**, siehe [Sicherheit](security.md#abhängigkeitsprüfung-vom-29102026) |

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

## Offene Release-Gates

Vor einer Produktivfreigabe der Sprints 2.2–2.3 sind folgende Prüfungen offen und nicht durch die automatisierten Tests abgedeckt:

- [ ] **PWA auf echtem iPhone:** installierte PWA in Safari/iOS im Flugmodus (Vorbereitung, Offline-Check-ins, Neustart, Wiederverbindung, Konflikte, Logout-Bereinigung). Chromium mit iPhone-Viewport ersetzt diese Geräteabnahme nicht.
- [ ] **Migrationen an Produktionsdatenkopie:** `0004`–`0010` gegen eine aktuelle, gesicherte Kopie der Produktionsdaten ausführen und Bestände, geschlossene Jahre, Kategorienamen und Idempotenzantworten abgleichen. Keine Migration gegen Produktivdaten ohne Backup.
- [ ] **Fachliche Freigabe ETS:** Zuordnungen der Kategorien zu den ETS-Modellen D/E, Schwellenwerte und historische Referenzwerte durch die verantwortliche Person prüfen und freigeben (siehe [ETS-Berichte](ets-reporting.md)).
