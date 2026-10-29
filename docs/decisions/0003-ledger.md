# ADR 0003 – Kassabuch, Storno und Berichte

Status: angenommen. Sprint 2.2, 30.10.2026.

Das Kassabuch ist eine einfache Einnahmen-/Ausgabenrechnung je Konto, keine doppelte Buchführung. Das entspricht dem Bedarf kleiner Vereine und einer Rechnungslegung nach dem Kassenprinzip. Ein Kontenplan oder Bilanzpositionen sind nicht Teil dieses Moduls.

Geschäftsjahre sind Kalenderjahre. Das Buchungsdatum bestimmt das Jahr (CHECK-Constraint). Jahre werden einmal eröffnet und einmal endgültig geschlossen. Geschlossene Jahre nehmen keine Buchungen an; Korrekturen werden im offenen Folgejahr gebucht, damit abgeschlossene Berichte stabil bleiben. Endbestände werden aus Anfangsbeständen und Buchungen berechnet, nicht gespeichert; geschlossene Jahre ändern sich nicht mehr, daher bleiben die Werte stabil.

Buchungen sind unveränderlich. Ein Storno ist eine eigene Buchung mit negativem Betrag in derselben Richtung und Kategorie wie das Original. Dadurch bleiben Einnahmen und Ausgaben getrennt summierbar, ohne dass ein Storno einer Einnahme als Ausgabe erscheint.

Beitragszahlungen bleiben Zahlungsereignisse aus Sprint 2.1. Eine Zahlung wird höchstens einmal als Einnahme verbucht (partieller Unique-Index). Manuelle Buchungen in Beitragskategorien sind gesperrt, damit Beiträge nicht doppelt als Einnahme erscheinen. Ein Zahlungsstorno ist eine eigene unveränderliche Zeile. Stornierte Zahlungen zählen für Forderungen nicht mehr. Eine verbuchte Zahlung kann nur zusammen mit ihrer Kassabuch-Gegenbuchung storniert werden; ein verzögerter Constraint-Trigger erzwingt das am Commit. Die Bankreferenz-Eindeutigkeit ignoriert stornierte Zahlungen und ist deshalb ein Trigger unter der Organisationssperre statt eines Index.

Berichtsvorlagen sind vom Verein konfigurierte, versionierte Gliederungen. Jede Änderung ist eine neue unveränderliche Version; Berichte referenzieren eine konkrete Version und bleiben reproduzierbar. Es werden bewusst keine amtlichen ETS-Modelle oder Schwellenwerte vorbelegt, weil deren aktueller Stand fachlich und rechtlich validiert werden muss (siehe Roadmap).

Den Jahresabschluss darf nur ein Administrator ausführen (`finance:close`); der Kassier bereitet vor. Alle Schreiboperationen nutzen die Idempotenz und Organisationssperre aus ADR 0002.
