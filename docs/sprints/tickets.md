# Testbare Sprint-Tickets

Sprint 2.1 und Sprint 2.2 (S22-01 bis S22-05) sind umgesetzt. Die übrigen Tickets sind ein Backlog und keine zugesagten fertigen Funktionen.

## Sprint 2.1 – Beiträge und Zahlungszuordnung

| Ticket                             | Abnahme                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S21-01 Datenmodell                 | Additive Migration für Tarife, Forderungen, Zahlungen, Zuordnungen, Idempotenz und Erinnerungsentwürfe. UUID-/Mandanten-FKs und Cent-Constraints; bestehende Daten bleiben erhalten.                                                                               |
| S21-02 Tarife                      | Admin kann jährliche/einmalige Tarife mit Mitgliedskategorie anlegen, ändern und deaktivieren. Kassier darf Tarife lesen, aber nicht verwalten. Versionskonflikte werden erkannt; alte Forderungen ändern sich nicht.                                              |
| S21-03 Forderungen                 | Kassier/Admin erzeugt eine Forderung für ein eigenes Mitglied mit Jahr/Fälligkeit. Individueller Betrag, Ermäßigung und Befreiung benötigen eine Begründung. Wiederholte Jahres- bzw. Einmalforderungen werden abgewiesen.                                         |
| S21-04 Zahlungen                   | Bar, Überweisung, sonstige; eine Zahlung kann mehrere Forderungen bedienen, mehrere Teilzahlungen eine Forderung. Jede Zahlung ist vollständig zugeordnet. Überzahlungen und doppelte Zuordnungen werden verhindert.                                               |
| S21-05 Idempotenz und Parallelität | Jeder schreibende Finanzrequest benötigt eine Operations-UUID. Gleicher Schlüssel/Inhalt liefert dieselbe Antwort, anderer Inhalt 409. Parallele Zahlungen können den offenen Betrag nicht überschreiten; fehlgeschlagene Requests hinterlassen keine Teilbuchung. |
| S21-06 Rechte und Nachweise        | Finanzrechte nur Admin/Kassier; fremde Organisationen und normale Mitglieder werden auch bei Detail-/PDF-Zugriff abgewiesen. Finanzänderungen werden in derselben Transaktion auditisiert.                                                                         |
| S21-07 Belege und Rückstände       | Autorisierte PDF-Zahlungsbestätigung in DE/IT, offene/überfällige Forderungen, Erinnerung als herunterladbarer Entwurf ohne automatischen Versand, gefilterte CSV-Exporte. Keine rechtliche Zertifizierung behaupten.                                              |
| S21-08 Oberfläche und Regression   | Responsive Finanzansicht mit Tarifen, Forderungen und Zahlungen; alle Texte DE/IT, Lade-/Fehler-/Leer-/Erfolgszustände. Unit-, echte PostgreSQL-, Berechtigungs- und Browserprüfungen plus Phase-1-Regression und Produktionsbuild bestehen.                       |

## Sprint 2.2 – Kassabuch und Dokumente (umgesetzt)

Umsetzung: [2.2-implementation.md](2.2-implementation.md).

| Ticket                           | Abnahme                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S22-01 Geschäftsjahre und Konten | Bargeld-/Bankkonten, Anfangsbestände, eröffnete/geschlossene Geschäftsjahre; doppelte Eröffnung und Buchung in geschlossene Jahre werden getestet abgewiesen.                                              |
| S22-02 Kassabuch                 | Einnahmen/Ausgaben, Kategorien, Beleg-/Buchungsdatum und Nummern; Beitrag/Spende getrennt. Gebuchte Einträge unveränderlich; Korrektur/Storno referenziert Original und ist transaktional/idempotent.      |
| S22-03 Zahlungsanbindung         | Beitragszahlungen bleiben Zahlungsereignisse; eindeutige Zuordnung zur Kassabuchbuchung verhindert doppelte Einnahmen. Zahlungsstorno berücksichtigt Zuordnungen, Forderungsstände und Belegstatus atomar. |
| S22-04 Private Dokumente         | Autorisierte Upload-/Downloadrouten mit Limits, Dateisignaturprüfung, SHA-256, Versionen, Kategorie, Archivstatus und Beleg-/Mitgliedsreferenzen. Direkte URLs und fremde IDs geben keine Dateien frei.    |
| S22-05 Berichte                  | Getrennte Einnahmen/Ausgaben/Salden, CSV/PDF; ETS-D/E-Kategorien, Schwellen und Gültigkeitszeiträume konfigurierbar und versioniert, ohne Zertifizierungsbehauptung.                                       |

