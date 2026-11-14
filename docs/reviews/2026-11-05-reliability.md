# Repository reliability and refactoring review — 5 November 2026

Reviewed working tree at `64c218c`. This is an assessment, not an implementation of fixes. Existing changes to `tests/e2e/volunteer-self.spec.ts` and the untracked local merge report were preserved.

The modular monolith, shared contracts, tenant constraints, audit transactions, and existing tests provide a useful foundation. The highest-value improvements are consistency at authorization and retry boundaries, followed by failure recovery. A broad rewrite is unnecessary.

## Prioritized findings

### 1. P1 — Newer write routes bypass permission revalidation

**Locations:** `apps/api/src/modules/member-extras.ts:172`, `:211`, `:253`, `:292`, `:323`; `apps/api/src/modules/mail-newsletters.ts:89`, `:117`, `:211`.

These routes authorize before entering their transaction, then write using that earlier access context. Member-field creation even acquires the organization lock without reloading the role afterward. An administrator can authorize a request, wait behind another transaction that demotes them, and still create a field after that demotion commits. Other member-extra and newsletter mutations also lack the `lockAccess` protocol used by core writes.

**Fix:** Start each relevant mutation transaction with `lockAccess(tx, access, requiredPermission)` and use its returned context. Keep the lock order consistent with existing writers.

**Regression:** Hold the organization lock, let a request complete its initial access check, demote the caller, release the lock, and assert 403 with no mutation or audit event. Extend the existing core-route regression to these modules.

### 2. P1 — Retry responses bypass record-specific authorization

**Locations:** `apps/api/src/modules/finance/operations.ts:25–44`; `apps/api/src/modules/documents.ts:453–485`.

`financialOperation` checks the broad permission, then returns the stored response without running the callback. Document visibility and finance-specific authorization live inside that skipped callback. For example, an administrator can update a financial receipt, become a board member, and replay the request: board retains `documents:write`, so the old financial document metadata is returned even though ordinary document reads now exclude it. The operation hash also omits the actor, and the stored `actorUserId` is never checked when replaying.

**Fix:** Bind retry records to the actor. Store identifiers rather than complete sensitive responses where practical, and load the result through current record-level authorization on every response, including replays. Preserve support for existing stored operations during migration.

**Evidence:** Executed the real helper with a simulated transaction returning a current board role and a previous receipt operation. It returned `replayed: true` and financial metadata without invoking the record-check callback. This was a controlled helper diagnostic, not a PostgreSQL/HTTP reproduction.

### 3. P1 — Idle PostgreSQL connection errors can terminate the API

**Location:** `packages/db/src/index.ts:5–11`.

The pool has no `error` listener, and no caller installs one. The installed `pg-pool` implementation forwards idle-client errors through `pool.emit('error', ...)`. Database restarts or broken idle connections can therefore produce an unhandled exception and take down the API, rather than just failing affected database work.

**Fix:** Install a pool-level handler with sanitized error reporting. Let the pool discard failed clients and recover; expose database unavailability through readiness. Avoid logging connection strings or credentials.

**Evidence:** The actual factory produced a pool with zero error listeners. Emitting a simulated idle error threw synchronously. A real database restart was not exercised.

### 4. P2 — Shared-IP rate limits conflict with normal chat polling

**Locations:** `apps/api/src/app.ts:52`; `apps/web/src/features/community.tsx:624–627`; `apps/web/src/features/community-unread.tsx:10–18`.

The default limiter allows 150 requests per minute using the client's IP. Chat polls every five seconds and unread counts every thirty seconds. About eleven active clients behind one office or event Wi-Fi address consume that budget from those two reads alone, before navigation or writes. Legitimate users then receive 429 responses together. The installed limiter source confirms the shared default store and IP key.

**Fix:** Keep an IP-based abuse limit, but add authenticated user/organization budgets for application activity, with appropriate polling budgets or a push-based chat update mechanism. Never use an unverified client header as the identity key.

