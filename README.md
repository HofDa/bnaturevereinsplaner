# b*nature Vereinsplattform

Selbst gehostete, zweisprachige PWA für die Vereinsverwaltung. Phase 1 enthält Anmeldung, Rollenrechte, Dashboard, Mitglieder, Gruppen und Zuordnungen, Vorstand mit Amtszeiten, Vereinsprofil, Benutzerverwaltung, persönliches Profil und Audit-Protokoll. Personen können ohne Benutzerkonto existieren. Sprint 2.1 ergänzt Mitgliedsbeiträge: Tarife, Forderungen, Zahlungen mit Zuordnung, PDF-Bestätigungen und Erinnerungsentwürfe ([Sprint 2.1](docs/sprints/2.1-implementation.md)). Sprint 2.2 ergänzt Konten, Geschäftsjahre, ein unveränderliches Kassabuch mit Storno, die Verbuchung und das Storno von Beitragszahlungen sowie Jahresberichte mit vereinseigenen Berichtsvorlagen ([Sprint 2.2](docs/sprints/2.2-implementation.md)).

## Lokal starten

Voraussetzungen: **Bun 1.3.14**, Docker mit Compose, aktuelle Chrome-/Chromium-Version für Browserprüfungen. Node 24 LTS wird für die Werkzeugkette empfohlen.

```sh
bun install --frozen-lockfile
bun run setup
# Erzeugt .env und .env.test mit zufälligen Secrets; vorhandene Dateien bleiben erhalten.
docker compose up -d --wait postgres
bun run db:migrate
bun run bootstrap
# Namen und E-Mail im Terminal eingeben. Das zufällig erzeugte Passwort erscheint einmalig.
bun run dev
```

Oberfläche: **http://localhost:5173**. API: http://localhost:3000/api/v1/health. Entwicklungsdokumentation: http://localhost:3000/api/docs. Es gibt keine voreingestellten Zugangsdaten und keine öffentliche Registrierung. Das erste Administratorkonto wird ausschließlich über den lokalen Bootstrap-Befehl angelegt. Danach weitere Zugänge unter „Benutzerverwaltung“ einrichten und Anfangspasswörter sicher übergeben.

Der Bootstrap erzeugt genau eine neue Organisation und einen Administrator in einer Transaktion. Bereits bestehende Organisations-Slugs werden abgewiesen; parallele Bootstrap-Versuche werden serialisiert. Für nichtinteraktive Einrichtung `BOOTSTRAP_NAME`, `BOOTSTRAP_EMAIL`, optional `BOOTSTRAP_PASSWORD`, `BOOTSTRAP_ORGANIZATION` und `BOOTSTRAP_SLUG` über eine sichere Prozessumgebung bereitstellen. Passwörter nicht in Shell-History oder Kommandozeilen schreiben. Bootstrap-Variablen anschließend entfernen.

## Prüfungen

```sh
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run build
bun run openapi

docker compose --profile test up -d --wait postgres-test
bun run test:integration
bunx playwright install chromium  # entfällt bei lokal vorhandenem Google Chrome
bun run test:e2e
```

Integrationstests und E2E-Tests verwenden ausschließlich die Datenbank **bnature_test** auf Port **55440**. Sie setzen deren Daten zurück und müssen nacheinander laufen. Desktop und Mobilprojekt starten bewusst getrennte API-Prozesse, damit die Rate-Limits auch bei der schnellen Gesamtprüfung aktiv bleiben, ohne die Anfragen beider künstlicher Nutzungsreihen zu addieren. Die Suite verweigert andere Datenbanknamen und benötigt `NODE_ENV=test`. PostgreSQL-Tests prüfen echte Better-Auth-Sessions, Transaktionen, Constraints, Statuswechsel und organisationsübergreifende Zugriffe. Playwright prüft Desktop und Mobilformat einschließlich Offline-App-Shell; Testdaten sind ausdrücklich synthetisch. `CHROME_PATH` kann einen anderen Chromium-Pfad angeben. CI installiert den passenden Playwright-Browser.

`bun run format` formatiert Quellcode und Dokumentation. Änderungen an Drizzle-Schemas: `bun run db:generate`, die erzeugte SQL-Migration prüfen und versionieren, dann `bun run db:migrate`. Der API-Server verändert beim Start kein Schema.

