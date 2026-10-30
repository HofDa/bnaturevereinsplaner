# ADR 0003 – Kassabuch, Überträge und versionierte Berichte

Status: angenommen und in Sprint 2.2 ergänzt, 30.10.2026.

Die vorhandenen `finance_accounts`, `cashbook_categories`, `cashbook_entries`, `payments` und `payment_allocations` bleiben die Finanzbasis. Integer-Centbeträge pro Ereignis und BigInt/String-Aggregate vermeiden ungenaue Geldberechnungen. Das Modul arbeitet nach dem Kassenprinzip.

Buchungen, Eröffnungsbestände, Überträge und Zahlungsstornos sind unveränderlich. Korrekturen erzeugen referenzierte Gegenbewegungen; Stornos übernehmen Betrag, Konto, Richtung, Kategorie, Projekt und ETS-Snapshot des Originals. Interne Überträge sind ein eigenes Ereignis mit Quell- und Zielkonto, kein Einnahmen-/Ausgabenpaar. Salden werden aus Eröffnung, Buchungen und den beiden Seiten der Überträge berechnet.

Geschäftsjahre besitzen frei definierbare inklusive Datumsgrenzen. Organisationssperren verhindern Überschneidungen, Datenbanktrigger schützen Datumszuordnung und geschlossene Jahre. Vorjahre werden über Datumsgrenzen gefunden. Abschluss verlangt Adminrecht, `confirm: true`, Idempotenzschlüssel und Audit-Eintrag. Spätere Korrekturen erfolgen in einem offenen Folgejahr; abgeschlossene Geldberichte bleiben stabil.

Beitragszahlungen bleiben Ereignisse aus Sprint 2.1. Eine Zahlung erzeugt höchstens eine Kassabuchbuchung, unabhängig von der Zahl ihrer Forderungszuordnungen. Nach Einrichtung von Zahlungskonten wird automatisch im selben Request gebucht; explizite Buchungsangaben haben Vorrang. Gibt es mehrere aktive Konten gleicher Art, muss das Konto ausdrücklich gewählt werden; die Einrichtung errät kein Zielkonto. Vorhandene Installationen ohne Einrichtung behalten den bisherigen Zahlungsablauf. Historische Zahlungen werden kontrolliert und idempotent in maximal 100 Zahlungen je Durchlauf nachgebucht. Verbuchte Zahlungsstornos erzeugen ihre Gegenbuchung atomar; ein verzögerter Constraint verlangt diese am Commit.

Kategorien dürfen umbenannt/deaktiviert werden. Richtung, Klassifizierung und Kontenart sind auch auf Datenbankebene unveränderlich. Kategoriebezeichnung, Projekt, ETS-Position und Definitionsversion werden je Buchung festgehalten. `category_ets_mappings` trennt die fachliche Kategorie von der versionierten ETS-Gliederung. Neue Zuordnungen ändern keine vorhandenen Buchungen. Amtliche Definitionen und zeitliche Schwellen stehen zentral in `packages/contracts/src/ets.ts`, Quellen in [ETS-Berichte](../ets-reporting.md). Vereinseigene Berichtsvorlagen bleiben zusätzlich nutzbar.

Alle Finanzschreiboperationen verwenden `financialOperation`: Organisationssperre, erneute Rollenprüfung, Request-Hash, gespeicherte Idempotenzantwort und Audit. Zusammengesetzte Fremdschlüssel verhindern fremde Konten, Kategorien und Objektreferenzen. Dashboard, Kassabuch-PDF und zusammengesetzte Jahresberichte lesen konsistente Datenbank-Snapshots. Private Dokumente verwenden einen austauschbaren Storage-Vertrag und serverseitig geschützte Downloads.
