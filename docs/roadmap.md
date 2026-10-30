# Roadmap

## Phase 1 – Verwaltungsbasis

Implementiert: Monorepo, gemeinsamer Vertrag, PostgreSQL-Migration, Login/Logout/Session, UUID-Auth-Schema, Organisationsrollen, Bootstrap, Mitglieder-CRUD, Statusvalidierung, Suche/Filter/Sortierung/Pagination, CSV-Export und bestätigter Import mit Vorschau, Dashboard, Gruppen und Personenzuordnungen, Vorstand und Amtszeiten, Vereinsprofil, persönliche Kontakte, Benutzeranlage/Rollen, Audit-Protokoll, DE/IT, Hell/Dunkel, installierbare PWA, sichere Shell-Caches, CI und echte Datenbank-/Browsertests.

Vor größerem produktivem Rollout: unabhängige Sicherheits-/Barrierefreiheitsprüfung, Wiederherstellungsprobe, optional MFA und eigener Mailtransport für sichere Einladungen/Passwortwiederherstellung. Tests mit realistischen Datenvolumen sollen Pagination und CSV-Durchsatz absichern. CSV-Import ist bewusst je Zeile atomar; größere Imports benötigen später einen serverseitigen Job mit idempotenter Import-ID und persistiertem Fortschritt.

## Beiträge und Finanzen

Sprint 2.1 implementiert: Beitragstarife, Forderungen, Zahlungen mit Zuordnungen, Idempotenz, PDF-Bestätigungen, Erinnerungsentwürfe und CSV-Exporte ([Umsetzung](sprints/2.1-implementation.md), [ADR 0002](decisions/0002-membership-fees.md)). Sprint 2.2a ergänzt Konten, Geschäftsjahre, Kassabuch, Storno und Jahresberichte ([Umsetzung](sprints/2.2-implementation.md), [ADR 0003](decisions/0003-ledger.md)). Sprint 2.2b ergänzt die private Dokumentablage. Sprint 2.2 ist um neutrale Überträge, Datumsgrenzen für Geschäftsjahre, Kategorie-/ETS-Snapshots, automatische Beitragsbuchungen nach Einrichtung, kontrollierte historische Nachbuchung, Finanzdashboard und amtlich recherchierte D/E-Berichtsvorbereitung ergänzt. Rechtsstand und Grenzen: [ETS-Berichte](ets-reporting.md). Offen bleiben fachliche Freigabe konkreter Vereinsabschlüsse, Erläuterungsberichte und gegebenenfalls doppelte Buchführung. Die folgende Zielskizze bleibt für spätere Erweiterungen relevant:

Eigenes Modul mit `contribution_tariffs`, `contribution_years`, `receivables`, `payments`, `payment_allocations`, `cashbook_entries`, `receipts`, `fiscal_years` und `closing_versions`, jeweils mit Organisation. Geldwerte als exakte Dezimalbeträge bzw. Minor Units plus Währung, nie JavaScript-Fließkomma als Buchungswahrheit. Teilzahlungen als Zuordnung zwischen Forderung und Zahlung; Buchungen nach Abschluss nicht überschreiben, sondern korrigierend stornieren. Transaktionen und eindeutige Referenzen sichern Zahlungszuordnung. D/E-Vorbereitung verwendet versionierte amtliche Definitionen; jeder konkrete Abschluss braucht eine verantwortliche fachliche Prüfung.

## Termine und Veranstaltungen

Sprint 2.3 implementiert Kategorien, konkrete Veranstaltungsinstanzen und endliche Terminserien, Kalender (Monat/Woche/Liste), Mitglieder-/Gastanmeldungen, atomare Kapazität und FIFO-Wartelisten, Anwesenheitsstatus mit Historie, PDF/CSV/ICS und private Veranstaltungsdokumente. Die verschlüsselte Dexie-Outbox unterstützt Offline-Neuladen, Sessionablauf, idempotente Synchronisierung und ausdrücklich aufgelöste Versionskonflikte. Details: [Umsetzung](sprints/2.3-implementation.md), [ADR 0004](decisions/0004-events-offline.md).

Vor Gerätefreigabe: installierte PWA unter echtem iOS/Safari und Android mit Flugmodus prüfen. Spätere Erweiterungen: längere/rollierende Serien, skalierbare Imports, gegebenenfalls separate Veranstaltungsrollen und feinere Sperren. Öffentliche Anmeldung benötigt zuerst Missbrauchsschutz; Gebühren und Zahlungsintegration bleiben ein eigener Auftrag.

## Dokumente

