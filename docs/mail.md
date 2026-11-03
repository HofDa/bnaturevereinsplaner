# E-Mail und Erinnerungen

Die begonnene Schemaerweiterung für weitere Mailarten bleibt erhalten. Versandfunktionen, Einstellungen und Postausgang liefern wieder die vollständigen vereinbarten Antwortfelder. Konfigurationsdetails werden nur Admins angezeigt. Noch nicht eingerichtete Arten (unter anderem Fristenmails und Newsletter) werden vor der Versandvorbereitung ausdrücklich abgewiesen; sie werden nicht als Termineinladung verarbeitet. Bestehende Beitragserinnerungen und Termineinladungen bleiben verfügbar. Automatische Frist- und Rückgabeerinnerungen sind seit `feat/reminders` aktivierbar (siehe unten).

Die erste Kommunikationserweiterung ergänzt Beitragserinnerungen und Termineinladungen. Menü **E-Mail** (`/mail`): Nachrichtenart wählen, Vorschau mit Empfängern und Beispieltext prüfen und den Versand ausdrücklich bestätigen. Alle Nachrichten werden einzeln in der bevorzugten Sprache der Person (DE/IT) versendet. Eine Nachricht enthält keine anderen Empfängeradressen.

## Lokal testen

```sh
docker compose --profile mail up -d mailpit
bun run db:migrate
```

In `.env` `EMAIL_MODE=local` setzen und `bun run dev` neu starten. Die App bleibt auf http://localhost:5173, das Testpostfach liegt auf http://localhost:8025. Lokaler SMTP-Verkehr geht ausschließlich an `127.0.0.1:1025`; Mailpit fängt die Nachrichten ab und ist nicht als Relay konfiguriert. Es findet kein externer Versand statt. Die Docker-Ports sind an Loopback gebunden. Das Postfach ist für die lokale Entwicklung gedacht und hat kein zusätzliches Login; keine echten Vereinsdaten als Testnachrichten verwenden.

Ohne Konfiguration gilt `EMAIL_MODE=disabled`: Vorschau und Einstellungen sind verfügbar, Versand und Worker bleiben aus. Bestehende `.env`-Dateien werden durch `bun run setup` nicht überschrieben. In `.env.test` bleibt der Versand deaktiviert; nur die Mail-Browsersuite aktiviert den lokalen SMTP-Empfang. Für diese Suite muss Mailpit gestartet sein.

## Umfang und Rechte

| Funktion                                                               | Berechtigte     |
| ---------------------------------------------------------------------- | --------------- |
| Beitragserinnerungen vorbereiten, bestätigen und lesen                 | Admin, Kassier  |
| Termineinladungen vorbereiten, bestätigen und lesen                    | Admin, Vorstand |
| Automatische Beitragserinnerungen einstellen                           | Admin           |
| Zugriff einfacher Mitglieder oder Projektleitungen auf den Postausgang | keiner          |

Beitragserinnerungen berücksichtigen aktive Mitgliedschaften mit überfälligen, offenen Forderungen und gültiger E-Mail-Adresse. Es wird der aktuell offene Betrag verwendet, einschließlich Teilzahlungen und Zahlungsstornos. Bereits kontaktierte Forderungen werden während des eingestellten Mindestabstands übersprungen. Die bestehenden PDF-Erinnerungsentwürfe bleiben separat verfügbar.

Termineinladungen berücksichtigen aktive Mitglieder mit verknüpftem Vereinszugang. Die Veranstaltung muss veröffentlicht, für Mitglieder sichtbar, zukünftig und bei einer gesetzten Anmeldefrist noch offen sein. Bereits angemeldete Personen und Wartelistenplätze werden ausgelassen. Die E-Mail enthält einen Link zu den Veranstaltungsdetails; die Anmeldung erfordert weiterhin den Vereinszugang. Antwortlinks ohne Login sind nicht Bestandteil dieser Erweiterung.

Fehlende Adressen oder Vereinszugänge werden in der Vorschau gezählt. Ein Versand umfasst höchstens 250 Nachrichten. Die Vorschau wird als Hash bestätigt. Haben sich Empfänger oder Inhalt geändert, verlangt der Server eine neue Vorschau. Keine frei eingegebenen Empfängerlisten oder clientseitig übergebenen Nachrichtentexte.

## Automatische Erinnerungen

Initial ausgeschaltet. Nach Aktivierung durch einen Admin prüft der API-Worker die Organisation täglich, sobald der Server läuft. Der Mindestabstand beträgt konfigurierbar 7–90 Tage, initial 14 Tage. Die Aktivierung kann sofort einen ersten Versand auslösen; deshalb zuerst Vorschau und lokalen Mailtransport prüfen. Berechnungen der Fälligkeit verwenden die Vereinszeitzone. Maßgeblich für den Wiederholungsabstand ist der letzte Versandversuch beziehungsweise die SMTP-Annahme, nicht nur das Anlegen des Auftrags.

Gleichzeitige Schedulerläufe werden durch die Organisationssperre serialisiert. Eine gültige Adminrolle des aktivierenden Kontos ist weiterhin erforderlich. Noch wartende oder unklare Versandaufträge verhindern zusätzliche Erinnerungen für dieselbe Forderung. Deaktivieren beendet die Erzeugung weiterer automatischer Aufträge; bereits bestätigte Aufträge bleiben im Postausgang.

## Frist- und Rückgabeerinnerungen

