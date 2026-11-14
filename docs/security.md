# Sicherheit

## Authentifizierung

Better Auth verwaltet Passwörter, Hashing, Sitzungen und Cookies; Drizzle persistiert das Auth-Schema in PostgreSQL. Der Webserver verwendet `disableSignUp: true` und eine zusätzliche Allowlist für veröffentlichte Auth-Endpunkte. Die nur lokal/intern verwendete Provisionierungsinstanz kann Konten für den Bootstrap und authentifizierte Administratoren anlegen; sie wird niemals als HTTP-Handler gemountet.

Cookies sind HttpOnly und SameSite=Lax. In Produktion erzwingt die Konfiguration HTTPS und Secure-Cookies. Sitzungen laufen nach sieben Tagen ab und werden frühestens nach einem Tag verlängert. Der Better-Auth-Cookie-Cache ist deaktiviert. Autorisierung liest aktuelle Organisationsrollen bei jeder Fachanfrage; ein Rollenentzug braucht keinen Sitzungscache-Ablauf. Passwortwechsel nutzt Better Auth und kann andere Sitzungen widerrufen.

## Origin, CSRF und Netzwerk

Alle zustandsändernden API-/Auth-Anfragen benötigen einen exakt passenden `Origin`; `Sec-Fetch-Site: cross-site` wird abgewiesen. Zusätzlich bleiben Better Auths Origin-/CSRF-Prüfungen aktiv. Browser und API verwenden denselben Ursprung; es gibt keine offene CORS-Freigabe. Content-Type-Parsing und Zod begrenzen Eingaben. Maximale Bodygröße: 256 KiB. CSV-Dateien werden im Browser auf 2 MB / 1.000 Zeilen begrenzt und als einzelne validierte API-Anfragen übertragen.

Fastify begrenzt reguläre API-Anfragen auf 150/Minute je authentifiziertem Benutzer; ohne Sitzung gilt die Client-IP. Ein zusätzlicher IP-Limiter begrenzt alle Anfragen auf 3.000/Minute, damit mehrere Vereinsmitglieder im selben WLAN unabhängig arbeiten können. Auth-Endpunkte bleiben auf 20/Minute je IP und Anmeldeversuche zusätzlich auf 10/Minute beschränkt. Kontoanlage ist auf 10/Minute je authentifiziertem Benutzer beschränkt. Limiter speichern ihren Zustand lokal im API-Prozess: Phase 1 betreibt eine API-Instanz. Mehrere Replikas erfordern vor Skalierung ein gemeinsames Rate-Limit-Backend. Die Rate-Limit-Konfiguration bleibt auch in Tests aktiv.

`TRUST_PROXY=true` ist nur im internen Docker-Netz hinter Caddy vorgesehen. Die API besitzt im Produktions-Compose keinen veröffentlichten Port. Wer die API anderweitig exponiert, muss vertrauenswürdige Proxy-Adressen enger konfigurieren. Caddy setzt TLS/HSTS, CSP, Frame-/Content-Type-/Referrer-/Permissions-Header; Fastify ergänzt Helmet für API-Antworten. Swagger UI ist in Produktion ausgeschaltet.

## Berechtigungen

