# Sicherheit

## Authentifizierung

Better Auth verwaltet Passwörter, Hashing, Sitzungen und Cookies; Drizzle persistiert das Auth-Schema in PostgreSQL. Der Webserver verwendet `disableSignUp: true` und eine zusätzliche Allowlist für veröffentlichte Auth-Endpunkte. Die nur lokal/intern verwendete Provisionierungsinstanz kann Konten für den Bootstrap und authentifizierte Administratoren anlegen; sie wird niemals als HTTP-Handler gemountet.

Cookies sind HttpOnly und SameSite=Lax. In Produktion erzwingt die Konfiguration HTTPS und Secure-Cookies. Sitzungen laufen nach sieben Tagen ab und werden frühestens nach einem Tag verlängert. Der Better-Auth-Cookie-Cache ist deaktiviert. Autorisierung liest aktuelle Organisationsrollen bei jeder Fachanfrage; ein Rollenentzug braucht keinen Sitzungscache-Ablauf. Passwortwechsel nutzt Better Auth und kann andere Sitzungen widerrufen.

## Origin, CSRF und Netzwerk

Alle zustandsändernden API-/Auth-Anfragen benötigen einen exakt passenden `Origin`; `Sec-Fetch-Site: cross-site` wird abgewiesen. Zusätzlich bleiben Better Auths Origin-/CSRF-Prüfungen aktiv. Browser und API verwenden denselben Ursprung; es gibt keine offene CORS-Freigabe. Content-Type-Parsing und Zod begrenzen Eingaben. Maximale Bodygröße: 256 KiB. CSV-Dateien werden im Browser auf 2 MB / 1.000 Zeilen begrenzt und als einzelne validierte API-Anfragen übertragen.

Fastify begrenzt Anfragen pro IP auf 150/Minute, Auth-Endpunkte auf 20/Minute und Anmeldeversuche zusätzlich auf 10/Minute. Kontoanlage ist auf 10/Minute beschränkt. Limiter speichern ihren Zustand lokal im API-Prozess: Phase 1 betreibt eine API-Instanz. Mehrere Replikas erfordern vor Skalierung ein gemeinsames Rate-Limit-Backend. Die Rate-Limit-Konfiguration bleibt auch in Tests aktiv.

`TRUST_PROXY=true` ist nur im internen Docker-Netz hinter Caddy vorgesehen. Die API besitzt im Produktions-Compose keinen veröffentlichten Port. Wer die API anderweitig exponiert, muss vertrauenswürdige Proxy-Adressen enger konfigurieren. Caddy setzt TLS/HSTS, CSP, Frame-/Content-Type-/Referrer-/Permissions-Header; Fastify ergänzt Helmet für API-Antworten. Swagger UI ist in Produktion ausgeschaltet.

## Berechtigungen

| Funktion                                  | Admin | Vorstand | Kassier | Projektleitung | Mitglied |
| ----------------------------------------- | ----- | -------- | ------- | -------------- | -------- |
| Mitglieder lesen / exportieren            | ja    | ja       | ja      | nein           | nein     |
| Mitglieder anlegen / ändern / importieren | ja    | ja       | nein    | nein           | nein     |
| Gruppenübersicht                          | ja    | ja       | ja      | ja             | ja       |
| Gruppenmetadaten verwalten                | ja    | ja       | nein    | ja             | nein     |
| Personen zu Gruppen zuordnen              | ja    | ja       | nein    | nein           | nein     |
| Vorstandsnamen / Funktionen lesen         | ja    | ja       | ja      | ja             | ja       |
| Amtszeiten verwalten                      | ja    | ja       | nein    | nein           | nein     |
| Vereinsprofil lesen                       | ja    | ja       | ja      | ja             | ja       |
| Vereinsprofil ändern                      | ja    | ja       | nein    | nein           | nein     |
| Audit-Protokoll                           | ja    | ja       | nein    | nein           | nein     |
| Benutzerkonten / Rollen                   | ja    | nein     | nein    | nein           | nein     |
| Eigene verknüpfte Kontakt-/Adressdaten    | ja    | ja       | ja      | ja             | ja       |

Gruppenlisten für normale Mitglieder zeigen nur die Anzahl, keine fremden Personendatensätze. Namen im Vorstand sind bewusst für angemeldete Vereinsangehörige sichtbar. Das eigene Profil nutzt ausschließlich eine serverseitig ermittelte Personenverknüpfung; es akzeptiert keine frei wählbare Person-ID. Kein Benutzer kann sich über die Profil-API eine Rolle geben. Der letzte Administrator ist gegen Herabstufung geschützt.

## Mandantentrennung und Datenminimierung

