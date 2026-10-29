# ADR 0002 – Beiträge und Zahlungen

Status: angenommen. Sprint 2.1, 29.10.2026.

Die bestehenden Fachmodule werden um Beiträge erweitert. Admin erhält Tarif- und Finanzrechte, Kassier Lese-/Schreibrechte für Forderungen/Zahlungen. Andere Rollen erhalten keinen Finanzzugriff. Vorhandene Mitgliedskategorien werden wiederverwendet.

EUR-Beträge sind begrenzte Integer-Centwerte. Summen werden exakt berechnet; aggregierte Gesamtsummen werden als dezimale Cent-Zeichenfolgen übertragen, um die sichere JavaScript-Zahlengrenze nicht zu überschreiten. Keine Währungsumrechnung oder Fließkomma-Rundung.

Eine Forderung enthält unveränderliche Tarif-/Mitgliedssnapshots, Jahr, Fälligkeit und begründete individuelle Anpassung. Jährliche Forderungen sind je Tarif/Mitglied/Jahr, einmalige je Tarif/Mitglied eindeutig. Die Periodizität eines bereits verwendeten Tarifs kann nicht geändert werden. Zahlungen und Zuordnungen sind unveränderlich. Zahlungsstände werden aus Zuordnungen abgeleitet, nicht separat fortgeschrieben.

Schreiboperationen sperren die Organisation transaktional. Das serialisiert nur Finanzschreiben derselben Organisation und wirkt auch über mehrere API-Prozesse; es ist für die Vereinsgröße bewusst einfach. Innerhalb der Sperre werden aktuelle Rechte, Idempotenzschlüssel und offene Beträge geprüft. Datenbanktrigger prüfen Zuordnungssummen zusätzlich; ein verzögerter Constraint verlangt am Commit die vollständige Zuordnung jeder Zahlung. Zusammengesetzte Fremdschlüssel verhindern Cross-Tenant-Verknüpfungen. Audit und Idempotenzantwort werden atomar gespeichert.

Idempotenzschlüssel gelten organisationsweit und sind an Operation/Payload gebunden; Wiederholungen liefern die ursprüngliche Antwort ohne neue Buchung. Fehlgeschlagene Transaktionen reservieren keinen Schlüssel. Eine Bankreferenz ist zusätzlich je Organisation eindeutig, sofern sie angegeben wurde. Barzahlungen können gleiche Beträge haben; die Operations-ID ist hier die Wiederholungssperre.

Der Sprint enthält keine Kassabuchbuchung oder Buchungs-/Zahlungsstornierung. Dafür ist Sprint 2.2 zuständig, einschließlich konsistenter Gegenbuchung und Belegstatus. Es gibt keine Bearbeitungs-/Löschroute für erfasste Zahlungen. Geschäftsjahre werden vorerst durch ihre Jahreszahl referenziert; Konten und Abschlusslogik folgen in 2.2.

Zahlungsbestätigungen und Erinnerungsentwürfe werden serverseitig mit PDF-Lib erzeugt und ausschließlich autorisiert heruntergeladen. Erinnerungen werden nicht automatisch versendet. Es wird keine Signatur oder rechtliche Zertifizierung behauptet. Finanzdaten werden nicht offline persistiert.

Technische Referenzen: [PostgreSQL-Sperren](https://www.postgresql.org/docs/17/explicit-locking.html), [PDF-Lib API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).