Sprint 2.2b implementiert private, versionierte Dokumente mit Signatur- und Hashprüfung, Archivstatus und Kassabuch-/Mitgliedsbezug ([Umsetzung](sprints/2.2-implementation.md#22b--private-dokumente-s22-04)). Offen: Malware-Prüfung, feingranulare Dokumentrechte, Speicherquoten, protokolliertes endgültiges Löschen nach Aufbewahrungsfrist, Abgleich verwaister Dateien . Ursprüngliche Zielskizze:

`documents`, unveränderliche `document_versions`, `document_permissions`, Blob-IDs und Inhalts-Hashes. Dateien außerhalb öffentlicher Webroots in selbst gehostetem Storage; Download nur über Autorisierungsprüfung und kurzlebigen Zugriff. Uploadlimits, MIME-/Signaturprüfung, Malware-Prüfung und gesicherte PDF-Verarbeitung gehören zum Modul. Kein freier Dateipfad aus Nutzereingaben. Metadaten und Dateien müssen gemeinsam wiederherstellbar sein.

## Freiwillige

Sprint 2.4 implementiert Freiwillige auf dem vorhandenen Personenstamm (getrennt von Mitgliedschaft), Einsätze zu Veranstaltungen, bestätigungspflichtige Stunden mit Korrekturhistorie, Versicherungspolicen mit Zuordnungen, Meldelisten und indikativer Deckungsprüfung sowie das gesetzliche Register mit Hash-Kette, festgeschriebenen Ständen und externem Signaturimport ([Umsetzung](sprints/2.4-implementation.md), [ADR 0005](decisions/0005-volunteer-register.md), [rechtliche Validierung](legal/volunteer-register-validation.md)). Offen: Selbstansicht für Freiwillige, Wechsel der Tätigkeitsart ohne Austritt, Löschprozess nach Aufbewahrungsfrist.

## Recht und Compliance

Sprint 2.4 implementiert den Fristen- und Pflichtenmanager mit versionierten Regeln (gesetzlich, Verwaltungsempfehlung, intern), amtlichen Quellen, Berechnung aus Geschäftsjahren, Mandaten, Policen und Registerständen, Nachweisen, Protokollnummern und Historie. Keine automatische RUNTS-Einreichung. Signaturen und Zeitstempel laufen über eine austauschbare Schnittstelle; heute ausschließlich extern und manuell. Kein selbst erzeugtes Register, PDF oder Archiv ist automatisch rechtlich zertifiziert. Offen: qualifizierter Signatur-/Zeitstempeladapter nach rechtlicher Freigabe, Mailerinnerungen, Landesfristen Südtirol.

## Offline-Synchronisierung

1. Outbox pro Benutzer und Organisation mit Operations-UUID, Entität, Basisversion, Payload, Erstellzeit und Zustand.
2. Serverseitige Idempotenz-Tabelle mit `(organization_id, operation_id)` und gespeicherter Antwort; gleiche Operation wird exakt einmal fachlich angewendet.
3. Optimistische Versionen und `If-Match` für Änderungen; Konfliktantwort 409/412 mit erlaubter neuer Projektion. Keine stillen Last-Write-Wins für Anwesenheit oder Finanzen.
4. Synchronisierung beim App-Start, Fokus, `online` und manuellem Versuch. Background Sync optional, insbesondere nicht als iOS-Voraussetzung.
5. Sichtbare Zustände: ausstehend, synchronisiert, fehlgeschlagen, Konflikt. Verlässliche Wiederholungen mit Backoff; keine Endlosschleife bei 401/403.
6. Abmeldung, Organisationswechsel und Rechteentzug: lokale Daten sperren/bereinigen; keine Synchronisierung unter falschem Konto. Sicherheitskonzept und Tests müssen vor dem ersten Offline-Personendatensatz bestehen.

Sprint 2.3 setzt diese Strategie für Anwesenheit um. Die Phase-1-Datenbank bleibt auf Shell-Metadaten beschränkt; Veranstaltungsdaten liegen in einer eigenen verschlüsselten Datenbank mit Ablauf und Bereinigung.

## Nächste Aufgaben nach Sprint 2.4

Kommunikationserweiterung auf `feat/communication-email`: SMTP-Grundlage, lokales Mailpit-Testpostfach, Vorschau/Bestätigung, rollenabhängiger Postausgang, Beitragserinnerungen und Termineinladungen sowie explizit aktivierbare automatische Beitragserinnerungen sind implementiert. Details und Grenzen: [E-Mail](mail.md). Fristenmails, Newsletter, News, Umfragen und optional Chat bleiben offen. Der vorhandene Fristenmanager verschickt weiterhin keine E-Mails.

Für b*nature vereinbarter weiterer Schwerpunkt: Kommunikation, Inventar/Ausleihe, Beitrags-Sammelvorschreibungen, Mitgliedszusatzfelder/Einwilligungen/Erziehungsberechtigte, Geburtstage/Jubiläen, Excel-Import und Auswertungen. SEPA und elektronische Rechnungen nur bei konkretem Bedarf. Sportmodule (Mannschaften, Tesseramento und sportbezogene Verwaltung) sind ausdrücklich ausgeschlossen.

Release-Gates aus [Prüfnachweise](verification.md#offene-release-gates) abarbeiten, insbesondere rechtliche Freigabe des Registerverfahrens und der Startregeln. Danach: qualifizierter Signaturadapter, Mailerinnerungen für Fristen, Selbstansicht für Freiwillige und Aufbewahrungs-/Löschprozesse. Öffentliche Anmeldung und Gebühren bleiben getrennt zu planen.