Zusätzliche Abnahme Sprint 2.2: interne Überträge ohne Ergebniswirkung, freie Geschäftsjahresgrenzen, Kategorie-/ETS-Snapshots, kontrollierte historische Nachbuchung, Finanzdashboard und recherchierte amtliche Modelle D/E. Nachweis: 100 PostgreSQL-Tests, 69 Unit/UI-Tests und 24 Browserprüfungen in Desktop/Mobil; Details in [Prüfnachweise](../verification.md).

## Sprint 2.3 – Veranstaltungen und Offline-Anwesenheit (implementiert)

| Ticket               | Abnahme                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S23-01 Kalender      | Veranstaltungen mit Ort, Kategorie, Zeitraum und Wiederholungen; Datumsregeln und Zeitzone geprüft, Kalender/Filter DE/IT.                                                                                                                                                    |
| S23-02 Registrierung | Mitglieder und autorisierte externe Personen; Frist, Limit, Abmeldung und Warteliste transaktional. Parallele Anmeldungen überschreiten keine Kapazität.                                                                                                                      |
| S23-03 Anwesenheit   | Autorisierte Erfassung und PDF-Teilnehmerliste; Datensparsamkeit und Cross-Tenant-Tests. Dokumentreferenzen an Veranstaltungen anbinden.                                                                                                                                      |
| S23-04 Offline-Sync  | Minimale lokale Projektion, Operations-UUID, Outbox, idempotente Endpunkte und Versionskonflikte. Wiederholung/Status sichtbar; Start/Fokus/Online/manueller Versuch ohne Background-Sync-Pflicht funktionieren. Logout/Rechteentzug bereinigt personenbezogene lokale Daten. |

Umgesetzt: S23-01 bis S23-04. Nachweise und Gerätegrenzen: [Sprint-2.3-Dokumentation](2.3-implementation.md).

## Sprint 2.4 – Freiwillige und Compliance (implementiert)

| Ticket                | Abnahme                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S24-01 Freiwillige    | Regulär/gelegentlich, Beginn/Ende, Einsätze mit Veranstaltung und Stunden; Statuswechsel schreiben eine chronologische unveränderliche Registerhistorie.                                          |
| S24-02 Versicherungen | Policen, Zeiträume, Nachweise, Zuordnungen und Ablaufhinweise; Rollenrechte und Datenminimierung geprüft.                                                                                         |
| S24-03 Registerstände | Versionierte Snapshots und dokumentierte Exporte; spätere Signatur-/Zeitstempel-/Archivschnittstellen ohne behauptete Zertifizierung.                                                             |
| S24-04 Compliance     | Fristen, Mandatsabläufe, RUNTS-Jahresmeldungen, Abschluss-/Dokumentchecklisten, Verantwortliche, Status, Protokollnummer und Nachweise. Manuelle Einreichung und Archivierung; kein Portal-Login. |

Umgesetzt: S24-01 bis S24-04. Nachweise und rechtliche Grenzen: [Sprint-2.4-Dokumentation](2.4-implementation.md), [Validierungsgrundlage](../legal/volunteer-register-validation.md).

## Performance – Bundle-Aufteilung (geplant, nicht Teil von Sprint 2.4)

Messung am 30.10.2026 (`vite build --sourcemap`, Stand `feat/sprint-2.4`): ein einziger JavaScript-Chunk mit **1.576,8 kB minifiziert / 458,4 kB gzip**; der PWA-Precache umfasst 1.608,9 KiB. Ursache: `apps/web/src/app/main.tsx` importiert alle 20 Feature-Module statisch, es gibt kein `React.lazy` und keine Chunk-Regeln. Zuordnung über die Sourcemap:

