# Roadmap

## Phase 1 – Verwaltungsbasis

Implementiert: Monorepo, gemeinsamer Vertrag, PostgreSQL-Migration, Login/Logout/Session, UUID-Auth-Schema, Organisationsrollen, Bootstrap, Mitglieder-CRUD, Statusvalidierung, Suche/Filter/Sortierung/Pagination, CSV-Export und bestätigter Import mit Vorschau, Dashboard, Gruppen und Personenzuordnungen, Vorstand und Amtszeiten, Vereinsprofil, persönliche Kontakte, Benutzeranlage/Rollen, Audit-Protokoll, DE/IT, Hell/Dunkel, installierbare PWA, sichere Shell-Caches, CI und echte Datenbank-/Browsertests.

Vor größerem produktivem Rollout: unabhängige Sicherheits-/Barrierefreiheitsprüfung, Wiederherstellungsprobe, optional MFA und eigener Mailtransport für sichere Einladungen/Passwortwiederherstellung. Tests mit realistischen Datenvolumen sollen Pagination und CSV-Durchsatz absichern. CSV-Import ist bewusst je Zeile atomar; größere Imports benötigen später einen serverseitigen Job mit idempotenter Import-ID und persistiertem Fortschritt.

## Beiträge und Finanzen

Sprint 2.1 implementiert: Beitragstarife, Forderungen, Zahlungen mit Zuordnungen, Idempotenz, PDF-Bestätigungen, Erinnerungsentwürfe und CSV-Exporte ([Umsetzung](sprints/2.1-implementation.md), [ADR 0002](decisions/0002-membership-fees.md)). Sprint 2.2a ergänzt Konten, Geschäftsjahre, Kassabuch, Storno und Jahresberichte ([Umsetzung](sprints/2.2-implementation.md), [ADR 0003](decisions/0003-ledger.md)). Offen sind private Belegdokumente (S22-04), validierte ETS-Vorlagen und gegebenenfalls doppelte Buchführung. Die folgende Zielskizze gilt für die verbleibenden Teile:

Eigenes Modul mit `contribution_tariffs`, `contribution_years`, `receivables`, `payments`, `payment_allocations`, `cashbook_entries`, `receipts`, `fiscal_years` und `closing_versions`, jeweils mit Organisation. Geldwerte als exakte Dezimalbeträge bzw. Minor Units plus Währung, nie JavaScript-Fließkomma als Buchungswahrheit. Teilzahlungen als Zuordnung zwischen Forderung und Zahlung; Buchungen nach Abschluss nicht überschreiben, sondern korrigierend stornieren. Transaktionen und eindeutige Referenzen sichern Zahlungszuordnung. ETS-Modelle D/E erst nach fachlicher und rechtlicher Validierung der jeweils geltenden Vorgaben implementieren.

## Termine und Veranstaltungen

`events`, `recurrence_rules`, `registrations`, `waitlist_entries`, `attendance_records`. Kapazitätsprüfungen und Wartelisten sind transaktional, konkurrierende Anmeldungen dürfen das Limit nicht überschreiten. Wiederholungen erhalten Zeitzone und explizite Ausnahmen. Offline-Anwesenheit besitzt eine eng begrenzte verschlüsselte lokale Projektion; vor Freigabe sind Schlüsselspeicherung, Geräteverlust, Rollenentzug und Datenbereinigung zu lösen.

## Dokumente

`documents`, unveränderliche `document_versions`, `document_permissions`, Blob-IDs und Inhalts-Hashes. Dateien außerhalb öffentlicher Webroots in selbst gehostetem Storage; Download nur über Autorisierungsprüfung und kurzlebigen Zugriff. Uploadlimits, MIME-/Signaturprüfung, Malware-Prüfung und gesicherte PDF-Verarbeitung gehören zum Modul. Kein freier Dateipfad aus Nutzereingaben. Metadaten und Dateien müssen gemeinsam wiederherstellbar sein.

## Freiwillige

Personenstamm wiederverwenden, Freiwilligenstatus von Mitgliedschaft trennen. `volunteer_periods`, `insurance_assignments`, `deployments`, `time_entries`, `volunteer_register_versions`. Ein-/Austritte, Versicherungsbezug und Registerstände versionieren, Korrekturen nachvollziehbar dokumentieren. Keine automatische Gleichsetzung von Vereinsmitglied und versichertem Freiwilligen.

## Recht und Compliance

`compliance_deadlines`, `document_preparations`, `signature_requests`, `archive_packages`. RUNTS-Fristen und Dokumente fachlich versionieren. Elektronische Signaturen und Zeitstempel später über austauschbare Adapter integrieren. Kein selbst erzeugtes Register, PDF oder Archiv ist automatisch rechtlich zertifiziert. Konkrete Anforderungen und geeignete Dienst-/Signaturmodelle müssen vor Produktivnutzung gesondert geprüft werden.

## Offline-Synchronisierung

1. Outbox pro Benutzer und Organisation mit Operations-UUID, Entität, Basisversion, Payload, Erstellzeit und Zustand.
2. Serverseitige Idempotenz-Tabelle mit `(organization_id, operation_id)` und gespeicherter Antwort; gleiche Operation wird exakt einmal fachlich angewendet.
3. Optimistische Versionen und `If-Match` für Änderungen; Konfliktantwort 409/412 mit erlaubter neuer Projektion. Keine stillen Last-Write-Wins für Anwesenheit oder Finanzen.
4. Synchronisierung beim App-Start, Fokus, `online` und manuellem Versuch. Background Sync optional, insbesondere nicht als iOS-Voraussetzung.
5. Sichtbare Zustände: ausstehend, synchronisiert, fehlgeschlagen, Konflikt. Verlässliche Wiederholungen mit Backoff; keine Endlosschleife bei 401/403.
6. Abmeldung, Organisationswechsel und Rechteentzug: lokale Daten sperren/bereinigen; keine Synchronisierung unter falschem Konto. Sicherheitskonzept und Tests müssen vor dem ersten Offline-Personendatensatz bestehen.

Die Phase-1-Dexie-Datenbank enthält nur Shell-Metadaten; eine konkrete Queue oder Speicherung sensibler Daten wird noch nicht vorgetäuscht.
