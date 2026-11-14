# Training AI Coach

## Validation

- Run the complete local Playwright suite (`npm run test:playwright`) after the final implementation/test change and before publishing. Focused runs supplement the complete suite. Do not request separate cloud-QA approval for local Playwright.
- `npm run check` is the normal full validation command: lint/build, offline backend tests, environment guards, emulator security and the complete local Playwright suite. CI must retain this local gate.
- Testing against the deployed QA environment, authenticated cloud journeys and live model calls run only on explicit request. Ordinary publication includes both environment deployments and bounded deployment-readiness checks; it does not authorize cloud regression.
- Preserve the separate production/QA identities, synthetic QA fixtures and existing paused automatic-QA-AI controls.

## Routine evolution and historical data

- Routine, day, exercise, schedule, goal and progress changes must preserve existing historical workouts, completed sets, loads, repetitions, dates, measurements and daily-log records. Never wipe/reseed history or delete/recreate a user's routine as a shortcut for updating it.
- Update the existing routine and keep stable routine/day/exercise identities. Retain legacy aliases/ownership when converting or renaming older records. Completed sessions remain snapshots of what happened then; current prescriptions are separate.
- Adding, removing, replacing, renaming or reordering current exercises must leave prior exercise progress accessible. Bound queries with pagination rather than silently dropping older history.
- An active session remains resumable after template changes. Applying a change to that active session must retain already completed sets; finished sessions are not automatically rewritten to match a new template.
- Historical correction or erasure is a separate explicitly requested action. Routine maintenance never implies permission to delete historical records, original reports or progress.
- Verify preservation with before/after comparisons and regression cases for routine edits, legacy conversion, renamed/removed exercises, active drafts and older history. Use local synthetic data; actual user records are not test fixtures.
