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

## Sprint 2.3 – Veranstaltungen und Offline-Anwesenheit (offen)

| Ticket               | Abnahme                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S23-01 Kalender      | Veranstaltungen mit Ort, Kategorie, Zeitraum und Wiederholungen; Datumsregeln und Zeitzone geprüft, Kalender/Filter DE/IT.                                                                                                                                                    |
| S23-02 Registrierung | Mitglieder und autorisierte externe Personen; Frist, Limit, Abmeldung und Warteliste transaktional. Parallele Anmeldungen überschreiten keine Kapazität.                                                                                                                      |
| S23-03 Anwesenheit   | Autorisierte Erfassung und PDF-Teilnehmerliste; Datensparsamkeit und Cross-Tenant-Tests. Dokumentreferenzen an Veranstaltungen anbinden.                                                                                                                                      |
| S23-04 Offline-Sync  | Minimale lokale Projektion, Operations-UUID, Outbox, idempotente Endpunkte und Versionskonflikte. Wiederholung/Status sichtbar; Start/Fokus/Online/manueller Versuch ohne Background-Sync-Pflicht funktionieren. Logout/Rechteentzug bereinigt personenbezogene lokale Daten. |

## Sprint 2.4 – Freiwillige und Compliance (offen)

| Ticket                | Abnahme                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S24-01 Freiwillige    | Regulär/gelegentlich, Beginn/Ende, Einsätze mit Veranstaltung und Stunden; Statuswechsel schreiben eine chronologische unveränderliche Registerhistorie.                                          |
| S24-02 Versicherungen | Policen, Zeiträume, Nachweise, Zuordnungen und Ablaufhinweise; Rollenrechte und Datenminimierung geprüft.                                                                                         |
| S24-03 Registerstände | Versionierte Snapshots und dokumentierte Exporte; spätere Signatur-/Zeitstempel-/Archivschnittstellen ohne behauptete Zertifizierung.                                                             |
| S24-04 Compliance     | Fristen, Mandatsabläufe, RUNTS-Jahresmeldungen, Abschluss-/Dokumentchecklisten, Verantwortliche, Status, Protokollnummer und Nachweise. Manuelle Einreichung und Archivierung; kein Portal-Login. |
