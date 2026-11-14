# Training Coach redesign

## Agreed product

- Bright, friendly, training-first UI. Today, Train, Progress, Coach; profile and sign-out on every device. Keep nutrition, meal plans, measurements, history and optional AI.
- Preserve working workout targets, optional AI adjustments, per-exercise kg/lb overrides, timing, autosave/retry, cancellation, multi-day editing and editable history. Body measurements remain kg; workout preference defaults to lb.
- Three-step onboarding with optional health details completed later, EN/ES support and user-scoped drafts.
- Manual measurement entry, PDF/image import and pasted report text. Editable confirmation before readings enter measurement history; original date, units, device/method and evidence retained. Unknown metrics supported. Never invent missing readings or treat targets/reference ranges as measurements.
- Canonical measurements feed charts and coaching. Each saved entry gets a summary and automatic progress insights, with on-demand refresh. Facts persist if AI fails; versioned memory invalidates on edits/deletes/backdating and combines real workout sessions without double-counting mirrored logs.
- Owner-only People, Invitations, Analytics. Invitations plus access requests; verified email-bound seven-day single-use links, email and copy-link. Server-enforced approval and private health records.
- Usage totals and identified activity only; no health/chat/report content. CR reporting timezone; 30-minute sessions; 90-day raw event and 13-month aggregate retention.
- Replace Gemini throughout with OpenAI Responses and workload identity federation. No long-lived OpenAI key or service-account JSON keys. Production and QA have separate identities and OpenAI projects. Demo remains offline.

## Setup checkpoints

Collect OpenAI project, workload identity provider and OpenAI service-account IDs for **each** environment. These are non-secret identifiers. Inspect available configuration and use authorized browser control before asking the user for values that can be discovered. Never ask for tokens, keys or passwords in chat. The authorized setup and current identifiers are recorded in [OPENAI_SETUP.md](OPENAI_SETUP.md).

Ask for a QA project/billing selection before provisioning. Create an isolated Firebase QA environment (Auth, Firestore, Storage, Hosting, Functions), dedicated runtime account, captured email and synthetic test accounts. Keep production application traffic and data unchanged until the release is explicitly requested.

## Verification policy

A request to deploy means both QA and production unless the owner explicitly narrows the destination. Real measurements, original reports, personal coaching memory and actual workouts belong in production. QA is reserved for synthetic test data and explicitly requested regression; it is not the home for personal uploads. Code publication and a verified data transfer are separate operations, and neither may overwrite existing production records silently.

Default verification is lint/build, deterministic backend/security tests, and Playwright against local demo/emulators with synthetic fixtures and mocked AI. Run core journeys and affected feature suites during development; run the complete deterministic suite for a release candidate.

Cloud manual regression is **on demand only**. Before an optional run, describe environment, cases, expected duration and API usage. Do not start it implicitly on push, merge, deployment, or ordinary local testing. A direct request to run the stated regression is sufficient authorization; do not ask again.

Cloud runs must use a verified QA project, isolated identities, synthetic data and run-scoped cleanup. Production data/accounts are never test fixtures. Do not include cloud Playwright configuration in default test discovery or CI.

## QA cost policy

The cloud QA environment operates on manual demand. QA functions scale to zero when idle, with a maximum of one instance per function. QA has no scheduled usage-cleanup job or automatic analytics TTL deletion; expired analytics can be removed by explicitly requested maintenance. Artifact and upload retention remain bounded to avoid accumulating storage costs.

Live OpenAI calls require a manually issued, expiring server-side request budget. QA pages do not automatically generate weekly AI reports, and default tests continue to use the local demo/emulators. Keep production behavior separate. Retained storage, logs, builds and actual QA requests can still incur usage charges; this policy does not promise a zero bill.
