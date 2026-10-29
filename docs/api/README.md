# REST API v1

Die versionierte [OpenAPI-Spezifikation](openapi.json) wird mit `bun run openapi` aus Fastify-/Zod-Verträgen generiert. Entwicklungs-Swagger-UI: `/api/docs`; Produktion deaktiviert. Authentifizierung liegt separat unter `/api/auth` und wird von Better Auth verwaltet.

## Konventionen

Alle fachlichen Endpunkte haben Präfix `/api/v1`. Ausnahme für Authentifizierung: `/api/auth/sign-in/email`, `/sign-out`, `/get-session`, `/change-password`, `/update-user` und Sitzungsverwaltung. Andere Auth-Endpunkte sind nicht veröffentlicht. Health ist öffentlich, Fachendpunkte erfordern ein gültiges Cookie. HttpOnly-Cookies werden nicht vom Frontend gelesen.

`X-Organization-Id: <UUID>` wählt eine Organisation, für die das Benutzerkonto eine aktuelle Rolle besitzt. Ohne Header wird deterministisch die erste berechtigte Organisation gewählt; `/me` liefert diesen Kontext und alle erlaubten Organisationen. Ein Body-Feld ersetzt niemals diesen Kontext. Jede Mutation benötigt `Origin` mit dem exakten konfigurierten `APP_URL`-Ursprung. Keine tokenbasierte oder Cross-Origin-API-Freigabe in Phase 1.

Listen: `page` ab 1, `pageSize` 1–100 (Standard 20), `search` bis 100 Zeichen, `sort=name|createdAt|joinedAt`, `direction=asc|desc`. Mitglieder unterstützen `status=active|pending|inactive|resigned`; Gruppen `active=true|false`. Antwort: `{ items, total, page, pageSize }`. Stabile ID als sekundäre Sortierung. Mitglieder sortieren nach angefordertem Feld; Gruppen nach Name/Erstellung, Mandate nach Amtsbeginn, Audit nach Zeitpunkt, Benutzer nach Name. Nicht anwendbare allgemeine Sortierfelder werden bei diesen Modulen auf das dokumentierte Hauptfeld abgebildet.

Einzelne fremde oder unbekannte IDs: 404. Fehlende Sitzung: 401. Unberechtigte Rolle oder Organisationswahl: 403. Eingabe-/Statusfehler: 422. Eindeutigkeitskonflikt bzw. letzter Administrator: 409. Zu viele Anfragen: 429. JSON-Fehlerformat: `{ error: { code, message, requestId, fields? } }`. Better-Auth-Endpunkte verwenden deren eigenes Fehlerformat. Personendaten erhalten immer `Cache-Control: no-store`.

PATCH akzeptiert ausschließlich gelieferte bekannte Felder ohne create-Defaults. Der Service lädt den aktuellen Datensatz, sperrt ihn bei Bedarf und validiert die zusammengeführte Fassung. UUIDs und Zeitstempel werden serverseitig erzeugt, Kalenderdaten als `YYYY-MM-DD`, UTC-Zeitpunkte als ISO-8601 serialisiert.

## Endpunkte

| Methode / Pfad               | Zweck                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------- |
| GET /health                  | Status einschließlich DB-Verbindung                                          |
| GET /me                      | Konto, Organisationen, aktuelle Rolle und Berechtigungen                     |
| GET/PATCH /organizations/:id | Eigenes Vereinsprofil                                                        |
| GET/POST /members            | Mitgliederliste / Person und Mitgliedschaft transaktional anlegen            |
| GET/PATCH /members/:id       | Mitgliedschafts-ID mit Personendaten; Änderungen transaktional               |
| GET/POST /groups             | Gruppenliste / Anlage                                                        |
| GET/PATCH /groups/:id        | Gruppe / Metadatenänderung                                                   |
| PUT /groups/:id/members      | Gesamte Zuordnung durch `{ personIds: UUID[] }` ersetzen; max. 500           |
| GET/POST /board-mandates     | Amtszeiten / Anlage                                                          |
| PATCH /board-mandates/:id    | Funktion oder Zeitraum ändern                                                |
| GET /audit-logs              | Organisationsbezogenes Audit-Protokoll                                       |
| GET /dashboard               | Echte Aggregate, neue Mitglieder im laufenden UTC-Monat und aktuelle Mandate |
| GET/PATCH /profile           | Ausschließlich eigenes verknüpftes Personenprofil                            |
| GET/POST /users              | Berechtigte Konten anzeigen / geschlossen bereitstellen                      |
| PATCH /users/:id/role        | Organisationsrolle ändern; letzten Admin erhalten                            |

`members.id` ist die Mitgliedschafts-ID, `personId` die getrennte Personen-ID. Gruppen und Mandate referenzieren `personId`. Normale Benutzerkonten werden nicht automatisch Vereinsmitglieder. Die Benutzeranlage kann optional eine bereits zur eigenen Organisation gehörende Person verknüpfen. Das Initialkonto wird ausschließlich über `bun run bootstrap` angelegt.

CSV-Vorschau/-Parsing findet im Browser statt. Der Export lädt die gefilterte Liste seitenweise; er ist keine konsistente Gesamtdatenbankaufnahme über mehrere Seiten. Importierte Zeilen werden über dieselben geprüften Mitglieder-Endpunkte angelegt und auditisiert. Fehlgeschlagene Zeilen bleiben nachvollziehbar sichtbar.
