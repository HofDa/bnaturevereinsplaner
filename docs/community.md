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

Über das Smiley-Symbol neben **Senden** öffnet sich eine Emoji-Auswahl unter dem Eingabefeld; ein Emoji wird an der Cursorposition eingefügt. Emojis der Gerätetastatur funktionieren ebenso. Auf jede Nachricht kann mit 👍 ❤️ 😂 😮 🎉 🙏 reagiert werden: einmal je Konto und Emoji, erneutes Antippen nimmt die Reaktion zurück. Angezeigt werden Anzahl und, beim Darüberfahren oder für Screenreader, die Namen der Reagierenden. Nur diese sechs Reaktionen sind erlaubt; die Datenbank erzwingt die Auswahl.

**Antworten** zitiert eine Nachricht desselben Kanals; das Zitat führt zur Originalnachricht, sofern sie auf der aktuellen Seite geladen ist. Mit **@** werden Personen erwähnt, die den Kanal lesen dürfen (im Vereinskanal alle, im Gruppenkanal die Gruppenmitglieder sowie Admin und Vorstand); erwähnte Personen sehen die Nachricht hervorgehoben. Über **Teilen** wird eine kommende Veranstaltung oder eine offene Umfrage des Kanals als Karte angehängt; Gruppenumfragen lassen sich nur im eigenen Gruppenkanal teilen. Admin und Vorstand können dort auch direkt eine Umfrage anlegen; sie wird nach einer ausdrücklichen Bestätigung veröffentlicht und angehängt. Karten zeigen jedem nur, was er sehen darf; sonst erscheint ein Hinweis. Die Anmeldung erfolgt auf der Veranstaltungsseite.

Benutzer können ihre eigenen Nachrichten entfernen. Admin und Vorstand können Nachrichten im zugänglichen Kanal moderieren. Dabei werden der gespeicherte Nachrichtentext und alle Reaktionen entfernt; neue Reaktionen sind danach auch in der Datenbank gesperrt; ein Hinweis mit Autor und Zeitpunkt erhält den Gesprächsverlauf. Der Text wird nicht in Audit- oder Idempotenzantworten kopiert. Für Nachrichten gibt es keine Dateianhänge, Direktnachrichten, Lesebestätigungen, Push- oder E-Mail-Benachrichtigungen. Eine Aufbewahrungsregel und deren automatisierte Ausführung bleiben eine gesonderte Betriebsaufgabe.

## Terminfindung

Im Reiter **Terminfindung** schlagen Admin, Vorstand und Projektleitungen 2 bis 30 Termine vor, mit Titel (DE/IT), optionaler Beschreibung, Ort, Zielgruppe (Verein oder Gruppe) und optionaler Antwortfrist. Alle im Bereich geben je Termin „Ja“, „Wenn nötig“ oder „Nein“ an und können ihre Antworten bis zum Abschluss ändern. Die Antworten sind wie bei Doodle mit Namen sichtbar („Wer kann wann?“); der Termin mit den meisten Zusagen (bei Gleichstand mit den meisten „Wenn nötig“) wird als beste Option markiert. Die organisierende Person oder die Redaktion schließt die Terminfindung ab und legt optional den gewählten Termin fest. Danach – oder nach Ablauf der Frist – sind keine Antworten mehr möglich; PostgreSQL erzwingt das zusätzlich. Vorgeschlagene Termine sind nach dem Erstellen fest. Gruppenzugang und Mandantenbezug gelten wie bei News und Umfragen. Eine automatische Übernahme des festgelegten Termins als Veranstaltung ist noch nicht enthalten.

## Ungelesen und Zusammenfassung per E-Mail

Neue News, Umfragen und Chatnachrichten anderer Personen werden als Zahl an **Vereinsleben** in der Navigation, an den Reitern und im Kanalwähler des Chats angezeigt. In der installierten App erscheint die Zahl zusätzlich am App-Symbol, sofern das Gerät dies unterstützt. Gezählt werden der Vereinskanal und die aktiven Gruppen, denen das eigene Konto über die verknüpfte Person angehört. Admin und Vorstand können weitere Gruppen öffnen, erhalten dafür aber keine Markierungen. Eigene Beiträge, Entwürfe und entfernte Nachrichten zählen nicht. Für neue Konten beginnt die Zählung mit dem Zeitpunkt des Vereinszugangs.

Ein Chatkanal gilt als gelesen, sobald seine neuesten Nachrichten bei sichtbarer Seite angezeigt wurden. News und Umfragen gelten als gelesen, wenn die ungefilterte erste Seite des Reiters angezeigt wurde. Die Lesemarke wandert nur vorwärts.

Im **Profil** kann jedes Konto eine **Zusammenfassung per E-Mail** wählen: aus (Standard), täglich oder wöchentlich. Der Server prüft ab 7 Uhr Vereinszeit, ob ein Tag beziehungsweise eine Woche seit der letzten Zusammenfassung vergangen ist. Die E-Mail nennt Titel neuer News und Umfragen sowie die Anzahl neuer Chatnachrichten je Kanal, aber keine Chattexte. Bereits gelesene Inhalte und Zeiträume ohne Neuigkeiten erzeugen keine E-Mail. Die Zusammenfassung läuft über den normalen Postausgang (Art `community_digest`); vor dem Versand werden Vereinszugang, Einstellung und Adresse erneut geprüft. Ist der E-Mail-Versand ausgeschaltet, wird die Einstellung gespeichert, aber nichts versendet.

## Technik und Prüfung

Migration `0015` ergänzt Beiträge, Umfrageoptionen und Stimmen einschließlich SQL-Triggern; `0016` ergänzt Chatnachrichten, `0018` Chatreaktionen, `0019` Lesemarken, Zusammenfassungseinstellungen und die Mailart `community_digest`, `0022` Antworten, Erwähnungen und Karten, `0023` Terminfindungen. Migration `0014` stammt aus der vorausgehenden Mail-Schemaerweiterung. Beim Merge mit Inventar (`0013`) wurden die Dateinummern vereinheitlicht; SQL-Inhalte und bereits angewendete Zeitstempel bleiben erhalten. Migration `0017` ergänzt die jeweils fehlenden Module bei Datenbanken aus beiden Branches, ohne vorhandene Daten zurückzusetzen. Die Zeitstempel der historischen Einträge sind deshalb nicht streng aufsteigend und dürfen nicht nachträglich verändert werden. Schreiboperationen sind über `Idempotency-Key` wiederholbar; Redaktion und Moderation prüfen zusätzlich die Version. Die Organisations- und Gruppenrechte werden serverseitig erneut geprüft. Private Inhalte erhalten `no-store` und werden nicht für Offline-Nutzung zwischengespeichert.

Gemeinsame Verträge stehen in `packages/contracts/src/community.ts`, Endpunkte unter `/api/v1/community`. Die Browserprüfung läuft auf Desktop und Mobil mit `bun run test:e2e community`. Sie prüft Veröffentlichung, DE/IT, Mitgliederansicht, Abstimmung mit Änderung und Abschluss, Gruppenzugriff, Chat und Moderation sowie Axe-Regeln. Details der tatsächlich ausgeführten Prüfungen stehen in [Prüfnachweise](verification.md).
