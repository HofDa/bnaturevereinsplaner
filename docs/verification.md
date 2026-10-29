# Prüfnachweise

Stand: 29.10.2026. Alle Angaben beziehen sich auf den lokal implementierten Phase-1-Stand. Eine Veröffentlichung auf einem öffentlichen Server oder Zertifizierung ist damit nicht verbunden.

| Prüfung                | Ergebnis                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun                    | 1.3.14, direkte Paketversionen und Lockfile gepinnt                                                                                                                              |
| TypeScript Strict Mode | bestanden                                                                                                                                                                        |
| ESLint                 | bestanden                                                                                                                                                                        |
| Prettier               | bestanden                                                                                                                                                                        |
| Unit-/UI-Tests         | **33 bestanden**                                                                                                                                                                 |
| PostgreSQL-Integration | **29 bestanden**, echte PostgreSQL-17-Datenbank und Better-Auth-Sessions                                                                                                         |
| Playwright Desktop     | **5 bestanden**, Produktionsbuild in Chrome                                                                                                                                      |
| Playwright Mobilformat | **5 bestanden**, Chromium mit iPhone-13-Viewport und Touch-Emulation                                                                                                             |
| Produktionsbuild       | Web-PWA und Node-kompatibles API-Bundle bestanden                                                                                                                                |
| Migrationen            | initiales Schema angewendet; erneute Generierung ohne Schemaänderung                                                                                                             |
| OpenAPI                | aus den registrierten Routen generiert                                                                                                                                           |
| Node-Runtime           | Health mit Datenbank, anonymer Zugriffsschutz und No-Store-Header bestanden                                                                                                      |
| Docker                 | API-/Migrations-/Web-Images gebaut; API-Container gegen PostgreSQL erfolgreich geprüft                                                                                           |
| Caddy                  | Konfiguration im Container erfolgreich validiert                                                                                                                                 |
| Paket-Audit            | keine mittleren/hohen/kritischen Hinweise nach esbuild-Override; **ein niedriger Build-Hinweis bleibt offen**, siehe [Sicherheit](security.md#abhängigkeitsprüfung-vom-29102026) |

## Inhalt der Tests

Geschäftslogik: Trennung von Person/Mitgliedschaft, Status-/Datumsregeln, Pflichtfelder, unbekannte Felder, Rollenmatrix, Pagination-Grenzen und literal behandelte Suchwildcards. Ein eigener Regressionstest verhindert, dass PATCH-Defaults ungesendete Werte löschen. UI-Tests prüfen erforderliche Daten, Austrittsdatum, Metadatenfreiheit beim Bearbeiten und die Theme-Auswahl.

CSV: BOM, Komma-/Semikolon, Quotes, doppelte Quotes, mehrzeilige Felder, fehlerhafte Zeilen, doppelte Nummern, Zeilenlimit, Roundtrip und Tabellenformel-Neutralisierung. Der Browserablauf prüft Vorschau mit gültiger/ungültiger Zeile und tatsächliches Speichern ausschließlich der bestätigten gültigen Zeile.

Datenbank: Anonyme Requests, echte Anmeldung, Passwort-Hash statt Klartext, Cookieattribute einschließlich Secure in Produktion, gesperrte Registrierung, falsche Origins, Bootstrap-Wiederholung, fremde Organisationskontexte, fremde Mitglieds-IDs bei Lesen und Schreiben, Datenbank-FKs über Organisationsgrenzen, Vorstands-/Gruppen-/Personenbeziehungen, Audit-Filter, Rollenrechte und Schutz des letzten Administrators. Duplicate-Insert und ungültige Statusänderung verändern keinen unvollständigen Datensatz. Mehrfache Anmeldefehler erreichen ein aktives Rate-Limit.

Browser: Anmeldung, Anlage/Bearbeitung/Suche eines Mitglieds, CSV-Download, Gruppenanlage und Zuordnung, Amtszeit, persistiertes Vereinsprofil, DE/IT, Hell/Dunkel, Abmeldung und Cache-Leerung auch im zweiten Tab. Der Service Worker wird tatsächlich registriert und kontrolliert die Seite; der Test prüft Cache-Inhalte und Wiederöffnung der statischen App-Shell ohne Netz, dann Online-Wiederherstellung. Es werden keine API-Antworten gecacht.

Axe prüft Dashboard, Mitgliederliste, Mitgliederdialog und Einstellungen einschließlich dunkler Darstellung und italienischer Sprache gegen WCAG-2-/2.1-/2.2-A/AA-Regeln. Die geprüften Ansichten haben dabei keine gemeldeten Verstöße. Das ist keine vollständige manuelle WCAG-Konformitätsbewertung.

Desktop- und Mobilprojekt starten getrennte API-Prozesse. Die Rate-Limits bleiben in beiden Projekten aktiv; die Anfragen der beiden synthetischen Nutzungsreihen werden dadurch nicht auf dieselbe IP-Zählung addiert. Datenbanktests und Browsertests werden nacheinander gegen die geschützte Testdatenbank ausgeführt.

## Grenzen

- Mobile Emulation ist kein Test auf einem echten iPhone oder in WebKit. Native Installation, reale iOS-Tastatur und VoiceOver/TalkBack sind zusätzlich zu prüfen.
- Keine öffentliche TLS-/DNS-Auslieferung, Backup-Wiederherstellung, Lastprüfung oder externe Sicherheitsprüfung durchgeführt.
- Ein niedriger transitiver Build-Hinweis ohne veröffentlichte Korrektur ist offen und wird nicht unterdrückt.
- Automatische Prüfungen belegen konkrete getestete Abläufe und Grenzen, keine allgemeine Fehlerfreiheit oder rechtliche Zertifizierung.

Reproduzierbare Befehle und Konfiguration stehen in der [Startanleitung](../README.md). Die GitHub-Actions-Konfiguration enthält Typecheck, Lint, Format, Unit/UI, PostgreSQL-Integration, Build, Spec-Drift-Prüfung, Node-Smoke und beide Browserprojekte. Ein GitHub-Actions-Lauf kann erst nach Bereitstellung des Repositorys auf GitHub stattfinden.
