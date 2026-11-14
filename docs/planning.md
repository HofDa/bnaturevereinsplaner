# Projektplanung und Kostenpläne

Unter **Projektplanung** (`/planning`) können Admin, Vorstand, Kassenwart und Projektleitung Kostenpläne ihrer Organisation gemeinsam verwalten. Reguläre Mitglieder haben keinen Zugriff. Kostenpläne sind Planungshilfen; sie erzeugen keine Zahlungen oder Kassabucheinträge.

Jeder Plan hat einen Namen, eine Beschreibung und bis zu 200 Positionen. Positionen enthalten Bezeichnung, Kategorie, Menge, Einheit, Einzelpreis, Ist-Gesamtkosten und Notizen. Mengen unterstützen drei Nachkommastellen. Geplante Kosten werden pro Position auf Cent gerundet, dann summiert. Die Abweichung ist Ist minus Plan; positive Werte zeigen eine Überschreitung. Noch nicht angefallene Ist-Kosten bleiben bei 0. Alle Beträge sind EUR.

Bis zu zehn frei benennbare Textspalten ergänzen z. B. Lieferant, Verantwortliche oder Förderquelle. Zusatzspalten und Positionen lassen sich umordnen und entfernen; Positionen können dupliziert werden. Änderungen werden erst mit **Speichern** übernommen. Beim Schließen eines geänderten Entwurfs wird nachgefragt. Gleichzeitige Änderungen werden über eine Versionsprüfung erkannt; in diesem Fall den Entwurf bei Bedarf separat sichern, schließen und den aktuellen Plan neu laden.

**CSV** und **Excel (.xlsx)** exportieren den gespeicherten Plan einschließlich Projektname, Beschreibung, Währung, aller Zusatzspalten in ihrer Reihenfolge und Gesamtsummen. CSV verwendet UTF-8 mit BOM, Semikolon und Dezimalkomma. Textzellen werden gegen Tabellenkalkulationsformeln geschützt. XLSX enthält echte Zahlenzellen und wörtliche Textzellen; Beträge und Summen entsprechen dem gespeicherten Stand und sind keine Formeln.

API: `GET/POST /api/v1/planning/costs`, `GET/PUT /api/v1/planning/costs/:id`, `GET /api/v1/planning/costs/:id/export?format=csv|xlsx&language=de|it`. Schreibzugriffe erfordern einen Idempotency-Key; Updates zusätzlich die aktuelle `version`. Änderungen werden im Audit-Protokoll erfasst. Daten sind organisationsgebunden und werden nicht offline gespeichert.

Vor dem ersten Start nach diesem Update `bun run db:migrate` ausführen. Migration 0025 ergänzt die Tabelle `cost_plans`.
