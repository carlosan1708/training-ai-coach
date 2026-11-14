# Training AI Coach — Product Specification

This describes the current redesign implementation. A passing local candidate does not mean that its backend has been configured or deployed to production.

## Product and navigation

A friendly, bilingual training coach for independent users. Workouts, measurements, nutrition and contextual AI coaching share a React/Vite, Material UI, Recharts and Firebase foundation.

| Destination | Purpose |
| --- | --- |
| Today | Start or resume training, daily check-in, weekly activity and nutrition shortcuts. |
| Train | Create routines, manage training days, complete workouts and review exercise progress. |
| Progress | Workout history, confirmed measurements, comparable trends and progress insights. |
| Coach | Suggested prompts and conversation history using saved user context. |
| Profile | Preferences, optional health/nutrition details, units, language and sign-out. |
| Owner area | People, invitations and private usage analytics. |

Mobile uses bottom navigation; desktop uses a sidebar. Preserve existing deep links, including `/log?tab=1`. That route uses the canonical measurement workspace and offers an original-record browser with historical detail and PDF preview.

The design uses a light canvas, violet actions, coral/mint accents, locally bundled Inter, readable spacing and clear primary actions. Loading states, errors and retries are visible. English/Spanish, keyboard access, usable touch targets and reduced-motion preferences are supported.

## Accounts and access

- Production uses Firebase Auth Google sign-in. Language is available before sign-in.
- Uninvited users request access through a server function and remain pending until approved. A valid invitation admits its verified email directly.
- Invitations are email-bound, single-use and valid for seven days. Creation/resending returns a copyable link and attempts delivery. Resending rotates the token; only its hash is stored.
- Handle wrong-account, expired, revoked and already accepted links with clear recovery states. Revoking a link and removing an accepted member's access are separate actions; access removal preserves records.
- The server-owned `admins/{uid}` record identifies an owner. Client environment variables and client-written flags cannot grant approval or ownership.
- Firestore, Storage and every AI endpoint enforce approved access. Pending/rejected users retain only the access needed for admission and reading their status.
- First-time setup has three steps: name/goal, equipment/schedule/restrictions, then coaching language/tone and workout units. Optional body, health and nutrition details can be completed later in Profile. Unknown information is not invented. Drafts are scoped to the current account; completed onboarding is preserved.

## Working workout and nutrition behavior

Improve presentation while preserving these requirements:

- Support legacy flat routines and explicit multi-day routines, with editable days, exercises, sets, repetitions, loads, rests and notes.
- Every manual exercise-entry surface uses the shared library autocomplete with visual suggestions and animated previews: routine selection/configuration, active or historical workout editing, and daily logs. Keep free-form custom entries available on library failure. Loading, highlighting and suggested visual matching never attach metadata or persist edits; explicit selection merges name/library/media without replacing stable workout identity, recorded sets, targets or units. Save/cancel retain their existing scope.
- Evolve the existing routine without erasing history: keep stable routine/day/exercise identities, old session snapshots, completed sets and recorded measurements/logs. Renaming/removing exercises or converting a flat routine preserves legacy ownership and selectable historical progress. Adding exercises does not reset existing progress. Active drafts remain resumable after template changes, with completed sets preserved.
- Progress includes current and historical exercises and supports loading earlier session pages. Current prescriptions and historical facts are separate; routine maintenance never implicitly corrects or deletes historical data.
- Starting a workout works with or without optional AI adjustment. Model failure never prevents ordinary training.
- Add exercises within an active workout with an explicit session-only or permanent scope. Permanent additions update only the matching routine/day; temporary additions can be promoted later with all completed/entered sets preserved. Stable request identities and atomic session/template writes prevent duplicate additions or partially saved scope. Ordinary stale autosaves cannot erase additions or undo a saved scope.
- Show the current exercise, readable set entry, previous targets, save status and session controls. Preserve autosave/retry, resume, confirmed cancellation and completion. Delayed saves cannot recreate a canceled session or edit a completed one.
- Finish persists the session before opening its exact history record. A confirmed stale-module failure on that saved history destination can trigger one guarded reload; repeated failures and other runtime errors show a translated manual-reload screen. Recovery never replays completion or makes a model request.
- Store workout loads in kg; display the workout preference or a per-exercise override. Default workout preference is lb. Body measurements normalize to kg/cm. Changing a display unit preserves the physical load.
- Count completed sets, preserve exact start/completion timing and duration, calculate volume and carry confirmed targets to the next session.
- Allow completed workout corrections and deletion. Update associated daily-log mirrors without overwriting independently recorded exercises.
- Keep meal plans, food logs, meal-photo analysis and daily check-ins. Plans accept PDF, supported images or pasted text, with one active plan used by coaching.

