# Backend and PWA hardening — 2026-11-17

Logout now attempts browser push unsubscription even when server-side subscription removal fails. Server cleanup is bounded to five seconds, and displayed notifications are closed. Cleanup remains best effort when browser APIs themselves fail; it does not claim to revoke a session without a successful server response. The existing sign-out error check is covered by a new browser regression test.

Push payloads containing JSON null, arrays, or primitives now produce a fallback notification. Invalid notification URLs fall back to the app, and click destinations must remain within its origin and scope. Failed service-worker update checks on reconnection are handled without an unhandled promise rejection.

The API applies no-store headers before request hooks can reject a request, including the early IP rate limit. Push delivery revalidates persisted endpoints against the existing provider allowlist immediately before calling the network client; invalid targets are treated as expired subscriptions. This supplements the existing registration validation.

Validation:

- Unit/UI suite: 155 tests passed, plus the subsequently added early-rate-limit regression. Focused push and HTTP security checks passed.
- API and community database integration suites: 73 tests passed against the dedicated `bnature_test` database.
- Type checking, lint, and production build passed.
- Browser checks: six passed across desktop and mobile Chromium viewports, covering offline shell recovery without API caching, cross-tab logout, and server-rejected sign-out.

This is a focused hardening pass, not a complete security certification. Real push delivery and installed iOS/Android airplane-mode testing still require physical-device validation.
