# Datenbank

PostgreSQL 17, Drizzle ORM, UUID-Primärschlüssel und Zeitpunkte als `timestamptz` in UTC. Kalenderdaten (Geburt, Eintritt, Austritt, Mandat) sind bewusst `date`, keine UTC-Uhrzeiten. Änderungen werden über explizites `updated_at` und fachliche Audit-Einträge dokumentiert.

| Tabelle                                     | Verantwortung / Constraints                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| organizations                               | Mandant; eindeutiger Slug, Vereinsform, Sprache, Zeitzone und Adresse                                                                          |
| users / accounts / sessions / verifications | Better-Auth-Schema; UUIDs, eindeutige E-Mail und Sitzungstoken, Konten-/Benutzerindizes; Passwort-Hash gehört ausschließlich Better Auth       |
| persons                                     | Person ohne Loginpflicht; `(organization_id,id)` eindeutig; Namens- und E-Mail-Indizes pro Organisation                                        |
| memberships                                 | Projektion verbindet Person und Verein; Nummer und Person je Organisation eindeutig; Status-/Eintrittsindizes; zusammengesetzter FK zur Person |
| organization_user_roles                     | Ein aktueller fachlicher Rollenwert je Benutzer und Organisation; zusammengesetzter Primärschlüssel; Benutzerindex                             |
| person_user_links                           | Optionale 1:1-Verknüpfung innerhalb der Organisation; FKs sowohl zur Person als auch zum berechtigten Organisationskonto                       |
| groups                                      | Name je Organisation eindeutig, Aktivstatus, Zeitstempel, `(organization_id,id)` eindeutig                                                     |
| group_members                               | UUID, eindeutige Gruppe/Person, Organisationskontext, Eintritt/Änderung; beide Referenzen sind mandantengebunden                               |
| board_mandates                              | UUID, Person, Funktion und Amtsperiode; mandantengebundener FK, Datumsprüfung und eindeutige Wiederholungssperre                               |
| audit_logs                                  | Organisation, Akteur, Aktion, Entität, Zeitpunkt und Namen geänderter Felder; Indizes für Zeitraum und Entität                                 |

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

Mitgliedsanlage/-änderung, Gruppenbelegung, Vorstandsänderungen, Nutzerbereitstellung und Audit-Schreiben sind transaktional. Die Mitgliederliste nutzt einen konsistenten Repeatable-Read-Snapshot für Zeilen und Anzahl. Parallele Änderungen eines Mitglieds sperren den Mitgliedschaftsdatensatz. Administratorwechsel sperren die Organisation, damit der letzte Administrator nicht durch parallele Herabstufungen entfernt werden kann. Der Bootstrap wird durch einen Advisory Lock serialisiert.

## Pflege

Dauerhaftes PostgreSQL-Volume für Produktion/Entwicklung; separate kurzlebige Testdatenbank. Aufbewahrungsfristen, Lösch-/Anonymisierungsprozesse und Audit-Retention sind vor einem produktiven Datenimport organisatorisch festzulegen. Es gibt absichtlich keinen unkontrollierten Hard-Delete-Endpunkt für Mitglieder. Benutzer-, Person- und Dokumentdaten werden später unabhängig behandelt.