## Measurement intake and factual history

Users enter readings manually, upload a scale/lab report or paste extracted text. Support BIA, anthropometry and unfamiliar numeric metrics without requiring a fixed manufacturer template.

1. Submit an owned original or text for extraction.
2. Review an editable draft: date, device/source, method, metrics, units, raw values, evidence and uncertainty. Extraction does not automatically confirm readings.
3. Confirm the readings. Facts and a durable background job commit together before model generation starts.
4. Show saved history immediately, followed by memory and insights. AI failure preserves measurements and exposes retry.

Limits: 10 MB per PDF/JPEG/PNG/WebP/GIF, 20 PDF pages, 60,000 pasted characters, 40 observations per import and 120 metrics per observation. Oversized extracted detail must be split before Firestore storage. The current browser picker offers PDF/JPEG/PNG/WebP.

Each canonical observation has a stable ID, nullable `measured_at` calendar date, source, method, metrics, optional notes, import reference and revision. Metrics preserve keys/labels, numeric values and units plus available raw values/units, evidence and confidence. Common metrics normalize to kg/cm/mm/percent; unfamiliar metrics retain their meaning and units. Missing is never zero.

- Keep multiple same-day readings. Missing/ambiguous dates stay undated and out of time trends; upload date is not silently substituted.
- Distinguish lean mass, muscle mass, skeletal muscle and percentages. A visceral-fat index is not a mass or percentage. Targets and reference ranges are not observations.
- Compare matching metrics/units within the same source and method. A device or method change must not imply directly comparable precision.
- Keep all same-day readings as facts; trends, comparisons, weekly summaries and forecasts use each day's median within its metric/unit/source/method group. At least two distinct dates are needed for a change over time. Unknown units remain unclassified until reviewed, including common tape measurements.
- Read legacy manual logs, collection reports and embedded reports through stable adapters. Deduplicate mirrored originals by their references.
- New writes are canonical. Editing/deleting a legacy observation suppresses and clears linked copies. Late updates cannot resurrect a deleted reading.
- Save/delete retries are idempotent. Deleting every reading from an import clears its extracted cache and permits deliberate reimport with valid new IDs.
- The timeline starts with ten readings and expands in tens without resetting during job polling. The server working set is bounded at 500 observations; additional history is explicitly flagged.

## Personal memory and insights

Personal memory lives in each user's Firebase data, independently of OpenAI conversation/response storage.

- Each reading gets a concise, localized own-facts-only summary (`facts-v2`). It is generated deterministically from that observation, so it cannot retain comparisons involving another deleted reading. Validate its text and fact hash before reuse. The original canonical record retains metrics omitted from the short summary.
- OpenAI generates the longitudinal digest, wins and next steps from exact confirmed observations, safe prior observation summaries, server-computed deltas and actual completed workout sessions. On-demand refresh supplies exact metrics even when all entry summaries are cached.
- Saving readings triggers memory/insight work automatically. Users can refresh for a selected period. New revisions invalidate older pending work, with a durable backlog for remaining confirmed entries.
- Workout context uses completed session sets, duration and volume; daily-log exercise mirrors are not counted again. Association does not establish causation.
- Revision, source-fingerprint and generation-token guards protect final writes. Re-read sources transactionally before publishing, including legacy records and workout history. Concurrent edits/deletes cannot publish stale analysis as current.
- Show failure/retry and hide stale insight text. State history/context bounds and insufficient comparable data explicitly.

## AI runtime

Python 3.12 Cloud Functions use the official OpenAI Python SDK Responses API with `store: false`, output caps, bounded retries and safe error mapping. LangGraph keeps router → diet/exercise/health/general specialist routing.

| Task | Configuration | Default |
| --- | --- | --- |
| Router/general coaching/routine/session/weekly narrative | `OPENAI_GENERAL_MODEL` | `gpt-6-luna` |
| Document/image extraction and health/progress analysis | `OPENAI_ANALYSIS_MODEL` | `gpt-6.1-sol` |

