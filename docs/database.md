# Datenbank

PostgreSQL 17, Drizzle ORM, UUID-Primärschlüssel und Zeitpunkte als `timestamptz` in UTC. Kalenderdaten (Geburt, Eintritt, Austritt, Mandat) sind bewusst `date`, keine UTC-Uhrzeiten. Änderungen werden über explizites `updated_at` und fachliche Audit-Einträge dokumentiert.

| Tabelle                                     | Verantwortung / Constraints                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organizations                               | Mandant; eindeutiger Slug, Vereinsform, Sprache, Zeitzone und Adresse                                                                                                                             |
| users / accounts / sessions / verifications | Better-Auth-Schema; UUIDs, eindeutige E-Mail und Sitzungstoken, Konten-/Benutzerindizes; Passwort-Hash gehört ausschließlich Better Auth                                                          |
| persons                                     | Person ohne Loginpflicht; `(organization_id,id)` eindeutig; Namens- und E-Mail-Indizes pro Organisation                                                                                           |
| memberships                                 | Projektion verbindet Person und Verein; Nummer und Person je Organisation eindeutig; Status-/Eintrittsindizes; zusammengesetzter FK zur Person                                                    |
| organization_user_roles                     | Ein aktueller fachlicher Rollenwert je Benutzer und Organisation; zusammengesetzter Primärschlüssel; Benutzerindex                                                                                |
| person_user_links                           | Optionale 1:1-Verknüpfung innerhalb der Organisation; FKs sowohl zur Person als auch zum berechtigten Organisationskonto                                                                          |
| groups                                      | Name je Organisation eindeutig, Aktivstatus, Zeitstempel, `(organization_id,id)` eindeutig                                                                                                        |
| group_members                               | UUID, eindeutige Gruppe/Person, Organisationskontext, Eintritt/Änderung; beide Referenzen sind mandantengebunden                                                                                  |
| board_mandates                              | UUID, Person, Funktion und Amtsperiode; mandantengebundener FK, Datumsprüfung und eindeutige Wiederholungssperre                                                                                  |
| audit_logs                                  | Organisation, Akteur, Aktion, Entität, Zeitpunkt und Namen geänderter Felder; Indizes für Zeitraum und Entität                                                                                    |
| membership_fee_plans                        | Beitragstarif mit optionaler Mitgliedskategorie, Centbetrag, jährlich/einmalig, Aktivstatus und Version (Migration `0001`)                                                                        |
| membership_fee_assessments                  | Unveränderliche Forderung mit Mitgliedschaft, Jahr, Fälligkeit, Tarif-/Mitglieds-Snapshots und begründeter Anpassung; eindeutig je Tarif/Mitglied/Jahr bzw. einmalig                              |
| payments / payment_allocations              | Unveränderliche Zahlungen und exakte Cent-Zuordnungen; Trigger verhindern Überzuordnung, verzögerter Constraint verlangt vollständige Zuordnung am Commit; Bankreferenz je Organisation eindeutig |
| finance_operations                          | Idempotenzschlüssel je Organisation mit Operation, Request-Hash und ursprünglicher Antwort                                                                                                        |
| membership_fee_reminders                    | Unveränderliche, nummerierte Erinnerungsentwürfe mit offenem Betrag zum Vorbereitungszeitpunkt                                                                                                    |
| finance_accounts / cashbook_categories      | Kassen/Bankkonten und Einnahmen-/Ausgabenkategorien mit Klassifizierung Beitrag/Spende/Sonstige; versioniert (Migration `0002`)                                                                   |
| fiscal_years / fiscal_year_opening_balances | Jahreskennung je Organisation eindeutig, inklusive Datumsgrenzen mit Überschneidungsschutz, nur `open → closed`; unveränderliche Anfangsbestände je Konto                                         |
| cashbook_entries                            | Unveränderliche, je Jahr nummerierte Buchungen; Storno als negatives Gegenstück mit Verweis; höchstens eine Buchung je Zahlung                                                                    |
| payment_reversals                           | Storno einer Zahlung; Zuordnungen stornierter Zahlungen zählen nicht mehr                                                                                                                         |
| finance_report_templates                    | Vereinseigene Berichtsvorlagen als fortlaufende unveränderliche Versionen                                                                                                                         |
| documents                                   | Dokumentmetadaten mit Kategorie, Archivstatus, optionalem Kassabuch-/Übertrags-/Mitglieds-/Gruppenbezug (zusammengesetzte FKs) und Version; nicht löschbar (Migration `0003`)                     |
| document_versions                           | Unveränderliche, fortlaufend nummerierte Dateiversionen mit Dateiname, Typ, Größe, SHA-256 und serverseitigem Speicherschlüssel                                                                   |

Es gibt keine gemeinsam genutzten Personensätze zwischen Organisationen. E-Mail-Adressen von Personen sind fachlich nicht zwingend eindeutig (z. B. Familienadresse). Leere optionale Textfelder werden als leere Zeichenfolge normalisiert; nicht bekannte Datumswerte sind `null`. `fiscal_code` von Personen wird auf 16 alphanumerische Zeichen geprüft, aber nicht auf amtliche Gültigkeit oder Prüfziffer zertifiziert.

## Statusregeln