Beide sind initial ausgeschaltet und werden von einem Admin unter E-Mail › Automatische Erinnerungen aktiviert. Der Worker prüft einmal je Tag in Vereinszeit; wie bei Beitragserinnerungen muss das aktivierende Konto weiterhin Admin sein. War der Server an einem Erinnerungstag nicht in Betrieb, wird dieser Tag nicht nachgeholt.

- **Fristen** (Art `deadline_reminder`): offene oder in Bearbeitung befindliche Fristen an den bei der Frist eingestellten Tagen davor (Standard 30 und 7), am Fälligkeitstag, am ersten Tag nach Ablauf und danach wöchentlich. Empfänger ist die zuständige Person, sonst alle Konten der zuständigen Rolle, sonst die Admins – jeweils nur mit Leserecht auf Fristen.
- **Ausleihen** (Art `loan_reminder`): nicht zurückgegebene Ausleihen zwei Tage vor dem Rückgabedatum, am ersten Tag der Überfälligkeit und danach wöchentlich, an die E-Mail-Adresse der ausleihenden Person in deren Sprache.

Vor dem Versand wird erneut geprüft: Frist noch offen und unverändert fällig beziehungsweise Ausleihe noch offen mit gleichem Rückgabedatum, Empfängeradresse unverändert. Sonst wird der Auftrag als nicht mehr erforderlich abgebrochen.

## Zusammenfassung Vereinsleben

Mitglieder können im Profil eine tägliche oder wöchentliche Zusammenfassung ungelesener News, Umfragen und Chatnachrichten abonnieren (Standard: aus). Der Worker legt fällige Zusammenfassungen ab 7 Uhr Vereinszeit als Art `community_digest` im Postausgang an; Admins sehen sie dort. Leere Zusammenfassungen werden nicht erzeugt. Details: [Vereinsleben](community.md#ungelesen-und-zusammenfassung-per-e-mail).

## Postausgang und Fehler

Migration `0012` ergänzt `mail_settings` und `mail_messages`, ohne bestehende Fachdaten umzubauen. Mandantengebundene Fremdschlüssel verhindern fremde Personen-, Veranstaltungs- und Forderungsbezüge. Idempotente Bestätigungen mit demselben Schlüssel erzeugen genau einen Auftragssatz. Versand, Abbruch und Einstellungen werden ohne Nachrichtentext oder Adressen im Audit protokolliert.

Vor jeder Übergabe werden Berechtigung, Empfängeradresse und Fachstand erneut geprüft. Inzwischen bezahlte Beiträge, veränderte Beträge, geänderte Veranstaltungsdaten, neue Anmeldungen oder entzogene Rechte brechen den veralteten Auftrag ab. Der Organisationslock serialisiert die Übergabe mit Finanz- und Rechteänderungen.

| Status                    | Bedeutung                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Wartet auf Versand        | dauerhaft gespeicherter Auftrag                                                    |
| Wird übergeben            | ein Worker hat den Auftrag exklusiv übernommen                                     |
| Vom Mailserver angenommen | SMTP-Server hat die Nachricht akzeptiert; keine Garantie für Zustellung oder Lesen |
| Abgewiesen                | der Transport hat die Nichtannahme eindeutig gemeldet                              |
| Versandstatus unklar      | Verbindungsabbruch oder Prozessende; Annahme kann bereits erfolgt sein             |
| Nicht mehr erforderlich   | Empfänger, Rechte oder Fachstand haben sich geändert                               |

Es gibt keine automatische Wiederholung fehlgeschlagener oder unklarer SMTP-Übergaben. Ein während des Versands abgestürzter Prozess hinterlässt einen nach zwei Minuten als unklar markierten Auftrag. Vor einem erneuten Versand müssen solche Fälle beim Mailanbieter geprüft werden. Eine Bearbeitungsoberfläche für die manuelle Klärung und Wiederholung ist eine Folgeaufgabe. Auch SMTP kann keine allgemeine Exactly-once-Zustellung garantieren.

Der Worker prüft alle 15 Sekunden und bearbeitet bis zu zehn Aufträge je Durchlauf. Er läuft im API-Prozess und wird vor dem Datenbankpool sauber beendet. Vertrauliche SMTP-Fehlertexte und Mailinhalte werden nicht ins Serverlog übernommen. Der Postausgang enthält personenbezogene Nachrichten; dessen Aufbewahrung und ein protokollierter Löschprozess sind vor produktiver Nutzung festzulegen.

## SMTP im Betrieb

`EMAIL_MODE=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` und gegebenenfalls zusammen `SMTP_USER`/`SMTP_PASSWORD` konfigurieren. Die Docker-Produktion reicht diese Variablen an die API weiter. Für Port 587 `SMTP_SECURE=false` mit zwingendem STARTTLS, für Port 465 `SMTP_SECURE=true`. Zertifikatsprüfung bleibt aktiv; Dateien und externe URLs können nicht als Mailinhalte nachgeladen werden. Grundlagen: [Nodemailer SMTP](https://nodemailer.com/smtp), [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/).

Ein echter Absender und die beim Anbieter erforderliche Domainkonfiguration sind vor Produktivversand einzurichten. Hier wurde ausschließlich das lokale Testpostfach verwendet. Keine externen Empfänger wurden angeschrieben.

## Weitere Kommunikation

Noch offen: Fristenmails, Newsletter und Gruppenverteiler, sichere Kontoeinladungen und Passwortwiederherstellung. Vereinsnews, Umfragen und Vereins-/Gruppenchat sind im Bereich [Vereinsleben](community.md) umgesetzt. Sportmodule gehören nicht zum vereinbarten Umfang.