Production uses Google Cloud workload identity federation with the attached runtime service account. The SDK exchanges and refreshes short-lived tokens. No static OpenAI API-key fallback or service-account private-key file is used.

Nonsecret configuration: `AI_RUNTIME_SERVICE_ACCOUNT`, `OPENAI_IDENTITY_PROVIDER_ID`, `OPENAI_SERVICE_ACCOUNT_ID`, `OPENAI_AUDIENCE`. Missing configuration fails clearly. Every function uses the configured environment runtime identity; SMTP retains its separate secret configuration. Non-production signup/invitation messages are captured instead of sent externally.

Mock AI requires an explicit switch and an emulator or explicitly matched isolated QA project; production rejects the switch. Synthetic responses are labeled. The offline demo stays in the browser and makes no Firebase or paid AI calls. See the [official OpenAI Python SDK reference](https://developers.openai.com/api/reference/python) for GCP workload identity.

## Usage analytics

Owner-only reporting includes aggregate usage and identified user activity: active/new/returning users, sessions, approximate foreground time, adoption, invitation/request funnels, activation and seven-day return retention.

- Store UTC timestamps; report days in `America/Costa_Rica`.
- Sessions expire after 30 minutes without activity. Engagement uses 30-second foreground heartbeats after interaction, stops after inactivity and is deduplicated/throttled server-side.
- Exclude owner/demo/test traffic by default in production. QA uses synthetic accounts in its own project.
- Allowlist screen/action metadata. Never collect health values, chat/report content, raw URLs or invitation tokens. Account records supply names/emails for the owner view.
- Record durable actions server-side. Retries and out-of-order deliveries cannot duplicate milestones. History edits/deletions do not create another first workout completion.
- Retain raw events for 90 days and aggregates for 13 months. Analytics failure never blocks normal actions; historical sessions are not fabricated.

## Storage and interfaces

Preserve existing profile, log, routine, workout-session, meal-plan and chat paths. New server-owned user collections: `measurement_entries`, `measurement_imports`, `measurement_jobs`, `measurement_memory`, `progress_insights`, `measurement_state`, `measurement_requests`, `measurement_legacy_overrides`. Private health data is readable only by its approved account; owner analytics does not grant general health-record access.

Measurement callables: `parse_measurement_import`, `save_measurement_entries`, `update_measurement_entry`, `delete_measurement_entry`, `get_measurement_workspace`, `generate_progress_insights`, `retry_measurement_job`. Preserve existing AI callable response contracts through the provider migration.

Access and telemetry mutations also use validated server interfaces. Clients cannot write owner roles, invitation state, approval status, canonical measurements, derived memory or usage collections directly.

## Environments and validation

Production and QA use separate Firebase projects, Auth users, storage, runtime identities and OpenAI projects/mappings. QA uses captured mail and synthetic run-scoped fixtures; cleanup verifies the environment/run namespace. Production data and identities are not test fixtures.

Default validation: lint/build, offline backend/security checks and local Playwright using demo/emulator fixtures and synthetic AI. Preserve workout regressions; cover review/confirmation, units, historical adapters/previews, memory invalidation, failure/retry, invitations, authorization and EN/ES mobile layouts.

Run the complete local Playwright suite after the final implementation/test change and before publication. Focused runs are additional iteration checks. Local Playwright requires no separate QA approval; deployed-QA testing remains explicitly on demand.

The opt-in `test_measurement_firestore_integration.py` suite exercises real Firestore SDK transactions against an isolated loopback demo project: durable saves, duplicate delivery/recovery, final job writes, source invalidation and coaching/weekly context. It uses synthetic AI and calls the Functions implementations directly, so it does not claim HTTP transport or Eventarc-delivery coverage. Emulator 1.20.4 needs a documented test-only compatibility shim for pure descending document-key scans; production queries remain unchanged. Set `FIRESTORE_EMULATOR_HOST` to the loopback endpoint and `TAC_FIRESTORE_INTEGRATION=1` to run it.

Cloud regression is on demand only, after stating environment, cases, duration and API usage. Push, merge, ordinary tests and deployment do not implicitly start it. Production promotion remains a separate release step with explicit configuration and candidate verification.