- `active`: kein Austrittsdatum.
- `pending`: Mitgliedschaft ausstehend; zählt nicht als aktiv.
- `inactive`: ruhender oder nicht aktiver Datensatz, optionales Enddatum.
- `resigned`: Austrittsdatum zwingend.
- Austritt und Mandatsende dürfen nie vor dem jeweiligen Beginn liegen.
- Geburt darf nicht nach dem Mitgliedschaftseintritt liegen.

Grundlegende Mitgliedschaftsregeln sind zusätzlich SQL-CHECK-Constraints. Die kombinierte Personen-/Eintrittsregel wird im transaktionalen Mitglieder-Service validiert. Eine Statusänderung setzt weder Mitgliedsnummer noch Personendaten zurück.

## Migrationen und Transaktionen

`bun run db:generate` erzeugt SQL und Drizzle-Metadaten; beide werden versioniert. `bun run db:migrate` führt ausstehende Migrationen explizit aus. Der Serverstart verändert nie das Schema. Im Produktions-Compose ist der Migrationscontainer ein gesonderter Release-Schritt. Vor destruktiven Migrationen Sicherung, Probe auf wiederhergestellten Daten und Kompatibilitätsplanung durchführen. Kein automatisches „push“ auf Produktion.

Mitgliedsanlage/-änderung, Gruppenbelegung, Vorstandsänderungen, Nutzerbereitstellung und Audit-Schreiben sind transaktional. Die Mitgliederliste nutzt einen konsistenten Repeatable-Read-Snapshot für Zeilen und Anzahl. Parallele Änderungen eines Mitglieds sperren den Mitgliedschaftsdatensatz. Administratorwechsel sperren die Organisation, damit der letzte Administrator nicht durch parallele Herabstufungen entfernt werden kann. Der Bootstrap wird durch einen Advisory Lock serialisiert. Finanzschreiben sperren die Organisationszeile mit `FOR NO KEY UPDATE`; Regeln und Begründung in [ADR 0002](decisions/0002-membership-fees.md) und [ADR 0003](decisions/0003-ledger.md).

## Pflege

Dauerhaftes PostgreSQL-Volume für Produktion/Entwicklung; separate kurzlebige Testdatenbank. Aufbewahrungsfristen, Lösch-/Anonymisierungsprozesse und Audit-Retention sind vor einem produktiven Datenimport organisatorisch festzulegen. Es gibt absichtlich keinen unkontrollierten Hard-Delete-Endpunkt für Mitglieder. Benutzer-, Person- und Dokumentdaten werden später unabhängig behandelt.

## Sprint 2.2 – Erweiterungsmigrationen 0004–0007

`ledger_transfers` speichert beide Konten eines internen Übertrags atomar, mit eigenem Stornoverweis und Datenbankprüfungen für Organisation, offene Jahre und exakte Gegenbewegung. `category_ets_mappings` enthält unveränderliche datierte Zuordnungen mit Definitionsversion. Buchungen speichern Kategoriebezeichnung, Projekt, ETS-Position und Definitionsversion. `payment_booking_defaults` konfiguriert automatische Buchungen je Zahlungsart. Alle Salden bleiben aus Eröffnungen, Buchungen und Überträgen ableitbar.

Bestehende Kalenderjahre erhalten Januar-/Dezembergrenzen ohne Änderung von Abschlussstatus oder Geldbeträgen. Die Migration bewahrt Wiederholungsantworten. Direkte Änderungen an Buchungen, Überträgen, Klassifizierungen, Kontoarten und geschlossenen Jahren sind gesperrt. Geschäftsjahres- und Kategorie-Upgrades werden mit einer realen bestehenden Datenbank getestet.

## Sprint 2.3 – Veranstaltungen

Migrationen `0008`–`0010` sind additiv. `0008_curious_smasher.sql` ergänzt `event_categories`, `event_series`, `event_occurrences`, `event_occurrence_exceptions`, `event_registrations`, `event_attendances`, `attendance_operations`, `attendance_history` und `event_operations` samt Status-Enums, Indizes, mandantengebundenen Fremdschlüsseln und Invariantentriggern. `0009_watery_vision.sql` ergänzt den privaten Dokumentbezug `event_occurrence_id`. `0010_smooth_nick_fury.sql` speichert Absagegründe für Instanz und Serie.

Anmeldungen sind je Organisation/Instanz/Person eindeutig. Abmeldung ändert den Status und bewahrt dieselbe Identität für eine erneute Anmeldung. Anwesenheit besitzt vier Statuswerte, monotone Versionen, erfassende Benutzer und eine unveränderliche Historie. Ein verzögerter Constraint verlangt für jede Anwesenheitsänderung die zugehörige Operation und Historie. UUID-Operationen speichern die autorisierte Identität, Request-Hash und Ergebnis. SQL-Regeln verhindern Kapazitätsüberschreitungen und direkte Löschung zentraler Historie.

Bestehende Personen dienen als Gäste ohne Mitgliedschaft. Projektbezüge bleiben optionale Textreferenzen, da kein Projektstammmodul existiert. Finanzschema und Zahlungsabläufe werden nicht mit Anmeldungen gekoppelt. Vor Produktivmigration wie üblich Datenbank/Dateien sichern und Migrationen kontrolliert mit `bun run db:migrate` anwenden; kein automatisches Schema-Push.