| Funktion                                  | Admin   | Vorstand | Kassier   | Projektleitung  | Mitglied |
| ----------------------------------------- | ------- | -------- | --------- | --------------- | -------- |
| Mitglieder lesen / exportieren            | ja      | ja       | ja        | nein            | nein     |
| Mitglieder anlegen / ändern / importieren | ja      | ja       | nein      | nein            | nein     |
| Gruppenübersicht                          | ja      | ja       | ja        | ja              | ja       |
| Gruppenmetadaten verwalten                | ja      | ja       | nein      | ja              | nein     |
| Personen zu Gruppen zuordnen              | ja      | ja       | nein      | nein            | nein     |
| Vorstandsnamen / Funktionen lesen         | ja      | ja       | ja        | ja              | ja       |
| Amtszeiten verwalten                      | ja      | ja       | nein      | nein            | nein     |
| Vereinsprofil lesen                       | ja      | ja       | ja        | ja              | ja       |
| Vereinsprofil ändern                      | ja      | ja       | nein      | nein            | nein     |
| Audit-Protokoll                           | ja      | ja       | nein      | nein            | nein     |
| Benutzerkonten / Rollen                   | ja      | nein     | nein      | nein            | nein     |
| Eigene verknüpfte Kontakt-/Adressdaten    | ja      | ja       | ja        | ja              | ja       |
| Beiträge / Zahlungen lesen, PDF, CSV      | ja      | nein     | ja        | nein            | nein     |
| Forderungen, Zahlungen, Erinnerungen      | ja      | nein     | ja        | nein            | nein     |
| Beitragstarife verwalten                  | ja      | nein     | nein      | nein            | nein     |
| Kassabuch, Konten, Berichte, Storno       | ja      | nein     | ja        | nein            | nein     |
| Geschäftsjahr abschließen                 | ja      | nein     | nein      | nein            | nein     |
| Dokumente lesen / hochladen / archivieren | ja      | ja       | ja        | nein            | nein     |
| Belege zu Kassabuchbuchungen              | ja      | nein     | ja        | nein            | nein     |
| Freiwillige lesen (ohne Registerdaten)    | ja      | ja       | ja        | ja              | nein     |
| Freiwillige verwalten, Registerdaten      | ja      | ja       | nein      | nein            | nein     |
| Einsätze planen / Zeiten erfassen         | ja      | ja       | nein      | eigene Veranst. | nein     |
| Stunden bestätigen                        | ja      | ja       | nein      | eigene Veranst. | nein     |
| Versicherungen lesen / verwalten          | ja / ja | ja / ja  | ja / nein | nein            | nein     |
| Register lesen / Einträge erstellen       | ja      | ja       | nein      | nein            | nein     |
| Registerstände festschreiben, Signaturen  | ja      | ja       | nein      | nein            | nein     |
| Rechtliche Freigabe des Verfahrens        | ja      | nein     | nein      | nein            | nein     |
| Fristen lesen / verwalten                 | ja / ja | ja / ja  | ja / nein | nein            | nein     |
| Nachweise herunterladen                   | ja      | ja       | nein      | nein            | nein     |

