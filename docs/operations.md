# Betrieb

## Konfiguration

Bun 1.3.14 ist in `.bun-version`, `packageManager`, CI und Dockerfiles gepinnt. Abhängigkeiten sind exakt versioniert, `bun.lock` gehört ins Repository. Installation in CI/Containern mit `--frozen-lockfile`. PostgreSQL 17 und Caddy 2 erhalten über ihre Major-Tags Sicherheitsaktualisierungen; vor Releases Images prüfen und bei Bedarf auf geprüfte Digests fixieren.

Lokale Ports: Web 5173, API 3000, PostgreSQL 55439. Tests: Web 5174, API 3002, PostgreSQL 55440. Produktionszugriff erfolgt über Caddy auf 80/443; Datenbank ist nur an Loopback gebunden und API nur im Compose-Netz erreichbar.

`AUTH_SECRET` muss unabhängig vom Datenbankpasswort und mindestens 32 Zeichen lang sein. Hex-Zufallswerte vermeiden zusätzlich URL-Escaping-Probleme in `DATABASE_URL`. `APP_URL` ist der exakte Browserursprung. Produktionsmodus erlaubt nur eine öffentliche HTTPS-Adresse. SQLite, externe Auth-SaaS, öffentliche Registrierung und unsichere Entwicklungs-Logins sind nicht vorhanden.

## Release

1. Tests und Build ausführen, SQL prüfen, aktuelle Sicherung erstellen.
2. `docker compose --profile production build`.
3. `docker compose --profile production up -d` startet Migration als separaten Dienst und anschließend die API; Fehler der Migration blockieren deren Start.
4. `docker compose --profile production ps` sowie `/api/v1/health` prüfen, anmelden und einen lesenden Smoke-Test ausführen.
5. Migrationsdienst bei späteren Releases bei Bedarf explizit erneut starten: `docker compose --profile production run --rm migrate`, erst danach neue API-Version starten. Der normale Serverstart verändert das Schema nicht.

Für Änderungen mit Schema-Inkompatibilität Wartungsfenster und abgestimmtes Schema-/Code-Rollback planen. Eine alte Container-Version ist bei destruktiver Migration allein kein ausreichender Rollback.

## Backups und Wiederherstellung

Ein Datenbankdump kann ohne Passwort in der Kommandozeile erstellt werden:

```sh
mkdir -p .local/backups
docker compose exec -T postgres pg_dump -U bnature -d bnature -Fc > .local/backups/bnature.dump
```

Das Volume `documents_data` (Produktions-Compose, im Container `/var/lib/bnature/documents`) enthält die privaten Dokumentdateien und muss **im selben Sicherungslauf** wie die Datenbank gesichert werden, z. B.:

```sh
docker run --rm -v bnature_documents_data:/data:ro -v "$PWD/.local/backups:/backup" alpine tar -czf /backup/documents.tar.gz -C /data .
```

Datenbank ohne Dateien oder Dateien ohne Datenbank sind unvollständig; Downloads prüfen den gespeicherten SHA-256 und liefern abweichende Dateien nicht aus. Wiederherstellung beider Teile gemeinsam testen.

Dump verschlüsselt auf einem getrennten System aufbewahren; Zugriff und Aufbewahrung begrenzen. `.local` ist nur eine lokale Arbeitsablage, kein Backupkonzept. Regelmäßig Wiederherstellung in einer isolierten Datenbank testen, Datensatzanzahlen und Anmeldung prüfen. Das Rückspielen überschreibt Daten und wird deshalb nicht als automatischer Standardstart ausgeführt. `pg_restore` nur nach Auswahl der richtigen Zielinstanz und geplanter Sicherung anwenden. Auch Serverkonfiguration, Secrets und Caddy-Daten gehören in ein getrennt gesichertes Betriebskonzept.

## Überwachung

`/api/v1/health` prüft eine echte Datenbankabfrage und enthält keine Personendaten. Strukturierte API-Logs verwenden Anfrage-IDs und interne Codes. Rate-Limits sind pro Prozess; horizontale Skalierung benötigt eine gemeinsame Zählung. Speicher, Datenbankverbindungen, Laufzeiten, Fehlerraten, Backupalter und Zertifikatserneuerung überwachen. Es werden standardmäßig keine Zugriffslogs mit query strings oder personenbezogenen Request-Bodies aktiviert.

## Entwicklung und Testbereinigung

`docker compose stop postgres` stoppt den Entwicklungsdienst ohne Datenverlust. `docker compose --profile test stop postgres-test` stoppt die Testdatenbank. Ihr Datenverzeichnis ist tmpfs und nicht dauerhaft. `docker compose down -v` würde auch Entwicklungs-/Produktionsdaten löschen und ist kein regulärer Bereinigungsbefehl. Tests benutzen ausschließlich `bnature_test` und dürfen nicht parallel gegen dieselbe Instanz laufen.

Anfangszugänge und synthetische Beispieldatensätze werden ausschließlich von Tests erzeugt. Die Entwicklungsdatenbank startet leer. Über den Bootstrap eingegebene Kontaktdaten werden nicht automatisch mit einem Personendatensatz verbunden; diese Trennung ist beabsichtigt.
