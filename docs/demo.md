# Klick-Demo ohne Server

Statische Demo der Weboberfläche zum Ausprobieren und Testen: **ohne Datenbank, ohne API, ohne echte Daten**. Alle Inhalte (Verein „b\*nature Brixen (Demo)“, Mitglieder, Veranstaltungen, Finanzen …) sind erfunden.

## Funktionsweise

- `VITE_DEMO=1` tauscht in `apps/web/vite.config.ts` den Einstiegspunkt gegen `apps/web/src/demo/entry.ts`. Normale Builds enthalten weder den Demo-Code noch die Fixtures.
- `src/demo/mock.ts` ersetzt im Browser `fetch` für `/api/*` und antwortet aus aufgezeichneten Antworten (`src/demo/fixtures/{admin,member}.json`).
- Schreibzugriffe (anlegen, bearbeiten, Chat …) ändern nur eine Kopie im `sessionStorage` des Browser-Tabs. „Zurücksetzen“ im Demo-Hinweis stellt den Ausgangszustand wieder her.
- Anmeldung mit beliebigen Daten. E-Mail mit „mitglied“/„member“ → Mitgliedersicht, sonst Admin. Rollenwechsel auch über den Demo-Hinweis.
- Zeitstempel werden in ganzen Wochen auf heute verschoben, damit Termine aktuell wirken. Berichte, Kennzahlen und Filter zeigen den aufgezeichneten Stand und reagieren nicht vollständig auf Änderungen.
- PDF-/CSV-/ICS-Downloads liefern Platzhalterdateien.

## Bauen und veröffentlichen

```sh
bun run demo:build          # → apps/web/dist-demo
```

Die Demo liegt auf Netlify: <https://bnature-demo-899770.netlify.app>. Sie wird nicht automatisch aktualisiert, sondern nach `bun run demo:build` von Hand veröffentlicht:

```sh
npx -y netlify-cli deploy --dir="$PWD/apps/web/dist-demo" --prod --no-build --filter @bnature/web --site dafe88e7-382a-41d3-86ce-265e16d0c78c
```

`apps/web/dist-demo` lässt sich auch auf jeden anderen statischen Host laden (z. B. Cloudflare Pages); `_redirects` und `404.html` für die SPA-Navigation werden mitgebaut, und die Seite ist mit `noindex` markiert. Für einen Host mit Unterpfad `VITE_BASE=/pfad/` setzen.

## Fixtures neu aufzeichnen

Nach Änderungen an API oder Oberfläche. Benötigt eine eigene, wegwerfbare Test-Datenbank (`bnature_test`) in `.env.test` mit `TRUST_PROXY=true`.

```sh
bun run demo:seed           # füllt bnature_test über die echte API mit erfundenen Daten (API muss laufen)
bun run --filter @bnature/web build
API_PROXY_URL=http://127.0.0.1:$PORT bunx vite preview --port <APP_URL-Port>   # in apps/web
bun run demo:record         # crawlt die App als Admin und Mitglied, schreibt src/demo/fixtures/*.json
bun run demo:build && (cd apps/web && bunx vite preview --outDir dist-demo --port 5196) &
bun run demo:check          # klickt alle Seiten beider Rollen durch
```

`demo:seed` leert die Test-Datenbank und verweigert jede andere Datenbank.