Alle fachlichen Abfragen übernehmen den autorisierten Organisationskontext. Fremde Einzel-IDs liefern 404, ein fremder Organisationskontext 403. Zusammengesetzte FKs verhindern Datenbankzuordnungen zwischen Mandanten. Zod-Objekte für Schreiboperationen sind strikt: eingeschleuste Felder wie `organizationId`, `userId` oder `role` werden abgewiesen. Parameter werden von Drizzle gebunden, Suchwildcards explizit escaped und Sortierfelder erlaubnisgelistet.

API-Antworten erhalten `Cache-Control: no-store`. Der Service Worker behandelt keine API-Laufzeitcaches. IndexedDB enthält keine Personen, Rollen, Passwörter oder Sitzungen. Query-Daten leben nur im Tab-Arbeitsspeicher. Abmeldung und Organisationswechsel leeren den Cache. Ein BroadcastChannel ohne Identitätsdaten leert und aktualisiert den Sitzungszustand auch in anderen geöffneten Tabs. Exportdateien sind ein bewusster Datenabfluss an den berechtigten Nutzer; CSV-Zellen, die als Tabellenformeln ausgeführt werden könnten, werden neutralisiert.

Strukturierte Serverlogs enthalten interne Fehlercodes und Anfrage-IDs; keine Bodies, SQL-Parameter, Passwörter, Sitzungscookies oder Namen. Ungefangene Fachfehler werden nicht mit Datenbank-Querytexten geloggt. Audit-Metadaten speichern Feldnamen und Aktion, keine Vorher-/Nachher-Kopien von personenbezogenen Daten. Es existieren keine HTTP-Routen zum Ändern/Löschen von Audit-Einträgen. Der Datenbankbetreiber besitzt technisch weiterhin Zugriff; dieses Audit-Protokoll ist keine manipulationssichere, zertifizierte Archivierung.

## Verifikation und Betrieb

Echte PostgreSQL-Tests prüfen Better-Auth-Anmeldung, Cookieattribute, Session-Widerruf, abgeschaltete Registrierung, CSRF, fremde IDs, Kontextwechsel, Cross-Tenant-FKs, Gruppen-/Vorstandszuordnungen, Rollen und atomare Rücknahmen. Browserprüfungen prüfen die tatsächlichen Flows und den Service-Worker-Cache. Der automatisierte Umfang ist in `docs/verification.md` dokumentiert.

Vor Nutzung mit echten Daten müssen Verantwortliche die Datenverarbeitung, Rollenvergabe, Aufbewahrung, Löschprozesse, Backups und Wiederherstellung organisatorisch festlegen. Entwicklung und Tests ersetzen keinen externen Penetrationstest. MFA, sicherer Passwort-Wiederherstellungsprozess mit eigenem Mailtransport und gerätebezogene Sitzungsverwaltung sind nächste Härtungsschritte; es gibt keine unsichere öffentliche „Passwort vergessen“-Abkürzung.

Secrets sind `.gitignore`-geschützt. `bun run setup` erzeugt unabhängige Zufallswerte und überschreibt keine vorhandene Konfiguration. Produktionssecrets über geschützte Serverdateien/Secret-Verwaltung zuführen. Das erste Passwort wird im Bootstrap-Terminal einmalig angezeigt, nicht in regulären Serverlogs. Passwörter mindestens 12 und höchstens 128 Zeichen; Bibliothekshashing unverändert.

## Abhängigkeitsprüfung vom 29.10.2026

`bun audit` wurde gegen die aktuelle Advisory-Datenbank ausgeführt. Die transitive esbuild-Version aus der Migrationswerkzeugkette wird per exakt versioniertem Override auf 0.25.12 angehoben; diese Version liegt oberhalb der korrigierten Version 0.25.0 des [esbuild-Advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). Migrationserzeugung, Tests und Produktionsbuild werden mit dem Override geprüft.

Ein niedriger Hinweis zu `deepmerge@4.3.1` bleibt im Entwicklungs-/Buildwerkzeug `vite-plugin-pwa`: [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). Zum Prüfzeitpunkt ist laut Advisory und Paketregistry keine korrigierte Veröffentlichung vorhanden. Der PWA-Build verarbeitet ausschließlich die versionierte vertrauenswürdige Projektkonfiguration, keine Uploads oder Mitgliedereingaben; dieses Werkzeug läuft nicht in der produktiven API oder im ausgelieferten Browsercode. Es wird weder auf eine ungeprüfte ältere Version zurückgesetzt noch der Audit-Hinweis unterdrückt. Vor Releases auf eine offizielle Korrektur prüfen. Dieser offene Build-Hinweis wird ausdrücklich nicht als bestandenes, hinweisfreies Audit dargestellt.
