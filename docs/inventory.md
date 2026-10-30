# Inventar und Ausleihe

Menü **Inventar** (`/inventory`): Gegenstände des Vereins mit Zustand und Bestand sowie Ausleihen mit Rückgabedatum und Rückgabe. Die Daten liegen mandantengetrennt in der bestehenden Datenbank; es gibt keine Löschfunktion.

## Gegenstände

Ein Eintrag beschreibt ein Einzelstück oder einen Sammelbestand gleichartiger Gegenstände (z. B. 20 Warnwesten) mit Stückzahl. Felder: Bezeichnung, optionale Inventarnummer (je Verein eindeutig, sofern vergeben), frei wählbare Kategorie, Lagerort, Zustand (neu, gut, abgenutzt, beschädigt, defekt), Anschaffungsdatum, optionaler Stückwert, Beschreibung und Notiz.

Liste mit Suche (Bezeichnung, Nummer, Lagerort, Beschreibung), Filtern nach Kategorie, Zustand, Verfügbarkeit (verfügbar, ausgeliehen, überfällig) und Status. Kennzahlen: Gegenstände und Stück, verliehene Stück, offene und überfällige Ausleihen, beschädigte/defekte Gegenstände und erfasster Wert. CSV-Export (DE/IT, Semikolon, UTF-8 mit BOM, Tabellenformeln neutralisiert).

**Ausmustern** statt Löschen: mit Datum und Grund, nur ohne offene Ausleihen. Ausgemusterte Gegenstände bleiben mit Historie sichtbar (Filter „ausgemustert“), können aber weder bearbeitet noch verliehen werden.

## Ausleihen

Ausleihende sind Personen aus dem Personenstamm: Mitglieder, Freiwillige oder erfasste Gäste ohne Mitgliedschaft. Eine Ausleihe hält Gegenstand, Person, Stückzahl, Ausgabe- und Rückgabedatum, Zustand bei Ausgabe und Notiz fest.

- **Bestandsregel:** Offene Ausleihen binden nie mehr Stück als vorhanden. Die API sperrt den Gegenstand während der Prüfung; ein Datenbanktrigger prüft dieselbe Regel auch für direkte SQL-Änderungen. Gleichzeitige Ausleihen des letzten Stücks führen zu genau einer erfolgreichen Ausleihe.
- **Überfällig** ist eine offene Ausleihe, deren Rückgabedatum vor dem heutigen Datum in der Zeitzone des Vereins liegt.
- **Verlängern** ändert nur Rückgabedatum und Notiz.
- **Rückgabe** mit Datum (nicht vor der Ausgabe, nicht in der Zukunft), Zustand und Bemerkung. Bei Einzelstücken übernimmt der Gegenstand den Rückgabezustand. Bei Sammelbeständen bleibt der Gesamtzustand; Schäden einzelner Stücke werden in der Bemerkung festgehalten. Eine Teilrückgabe wird als getrennte Ausleihen erfasst.
- Zurückgegebene Ausleihen sind abgeschlossen und unveränderlich. Bestand, Ausgabedaten und Person einer Ausleihe sind nach dem Anlegen nicht änderbar.

Alle Schreibvorgänge sind idempotent (Operationsschlüssel), versioniert (409 bei veraltetem Stand) und werden ohne personenbezogene Inhalte im Aktivitätsprotokoll vermerkt.

## Rechte

| Funktion                                              | Berechtigte                                             |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Inventar und Ausleihen lesen, CSV                     | Admin, Vorstand, Kassier, Projektleitung                |
| Gegenstände anlegen, bearbeiten, ausmustern           | Admin, Vorstand                                         |
| Ausleihen, verlängern, Rückgabe erfassen              | Admin, Vorstand, Projektleitung                         |
| Eigene offene Ausleihen im Profil („Meine Ausleihen“) | jede angemeldete Person mit verknüpftem Personeneintrag |

Die Personenauswahl beim Ausleihen liefert nur ID, Name und Mitgliedsstatus.

## Grenzen und Folgeaufgaben

- Keine automatischen Rückgabeerinnerungen per E-Mail; Anbindung an den Postausgang nach Abschluss der E-Mail-Erweiterung.
- Keine Reservierungen, Fotos, Wartungsintervalle oder Prüfprotokolle (z. B. für sicherheitsrelevante Ausrüstung).
- Stückwert dient der internen Übersicht; keine Abschreibung oder Verbindung zum Kassabuch.