## Produktion mit eigenem Server

1. `.env` anhand `.env.example` einrichten. Unabhängige zufällige Secrets verwenden, `DOMAIN` auf den eigenen Hostnamen und `APP_URL` auf dessen HTTPS-URL setzen. DNS und Ports 80/443 müssen zum Server zeigen. PostgreSQL bleibt auf Loopback gebunden; der API-Port wird nicht veröffentlicht.
2. Datenbanksicherung erstellen; Migrationen vor einem Versionswechsel prüfen.
3. `docker compose --profile production up -d --build` ausführen. Ein separater einmaliger Migrationsdienst muss erfolgreich enden, bevor die API startet. Der API-Start selbst migriert nicht.
4. Erstkonto im API-Container anlegen:

   ```sh
   docker compose --profile production exec -it api bun apps/api/src/services/bootstrap.ts
   ```

5. Caddy liefert die PWA und leitet `/api/*` intern an Fastify weiter; Zertifikate werden automatisch verwaltet. `APP_URL` muss genau dem öffentlichen Ursprung entsprechen. `TRUST_PROXY=true` ist nur hinter dem eigenen Caddy vorgesehen.

Die Containerkonfiguration enthält sichere Cookies unter HTTPS, Security-Header, Origin-Prüfung und Rate-Limits. Produktionsdaten und Secrets gehören weder ins Repository noch in Images. Für regelmäßige verschlüsselte Backups und getestete Wiederherstellung siehe [Betrieb](docs/operations.md). Ein öffentlicher Produktivserver wurde durch diese Entwicklung nicht eingerichtet.

## Architektur und Grenzen

- [Architektur](docs/architecture.md), [Datenmodell](docs/database.md), [Sicherheit und Rollen](docs/security.md)
- [OpenAPI](docs/api/openapi.json), [API-Konventionen](docs/api/README.md)
- [Roadmap](docs/roadmap.md), [Tickets](docs/sprints/tickets.md), Entscheidungen [0001](docs/decisions/0001-foundation.md), [0002](docs/decisions/0002-membership-fees.md) und [0003](docs/decisions/0003-ledger.md)
- [Prüfnachweise](docs/verification.md)

In Phase 1 speichert die PWA ausschließlich statische App-Dateien und nichtpersonenbezogene Shell-Metadaten dauerhaft. Mitglieder- und Sitzungsdaten werden weder in Service-Worker-Caches noch in IndexedDB persistiert. Für die Administration ist eine Verbindung zum Server notwendig. CSV-Exporte enthalten personenbezogene Daten und werden bewusst als Datei heruntergeladen.

CSV-Import: UTF-8, Kopfzeile mit technischen Feldnamen, Komma oder Semikolon, maximal 1.000 Zeilen / 2 MB. Vorlage in der Oberfläche herunterladen. Vorschau und Bestätigung sind verpflichtend. Gültige Zeilen werden einzeln transaktional angelegt, erfolgreiche Zeilen bei einem Wiederholungsversuch innerhalb desselben Dialogs übersprungen. Der Import ist nicht als Gesamtdatei atomar; Fehler und bereits gespeicherte Zeilen werden angezeigt. Wiederholter Import derselben Mitgliedsnummer wird durch die Datenbank abgewiesen.

Private Dokumente, Termine, Freiwilligenregister und Compliance sind als Erweiterungen (Sprints 2.2b–2.4) dokumentiert und noch nicht implementiert. Erfasste Zahlungen und Buchungen werden nie bearbeitet, sondern ausschließlich storniert. Das Kassabuch ist eine Einnahmen-/Ausgabenrechnung, keine doppelte Buchführung. Die Anwendung stellt keine rechtliche Zertifizierung aus. Anforderungen an ETS-Rechnungslegung, Register, Aufbewahrung und RUNTS müssen vor produktiver Verwendung der jeweiligen Erweiterung gesondert validiert werden. WCAG 2.2 AA ist das Entwicklungsziel; automatisierte Prüfungen ersetzen keine vollständige Prüfung mit assistiven Technologien.

Die Umsetzung ist eigenständig. AlpsPlanner dient ausschließlich als vom Auftraggeber genannter fachlicher Vergleich; proprietärer Quellcode, Designs oder interne APIs werden nicht verwendet.