**Regression:** Exercise multiple authenticated sessions sharing one IP over a representative polling interval, alongside an unauthenticated abuse test.

### 5. P2 — Known pre-send failures strand mail as uncertain

**Location:** `apps/api/src/services/mail-worker.ts:27–76`, `:144–147`.

The claim transaction commits `sending` before the worker obtains the organization lock and revalidates the source. If lock acquisition times out or revalidation throws, SMTP was never attempted, but the worker leaves the message as `sending`. After two minutes, the stale-state sweep marks it `uncertain`, requiring manual investigation. The worker catches the error without recording which message or stage failed. Holding the organization lock through SMTP also makes a slow mail server block unrelated writes, increasing lock contention.

**Fix:** Track claim/revalidation separately from SMTP handoff. Safely release or retry known pre-handoff failures with bounded backoff; keep genuinely ambiguous SMTP outcomes non-retriable. Record message ID, stage, and a sanitized error code. Revisit the lock scope without weakening the existing payment/permission revalidation guarantee.

**Regression:** Inject an organization-lock timeout and a revalidation failure. Assert no sender call and a recoverable queue state; retain the current tests preventing automatic resend after ambiguous handoff.

### 6. P2 — Older schedules and newsletters disappear from list access

**Locations:** `apps/api/src/modules/community-schedules.ts:101–108`; `apps/api/src/modules/mail-newsletters.ts:71–82`.

Both lists stop at 50 rows and return no cursor or total. A 51st qualifying item hides the oldest item from the list with no way to page back. In the newsletter list, enough newer sent newsletters can also push an older draft out of the editor's list.

**Fix:** Add stable cursor or page-based pagination to the contracts and UI. Include an ID tie-breaker in newsletter ordering.

**Regression:** Seed 51 qualifying records and verify that all are reachable, including an old newsletter draft among newer sent records.

## Focused refactoring opportunities

1. **Consolidate transaction and retry infrastructure.** `financialOperation` is now used by community and document modules, while `eventWrite` implements a similar protocol with different actor binding. Move shared mechanics into a neutral service with explicit current-access and replay-authorization hooks. Keep domain rules in their modules. Findings 1 and 2 show why this is more useful than cosmetic deduplication.
2. **Split feature modules around behavior.** `community.tsx` has 1,227 lines, events `index.tsx` 1,004, volunteer routes 1,127, and the API ledger 1,110. Extract chat, post/poll editors, event registration/attendance, and distinct volunteer route groups. Preserve contracts and behavior; test the extracted boundaries rather than component internals.
3. **Separate job selection, validation, delivery, and recovery.** Make mail state transitions explicit and observable. Existing generic error callbacks discard the context needed to diagnose historical failures. Log safe error codes, job stages, and identifiers without message bodies or recipient details.
4. **Apply concurrency controls to check-then-write limits.** Guardian creation counts rows and then inserts without locking the person (`member-extras.ts:323–334`). Two requests can both observe four guardians and create a sixth despite the five-guardian limit. Use the shared organization write protocol or a consistent person lock, and test two concurrent requests at the boundary.

Recommended implementation order: fix findings 1–3 with focused regressions; then address mail recovery and shared-IP polling limits; add pagination; finally split large modules while retaining those tests.

## Verification and limits

| Check                                    | Result                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| TypeScript                               | Passed                                                      |
| ESLint                                   | Passed                                                      |
| Unit/UI suite                            | 123 tests passed across 14 files                            |
| Production web/API build                 | Passed                                                      |
| Prettier                                 | Passed before adding this report; report checked separately |
| Focused pool and replay diagnostics      | Confirmed the behaviors described above                     |
| PostgreSQL integration and browser tests | Not run: dedicated test database connection refused         |

The initial database probe was blocked by the sandbox; an approved local probe returned `ECONNREFUSED`. No development database was used or reset. Concurrency findings are based on source and transaction semantics, not a completed database regression run. Dependency vulnerability scanning and a full browser accessibility audit were outside this review. Only this review document was added; application code was not changed.
