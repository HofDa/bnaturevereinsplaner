# Reliability improvements — 5 November 2026

Implements the six findings in [the repository review](2026-11-05-reliability.md), plus the concurrent guardian-limit fix. No database migration is required.

- Member-extra and newsletter mutations acquire the organization lock and reload the required permission. Guardian creation uses that same serialization, including the five-person limit.
- Retry records are bound to their original actor. Document retries load the current document through current visibility rules, including financial and event access. New document operation records store only IDs; existing records remain readable through the same checks.
- Shared retry/snapshot mechanics now live in `apps/api/src/services/operations.ts`. Existing finance imports remain compatible through re-exports.
- PostgreSQL pools handle idle-client errors and report error codes without connection details. The existing database health endpoint remains available for readiness checks.
- API budgets use authenticated account IDs, with an additional 3,000-request/minute IP abuse limit. Login remains IP-limited. Route-specific budgets remain active.
- Known failures before SMTP handoff return messages to the queue with a one-minute delay and a five-attempt cap. Ambiguous handoffs are never automatically resent. Worker logs identify the phase and message; DE/IT messages explain pre-send failures.
- Schedules support server-side group filtering and pagination with UI controls. Newsletters support stable pagination; the composer loads all pages so older drafts remain selectable. OpenAPI was regenerated.

SMTP handoff still holds the organization lock to preserve serialization with payment and permission changes. Removing that lock requires a separate delivery protocol; these changes preserve the existing guarantee. Existing historical document-operation snapshots are not scrubbed by this patch, but replay responses always use current authorization.

Regression coverage includes queued demotion, cross-actor retries, financial access loss, idle pool errors, shared-IP users, pre-handoff recovery, guardian concurrency, and lists exceeding 50 records.

Validation:

- TypeScript, ESLint, Prettier, production web/API build and OpenAPI generation passed.
- Unit/UI tests: 124 passed across 15 files.
- PostgreSQL integration tests: 215 passed across 13 files, using only the disposable `bnature_test` database.
- Desktop browser tests: scheduling and newsletter suites passed (2 scenarios), including their automated accessibility checks and local Mailpit delivery.

The initial integration run exposed errors in new fixtures; the corrected complete suite passed. Development data and the pre-existing volunteer browser-test edits were preserved. Large UI-module splits remain follow-up refactoring opportunities.
