# Local master integration — 3 November 2026

Local `master` includes the latest fetched `origin/master`, the local audit fixes, and the remaining `fix/business-date-and-api-helpers`, `refactor/web-queries-and-list-views`, and `ci/faster-e2e` branches. The CI branch's follow-up database-teardown and sign-out synchronization commits are included.

Merge resolutions preserve the current feature set and the previously tested fixes: organization-aware dates, permission checks after acquiring the write lock, CSV escaping, retry-key handling, paginated inventory history, and lazy feature routes. Shared query views now retain the newer scheduling, chat, member-field, reminder and newsletter features. The separate finance setup and report modules remain separate.

The development database has the merged feature migrations applied. The admin preview runs at http://localhost:5174. Doodle-style scheduling is available under **Vereinsleben → Terminfindung**, directly at http://localhost:5174/community?kind=schedule. The regular voting section is labeled **Abstimmungen**.

## Verification

| Check                                | Result                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| TypeScript                           | Passed                                                                                           |
| ESLint and formatting                | Passed after merge cleanup                                                                       |
| Unit/UI tests                        | 123 passed across 14 files, with two workers                                                     |
| PostgreSQL integration               | 206 passed across 13 files                                                                       |
| Production web/API build             | Passed                                                                                           |
| Built API on Node                    | Database health, unauthenticated access and cache policy passed                                  |
| Dependency audit, moderate and above | Passed                                                                                           |
| OpenAPI generation                   | Passed; no schema diff                                                                           |
| Live preview                         | Automatic admin access, dashboard, voting editor and scheduling editor passed; no browser errors |
| Browser suites                       | Remaining desktop suites and mobile subset in progress                                           |

The initial unit/UI run hit the five-second timeout in a member-form test while other checks were running; all 123 tests passed with two workers. One desktop offline scenario initially timed out loading the event screen before preparing a second copy. An isolated rerun with a complete trace passed; the initial failure's cause remains unconfirmed. Browser results should be read with that limitation.

No changes were pushed to the remote repository.
