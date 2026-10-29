# ADR 0001 – Selbst gehosteter modularer Monolith

Status: angenommen. Datum: 2026-10-29.

## Entscheidung

Bun Workspaces mit React/Vite-PWA, Fastify, Better Auth, Drizzle/PostgreSQL und Caddy. Gleicher Ursprung für Web und API; keine öffentliche Selbstregistrierung. Mandantenkontext durch geprüfte Organisationsrolle plus zusammengesetzte Datenbankreferenzen. Person, Zugang, Mitgliedschaft und Vereinsfunktion sind getrennt. Keine Speicherung von personenbezogenen Offline-Daten in Phase 1.

## Begründung

Der geplante Verein benötigt eine nachvollziehbare, selbst betreibbare Basis, keine Microservice-Infrastruktur oder Abrechnungsplattform. Workspace-Verträge verhindern Drift zwischen UI und API. Transaktionen sichern die Mitgliederprojektion und Auditierung. Etablierte Authentifizierung vermeidet eigene Passwort-/Sessionverfahren. Node-kompatible Laufzeitbausteine erhalten spätere Betriebsoptionen.

## Folgen und Grenzen

Ein Rollenwert pro Organisation und Nutzer vereinfacht die erste Rechtevergabe. Ein Mitgliedschaftsdatensatz pro Person/Organisation deckt den ersten Betrieb ab; mehrere Eintrittsperioden sind eine spätere Erweiterung. Personenbezogener Offline-Zugriff wird erst mit eigenem Sicherheits- und Synchronisierungskonzept eingeführt. Rate-Limits gelten für eine API-Instanz. Rechtlich belastbare Register und Finanzabschlüsse benötigen separate Fachvalidierung.

Die dokumentierte Better-Auth-/Fastify-Anbindung wird genutzt; Set-Cookie-Header werden als einzelne Headerwerte weitergegeben. Das Drizzle-Auth-Schema verwendet UUIDs über `advanced.database.generateId`. Zod-PATCH-Verträge entfernen Felddefaults, damit ausgelassene Werte unverändert bleiben. Die TypeScript-Version ist mit dem installierten ESLint-Stack kompatibel gewählt; alle direkten Versionen sind gepinnt.

## Offizielle technische Referenzen

- [Better Auth: Fastify](https://better-auth.com/docs/integrations/fastify)
- [Better Auth: Drizzle-Adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth: E-Mail/Passwort](https://better-auth.com/docs/authentication/email-password)
- [Bun: Installation und feste Versionen](https://bun.com/docs/installation)
- [Bun: reproduzierbare Installation](https://bun.com/docs/pm/cli/install)
- [Vite: Releases und Unterstützung](https://vite.dev/releases)

AlpsPlanner wird nur als fachlicher Vergleich herangezogen. Hosting über Sites/Cloudflare oder eine Auth-SaaS würde dem expliziten Selbsthosting- und Stackauftrag widersprechen und ist nicht Teil dieser Entscheidung.