Gruppenlisten für normale Mitglieder zeigen nur die Anzahl, keine fremden Personendatensätze. Namen im Vorstand sind bewusst für angemeldete Vereinsangehörige sichtbar. Das eigene Profil nutzt ausschließlich eine serverseitig ermittelte Personenverknüpfung; es akzeptiert keine frei wählbare Person-ID. Kein Benutzer kann sich über die Profil-API eine Rolle geben. Der letzte Administrator ist gegen Herabstufung geschützt. Finanzrechte (`finance:read`, `finance:write`, `finance:plans`, `finance:close`) werden bei Schreiboperationen zusätzlich innerhalb der gesperrten Transaktion erneut geprüft; Details in [Sprint 2.1](sprints/2.1-implementation.md#berechtigungen-und-datenschutz).

## Dokumente

Uploads sind auf PDF, PNG und JPEG bis 10 MiB begrenzt; der Typ wird anhand der Dateisignatur geprüft, nicht anhand von Name oder Header allein. Dateinamen werden bereinigt; Speicherpfade bestehen ausschließlich aus serverseitig erzeugten UUIDs außerhalb jedes Webroots. Downloads laufen nur über autorisierte API-Routen mit `no-store`, `nosniff`, `attachment` und einer `sandbox`-CSP; der gespeicherte SHA-256 wird vor der Auslieferung geprüft. Es gibt keine öffentlichen oder signierten Direkt-URLs. Eine Malware-Prüfung findet nicht statt; heruntergeladene Dateien sind wie andere externe Dateien zu behandeln. Details: [Sprint 2.2](sprints/2.2-implementation.md#22b--private-dokumente-s22-04).

## Mandantentrennung und Datenminimierung

Alle fachlichen Abfragen übernehmen den autorisierten Organisationskontext. Fremde Einzel-IDs liefern 404, ein fremder Organisationskontext 403. Zusammengesetzte FKs verhindern Datenbankzuordnungen zwischen Mandanten. Zod-Objekte für Schreiboperationen sind strikt: eingeschleuste Felder wie `organizationId`, `userId` oder `role` werden abgewiesen. Parameter werden von Drizzle gebunden, Suchwildcards explizit escaped und Sortierfelder erlaubnisgelistet.

API-Antworten erhalten `Cache-Control: no-store`. Der Service Worker behandelt keine API-Laufzeitcaches. Die allgemeine IndexedDB enthält nur Shell-Metadaten. Sprint 2.3 speichert nach ausdrücklicher Vorbereitung minimale Veranstaltungs-/Teilnehmerdaten und Anwesenheitsoperationen verschlüsselt in einer separaten Dexie-Datenbank. Passwörter und Sessiontoken werden dort nicht gespeichert. Query-Daten leben nur im Tab-Arbeitsspeicher. Abmeldung und Organisationswechsel leeren den Cache. Ein BroadcastChannel ohne Identitätsdaten leert und aktualisiert den Sitzungszustand auch in anderen geöffneten Tabs. Exportdateien sind ein bewusster Datenabfluss an den berechtigten Nutzer; CSV-Zellen, die als Tabellenformeln ausgeführt werden könnten, werden neutralisiert.

Strukturierte Serverlogs enthalten interne Fehlercodes und Anfrage-IDs; keine Bodies, SQL-Parameter, Passwörter, Sitzungscookies oder Namen. Ungefangene Fachfehler werden nicht mit Datenbank-Querytexten geloggt. Audit-Metadaten speichern Feldnamen und Aktion, keine Vorher-/Nachher-Kopien von personenbezogenen Daten. Es existieren keine HTTP-Routen zum Ändern/Löschen von Audit-Einträgen. Der Datenbankbetreiber besitzt technisch weiterhin Zugriff; dieses Audit-Protokoll ist keine manipulationssichere, zertifizierte Archivierung.

## Verifikation und Betrieb

Echte PostgreSQL-Tests prüfen Better-Auth-Anmeldung, Cookieattribute, Session-Widerruf, abgeschaltete Registrierung, CSRF, fremde IDs, Kontextwechsel, Cross-Tenant-FKs, Gruppen-/Vorstandszuordnungen, Rollen und atomare Rücknahmen. Browserprüfungen prüfen die tatsächlichen Flows und den Service-Worker-Cache. Der automatisierte Umfang ist in `docs/verification.md` dokumentiert.

Vor Nutzung mit echten Daten müssen Verantwortliche die Datenverarbeitung, Rollenvergabe, Aufbewahrung, Löschprozesse, Backups und Wiederherstellung organisatorisch festlegen. Entwicklung und Tests ersetzen keinen externen Penetrationstest. MFA, sicherer Passwort-Wiederherstellungsprozess mit eigenem Mailtransport und gerätebezogene Sitzungsverwaltung sind nächste Härtungsschritte; es gibt keine unsichere öffentliche „Passwort vergessen“-Abkürzung.

Secrets sind `.gitignore`-geschützt. `bun run setup` erzeugt unabhängige Zufallswerte und überschreibt keine vorhandene Konfiguration. Produktionssecrets über geschützte Serverdateien/Secret-Verwaltung zuführen. Das erste Passwort wird im Bootstrap-Terminal einmalig angezeigt, nicht in regulären Serverlogs. Passwörter mindestens 12 und höchstens 128 Zeichen; Bibliothekshashing unverändert.

## Abhängigkeitsprüfung vom 29.10.2026

`bun audit` wurde gegen die aktuelle Advisory-Datenbank ausgeführt. Die transitive esbuild-Version aus der Migrationswerkzeugkette wird per exakt versioniertem Override auf 0.25.12 angehoben; diese Version liegt oberhalb der korrigierten Version 0.25.0 des [esbuild-Advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). Migrationserzeugung, Tests und Produktionsbuild werden mit dem Override geprüft.

Ein niedriger Hinweis zu `deepmerge@4.3.1` bleibt im Entwicklungs-/Buildwerkzeug `vite-plugin-pwa`: [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). Zum Prüfzeitpunkt ist laut Advisory und Paketregistry keine korrigierte Veröffentlichung vorhanden. Der PWA-Build verarbeitet ausschließlich die versionierte vertrauenswürdige Projektkonfiguration, keine Uploads oder Mitgliedereingaben; dieses Werkzeug läuft nicht in der produktiven API oder im ausgelieferten Browsercode. Es wird weder auf eine ungeprüfte ältere Version zurückgesetzt noch der Audit-Hinweis unterdrückt. Vor Releases auf eine offizielle Korrektur prüfen. Dieser offene Build-Hinweis wird ausdrücklich nicht als bestandenes, hinweisfreies Audit dargestellt.

## Offline-Anwesenheit (Sprint 2.3)

Vorbereitung und jede Synchronisierung erfordern serverseitig die aktuelle Veranstaltungsverantwortung und Organisationsrolle. Jede Operation wird gegen die erwartete Datensatzversion geprüft und einmalig bestätigt; ein Konflikt benötigt eine bewusste Entscheidung. Der Client übermittelt keine vertrauenswürdige Benutzeridentität. Abgelaufene Sessions erhalten 401 und bewahren die Queue bis zur erneuten Anmeldung; Rechteentzug oder Kontowechsel entfernt lokale Kopien.

AES-GCM-Payloads und ein nicht exportierbarer CryptoKey liegen in IndexedDB. Metadaten für Queue/Benutzerbindung enthalten Kennungen und Ablaufzeit. Der Schlüssel ist kein Ersatz für Gerätesperre und schützt nicht vor Zugriff durch denselben Origin. Nach sieben Tagen sind Kopien nicht mehr nutzbar und werden beim nächsten Zugriff/Fokus beziehungsweise bei offener Ansicht periodisch gelöscht. Logout und Organisationswechsel löschen Kopien, Queue und Schlüssel. Ein offline gebliebenes Gerät erkennt einen serverseitigen Rechteentzug erst bei erneuter Verbindung. Keine personenbezogenen API-Antworten gelangen in Service-Worker-Caches. Siehe [ADR 0004](decisions/0004-events-offline.md).

## Freiwillige, Register und Compliance (Sprint 2.4)

Getrennte Berechtigungen: `volunteers:read`, `volunteers:write`, `volunteers:assign`, `volunteer_hours:confirm`, `insurance:read`, `insurance:write`, `register:read`, `register:write`, `register:finalize`, `compliance:read`, `compliance:write`, `evidence:download`. Schreibvorgänge lesen Rolle und Organisation innerhalb der sperrenden Transaktion erneut. Projektleitungen sehen und bearbeiten Einsätze und Stunden nur zu Veranstaltungen, die sie verantworten; niemand bestätigt eigene Stunden.

Datenminimierung: Listen, Einsätze, Stunden und Dashboard enthalten keine Steuernummer, Geburtsdaten oder Adressen. Registerdaten erscheinen nur in der Detailansicht für `volunteers:write`/`register:read`, im Register und in Meldelisten (`insurance:write` plus `evidence:download`). Das Idempotenzprotokoll speichert für diese Vorgänge nur IDs; Audit-Einträge nur Feldnamen. Der Client protokolliert keine Antworten.

Dokumente mit Register-, Versicherungs-, Freiwilligen- oder Fristbezug sind zusätzlich zur bestehenden Dokumentfreigabe an die Modulrechte gebunden und nur mit `evidence:download` herunterladbar. Registerdokumente entstehen ausschließlich durch Festschreibung, erhalten keine weiteren Versionen und können weder umkategorisiert noch archiviert werden. Signaturimporte akzeptieren PDF, CAdES (`application/pkcs7-mime`) und RFC 3161 (`application/timestamp-reply`) nur nach Inhaltsprüfung und nur an diesem Endpunkt.

Fremde IDs liefern 404, fremde Organisationskontexte 403; alle neuen Tabellen verwenden zusammengesetzte mandantengebundene Fremdschlüssel. Die Hash-Kette des Registers ist über `GET /volunteer-register/verify` prüfbar. SHA-256 belegt Unverändertheit gegenüber einem bekannten Wert, ersetzt aber keine qualifizierte Signatur und keinen Zeitstempel.
