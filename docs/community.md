# Vereinsleben: News, Umfragen und Chat

Unter **Vereinsleben** (`/community`) gibt es die Bereiche **News**, **Umfragen** und **Vereinschat**. Alle Konten mit Vereinszugang können veröffentlichte Vereinsinhalte lesen, abstimmen und am Chat teilnehmen. Admin und Vorstand verwalten Veröffentlichungen und moderieren den Chat.

## Verein und Gruppen

Ohne Gruppenzuordnung gilt ein Beitrag für den ganzen Verein. Gruppeninhalte sind für normale Benutzer nur sichtbar, wenn ihr Konto über eine Person mit dieser aktiven Gruppe verknüpft ist. Die Zuordnung erfolgt über Benutzerverwaltung und Gruppenverwaltung. Ein Kontoinhaber ohne verknüpfte Person kann Vereinsinhalte nutzen, erhält dadurch aber keinen Gruppenzugang. Admin und Vorstand können Gruppeninhalte zur Verwaltung lesen.

Diese Regeln gelten serverseitig für Listen, direkte Detailadressen, Abstimmung und Chat. Ein Wechsel der URL oder eine fremde Gruppen-ID erweitert den Zugriff nicht. Eine entfernte Gruppenzuordnung oder deaktivierte Gruppe beendet den normalen Gruppenzugang bei der nächsten Abfrage. Bereits geladene Inhalte werden nicht aus fremden Screenshots oder außerhalb der Anwendung gespeicherten Kopien entfernt.

## News

Admin oder Vorstand erstellen einen zweisprachigen Entwurf mit Titel, Nachricht und Zielgruppe. **Entwurf speichern** veröffentlicht noch nicht; erst **Veröffentlichen** mit Bestätigung macht den Beitrag sichtbar. Angeheftete Beiträge erscheinen zuerst. Veröffentlichte News können mit Versionsprüfung korrigiert werden; der Empfängerkreis bleibt fest. Archivieren blendet sie für Mitglieder aus. Der Text wird als Text dargestellt, ohne ausführbares HTML.

## Umfragen

Eine Umfrage besteht aus Frage, optionaler Beschreibung und zwei bis zehn unterschiedlichen Antwortmöglichkeiten auf Deutsch und Italienisch. Optional kann ein Ende in der Ortszeit des verwendeten Geräts gewählt werden. Der Server speichert den absoluten Zeitpunkt. Ohne Frist wird die Umfrage manuell geschlossen.

Pro Benutzerkonto ist genau eine Antwort zulässig. Bis zum Abschluss kann die eigene Stimme geändert werden; sie wird dabei ersetzt und nicht als zusätzliche Stimme gezählt. Frage, Antworten, Zielgruppe, Frist und Ergebnisregel sind nach Veröffentlichung fest. Ein Abschluss ist endgültig. Die Datenbank erzwingt zusätzlich Wahlmöglichkeiten, Mandantenbezug, Einmaligkeit und die Sperre nach Abschluss oder Fristablauf.

Ergebnisse werden entweder nach der eigenen Abstimmung oder erst nach Abschluss angezeigt. Vorher enthält die API keine Stimmzahlen, auch nicht für Admins. Nach Abschluss sind zusammengefasste Ergebnisse für den berechtigten Bereich sichtbar. Es wird keine Liste mit Namen der Abstimmenden veröffentlicht. Die Stimme ist intern kontogebunden; es handelt sich nicht um eine technisch anonyme Abstimmung. Ein inzwischen ausgeschiedenes Gruppenmitglied erhält keinen weiteren Ergebniszugriff; eine zuvor gültig abgegebene Stimme bleibt in der Gesamtauswertung.

## Vereinschat

Der Chat hat einen Kanal für den ganzen Verein und je einen Kanal für aktive Gruppen. Nachrichten bestehen aus Text bis 2000 Zeichen. Neue Nachrichten erscheinen in der geöffneten aktuellen Ansicht innerhalb weniger Sekunden. Ältere Nachrichten können in Abschnitten zu 50 Nachrichten aufgerufen werden; **Zu den neuesten Nachrichten** führt zurück zur laufenden Ansicht. Senden ist auch mit Strg/⌘+Enter möglich; Enter allein erzeugt einen Zeilenumbruch.

Benutzer können ihre eigenen Nachrichten entfernen. Admin und Vorstand können Nachrichten im zugänglichen Kanal moderieren. Dabei wird der gespeicherte Nachrichtentext entfernt; ein Hinweis mit Autor und Zeitpunkt erhält den Gesprächsverlauf. Der Text wird nicht in Audit- oder Idempotenzantworten kopiert. Für Nachrichten gibt es keine Anhänge, Direktnachrichten, Lesebestätigungen, Push- oder E-Mail-Benachrichtigungen. Eine Aufbewahrungsregel und deren automatisierte Ausführung bleiben eine gesonderte Betriebsaufgabe.

## Technik und Prüfung

Migration `0015` ergänzt Beiträge, Umfrageoptionen und Stimmen einschließlich SQL-Triggern; `0016` ergänzt Chatnachrichten. Migration `0014` stammt aus der vorausgehenden Mail-Schemaerweiterung. Beim Merge mit Inventar (`0013`) wurden die Dateinummern vereinheitlicht; SQL-Inhalte und bereits angewendete Zeitstempel bleiben erhalten. Migration `0017` ergänzt die jeweils fehlenden Module bei Datenbanken aus beiden Branches, ohne vorhandene Daten zurückzusetzen. Die Zeitstempel der historischen Einträge sind deshalb nicht streng aufsteigend und dürfen nicht nachträglich verändert werden. Schreiboperationen sind über `Idempotency-Key` wiederholbar; Redaktion und Moderation prüfen zusätzlich die Version. Die Organisations- und Gruppenrechte werden serverseitig erneut geprüft. Private Inhalte erhalten `no-store` und werden nicht für Offline-Nutzung zwischengespeichert.

Gemeinsame Verträge stehen in `packages/contracts/src/community.ts`, Endpunkte unter `/api/v1/community`. Die Browserprüfung läuft auf Desktop und Mobil mit `bun run test:e2e community`. Sie prüft Veröffentlichung, DE/IT, Mitgliederansicht, Abstimmung mit Änderung und Abschluss, Gruppenzugriff, Chat und Moderation sowie Axe-Regeln. Details der tatsächlich ausgeführten Prüfungen stehen in [Prüfnachweise](verification.md).