| Anteil | Herkunft                                                                                                 | Gebraucht von                                 |
| -----: | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 268 kB | FullCalendar (`core` 155, `interaction`, `timegrid`, `daygrid`, `list`) samt `preact` 17 kB              | nur Veranstaltungskalender                    |
| 199 kB | `@js-temporal/polyfill` 122, `rrule` 44, `jsbi` 34 – über das Barrel `@bnature/contracts` → `event-time` | nur Wiederholungen/Zeiten von Veranstaltungen |
| 203 kB | `react-dom`                                                                                              | alle Routen (bleibt im Einstieg)              |
| 109 kB | Locales DE und IT inklusive Kassabuch-/Freiwilligentexte, alle sofort geladen                            | jeweils nur eine Sprache und ein Bereich      |
|  96 kB | `dexie`                                                                                                  | Offline-Anwesenheit, Logout-Bereinigung       |
|  88 kB | `zod` (+ 36 kB `packages/contracts`)                                                                     | Formulare und Validierung                     |
|  69 kB | `luxon`                                                                                                  | Kalender-Adapter, Datumsanzeigen              |
| 188 kB | Feature-Code Finanzen 73, Freiwillige 54, Veranstaltungen 33, Compliance 15, Dokumente 13                | jeweils nur eigene Route                      |

| Ticket                              | Maßnahme und Abnahme                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-01 Route-Level-Splitting       | Routen in `main.tsx` mit `React.lazy`/`Suspense` laden: Finanzen inkl. Kassabuch, Veranstaltungen, Freiwillige (Übersicht, Einsätze, Versicherung, Register), Compliance, Dokumente, Audit, Benutzer. Dashboard, Login, Shell und Mitglieder bleiben im Einstieg. Fallback ist die bestehende `Loading`-Komponente. Abnahme: Einstiegs-Chunk ≤ 600 kB minifiziert, alle Playwright-Suiten Desktop/Mobil grün. |
| PERF-02 Kalender isolieren          | FullCalendar und `@fullcalendar/luxon3` nur im Veranstaltungs-Chunk; Kalenderkomponente zusätzlich per `lazy` erst bei der Kalenderansicht laden. Abnahme: kein `@fullcalendar`/`preact` im Einstiegs-Chunk (Sourcemap-Prüfung).                                                                                                                                                                              |
| PERF-03 Contracts-Barrel entkoppeln | `event-time` (Temporal-Polyfill, `rrule`) nicht mehr über `@bnature/contracts` re-exportieren, sondern als Unterpfad `@bnature/contracts/event-time` anbieten; `sideEffects` im Paket deklarieren. API-Imports anpassen. Abnahme: Polyfill/`rrule`/`jsbi` nur im Veranstaltungs-Chunk; Unit- und Integrationstests unverändert grün.                                                                          |
| PERF-04 Locales nachladen           | Sprachpakete je Sprache und Bereich (Basis, Kassabuch, Freiwillige) über `i18next`-Ressourcen dynamisch laden; Basis-DE/IT bleiben synchron für Login und Shell. Abnahme: Sprachwechsel DE↔IT und Offline-App-Shell im Playwright-Lauf weiterhin grün.                                                                                                                                                        |
| PERF-05 Offline-Speicher            | `dexie` erst bei Offline-Anwesenheit laden; die Logout-Bereinigung in `shell.tsx` per dynamischem Import ausführen. Abnahme: Logout und Rechteentzug löschen lokale Daten weiterhin nachweisbar (bestehende E2E-Fälle).                                                                                                                                                                                       |
| PERF-06 Budget und Precache         | Chunk-Größenbudget in CI (Warnung bei > 600 kB je Chunk) und Prüfung, dass der Workbox-Precache alle Lazy-Chunks enthält, damit die App-Shell offline vollständig bleibt. Abnahme: Offline-Test öffnet eine lazy geladene Route ohne Netz.                                                                                                                                                                    |

Reihenfolge: PERF-03 → PERF-01/02 → PERF-05 → PERF-04 → PERF-06. Erwartung nach PERF-01 bis PERF-03: Einstieg etwa 0,6–0,7 MB minifiziert (Schätzung, vor Umsetzung zu messen). Der Umbau ist bewusst nicht Teil von Sprint 2.4: Lazy-Chunks verändern Precache und Offline-Verhalten und brauchen einen eigenen Testlauf.
