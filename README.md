# Training AI Coach

A private, mobile-first training space with a friendly daily dashboard, reliable workout tracking, measurement history, and optional AI coaching.

[Production app](https://ai-training-coach-6880b.web.app) · [Local development](docs/LOCAL_DEVELOPMENT.md) · [Validation](docs/VALIDATION.md) · [QA guide](docs/QA.md) · [OpenAI setup](docs/OPENAI_SETUP.md)

React 19 · TypeScript · MUI 7 · Firebase · Python 3.12 · LangGraph · OpenAI Responses API

The features below describe the current source. Deployment evidence is recorded in the [production release notes](docs/PRODUCTION_SETUP_STATUS.md) and [QA release notes](docs/QA_SETUP_STATUS.md).

## The experience

The app has four main destinations, with your profile and sign-out accessible on every device:

| Destination | What you can do |
| --- | --- |
| **Today** | Start or resume a scheduled workout, check the week’s training calendar, log meals and daily check-ins, and read the weekly report. |
| **Train** | Build or generate routines, assign workouts to weekdays, edit exercise targets and open exercise progress. |
| **Progress** | Open workout history or choose Summary, Trends or History for body measurements. Add readings and import reports. |
| **Coach** | Ask about training, nutrition or progress in English or Spanish. Start a new chat or review what the coach remembers. |

Three-step onboarding asks for your name, goal, training rhythm and coaching preferences. Age, biological sex, height, goal weight, nutrition and health details can be added later in your profile. Drafts belong to the signed-in user.

### Routines and workout logging

- Create routines manually or with AI, choose a preferred routine, and assign its workouts to weekdays. Swap a scheduled workout from Today while keeping the usual weekly schedule.
- Exercise autocomplete and animated previews in routine selection, active/historical workout editors and daily exercise logs. Library selections retain their demonstrations; custom names remain available when the library is offline.
- Use saved per-set weights and reps when starting a workout. **Adjust with AI** is optional.
- Choose kg or lb for workouts, with unit overrides for individual exercises. Specify whether a load is total, per dumbbell, per side, or the machine display. Confirm the convention for older recorded loads before reusing them as defaults. Body weight uses kg and circumferences use cm.
- Log sets with autosave, retry and Undo. Reopen a draft with its elapsed time and completed sets, use the optional rest timer, expand exercise notes as needed, and move exercises up or down within the session.
- Add an exercise or accept an AI-suggested alternative for the current workout or its routine day. Completed sets stay with the exercise you performed.
- Resume or cancel active sessions; edit or delete completed workouts with confirmation. Related routine totals and daily exercise logs stay synchronized.
- Actual completed sets in workout history, filters for routine/day/date/exercise, and per-set repetition charts with recorded loads.

Routine edits keep stable routine, day and exercise identities and preserve completed workouts, measurements and daily logs. Exercise progress includes earlier sessions through pagination, including exercises renamed or removed from the current plan.

### Measurements and coaching

Enter readings manually or review readings extracted from pasted text before saving. For a PDF or image report, **Save report** extracts and saves the readings with the original file. Open **History** to review or edit the saved date, source, method, values and units.

Measurement records preserve individual readings, units and source evidence, including additional metrics found in a report. Trends and goal forecasts use comparable readings from the same source and method. A newly saved report can show a concise progress update when background analysis is ready. Edits, deletions and backdated readings invalidate older summaries so that background jobs use the latest confirmed measurements.

The coach uses your profile, logs, confirmed measurements and completed workouts. **Coach memory** lets you review and forget saved goals, preferences and constraints. **New chat** starts a fresh conversation while keeping saved conversations and personal memory. Weekly reports focus on consistency, comparable exercise-level progress and a practical next session.

Nutrition remains available through meal logs, meal photo estimation, uploaded meal plans and daily calorie/protein summaries. Photo estimates are reviewed by the user before logging.

### Invitations and owner analytics

Google sign-in leads to an invitation or an access request. Approval and owner roles are enforced by the server; frontend navigation is not authorization.

- Verified-email invitations expire after seven days, are single use and can be copied, resent or revoked. Resending replaces the old token.
- The owner manages people, pending requests and invitation delivery from the owner space.
- Usage shows active users, sessions, feature adoption, acquisition and retention, with identified account/activity metadata.
- Analytics omit measurement values, report contents, health notes, chat text and arbitrary URLs. Personal records remain private to their account.
- Sessions use a 30-minute inactivity boundary and Costa Rica calendar reporting. Raw activity has a 90-day retention window; daily aggregates have a 397-day window.
- Owner/demo activity is excluded from product usage; synthetic QA users remain useful in the isolated QA dashboard.

Production email delivery depends on configured SMTP secrets. QA captures notification metadata instead of sending messages to real recipients.

## Run locally

To try the browser demo, use Node.js 22.12 or later on the 22.x line. Run these commands from the repository root, then open the URL printed by Vite and choose **Try the demo**.

```sh
npm ci --prefix web
npm run dev --prefix web -- --host 127.0.0.1
```

For Firebase Auth, Firestore, Storage and Functions on your machine, follow the [local development guide](docs/LOCAL_DEVELOPMENT.md#app-conectada-a-los-emuladores-de-firebase).

With the Firebase emulators running, run `npm run local:accounts` from the repository root. At `http://127.0.0.1:5173`, choose **Continue with Google** and select one of these accounts in the emulator popup. The test accounts sign in without passwords.

| Account | Email | Access |
| --- | --- | --- |
| Local Developer | `local@example.test` | Administrator |
| Local Athlete 1 | `athlete-1@example.test` | Approved user |
| Local Athlete 2 | `athlete-2@example.test` | Approved user |
| Local Athlete 3 | `athlete-3@example.test` | Approved user |

### Demo mode

Demo data and simulated AI live in browser storage: a sample profile, logs, routines, training history, measurements, invitations and usage views. You can exercise core flows without backend or paid model calls. The banner clearly identifies the simulation, and exiting clears its local state.

Inter is bundled locally. Exercise imagery/library assets may load from their public source when available. Meal-photo analysis is available in the connected app rather than the demo. The demo is not evidence that a cloud AI integration works.

## Architecture

```text
React / MUI / Router / Zustand / i18next / Recharts
   ├─ Demo: browser storage + deterministic simulated services
   └─ Firebase SDK: Auth, Firestore, Storage, HTTPS callables
          ├─ access_api.py: invitations and approval
          ├─ usage_api.py: allowlisted activity and owner reports
          ├─ main.py + LangGraph: coach, routines, session planning, nutrition
          └─ measurement_api.py:
                import draft → reviewed facts + durable job
                → revision/fingerprint checks → summaries and progress memory

All server model calls
   → shared Responses adapter
   → short-lived GCP workload identity
   → configured OpenAI project/service account
```

The LangGraph coordinator classifies a message and routes it to diet, exercise, health or general coaching. Context includes the available profile, active meal plan, recent logs, confirmed measurement facts and current progress memory.

The shared adapter uses the OpenAI Responses API with `store: false`. Files/images are sent inline; this implementation does not create persistent OpenAI file or conversation objects. Authentication uses the dedicated Google runtime identity and the SDK's GCP identity-token provider. There is no long-lived OpenAI API-key or downloaded service-account-key path.

| Server parameter | Default / purpose |
| --- | --- |
| `AI_RUNTIME_SERVICE_ACCOUNT` | Dedicated environment-specific Google runtime identity |
| `OPENAI_IDENTITY_PROVIDER_ID` | OpenAI workload identity provider identifier |
| `OPENAI_SERVICE_ACCOUNT_ID` | OpenAI service account identifier |
| `OPENAI_AUDIENCE` | `https://api.openai.com/v1` |
| `OPENAI_GENERAL_MODEL` | `gpt-5.6-terra` for general coaching tasks |
| `OPENAI_ANALYSIS_MODEL` | `gpt-5.6-terra` for extraction/progress tasks |

The identifiers and model names are configurable deployment values. Account entitlements, federation and paid usage require separate cloud verification. Mock responses are confined to explicit emulators or an explicitly isolated QA project; production does not silently fall back to simulated AI.

## Data and authorization

| Firestore path | Purpose |
| --- | --- |
| `admins/{uid}` | Server-managed owner role; not client-writable |
| `user_status/{uid}` | Server-managed pending/approved/rejected access |
| `invitations/{id}`, `access_audit/{id}` | Hashed invitation lifecycle and access audit |
| `users/{uid}/profile/data` | Editable preferences; optional health/body fields |
| `users/{uid}/routines/{id}` | Routine template, days, exercise targets and last working defaults |
| `users/{uid}/workout_sessions/{id}` | Actual session status, sets, units, timing and totals |
| `users/{uid}/logs/{date}` | Daily check-ins, meals and mirrored exercise logs |
| `users/{uid}/measurement_entries/{id}` | Canonical reviewed observations |
| `users/{uid}/measurement_imports/{id}` | Reviewable extraction drafts |
| `users/{uid}/measurement_jobs/{id}` | Durable revision-aware background work |
| `users/{uid}/measurement_memory/{id}`, `users/{uid}/progress_insights/{id}` | Derived summaries and cached progress views |
| `users/{uid}/chat_memory/state` | Personal facts saved across coaching conversations |
| `users/{uid}/meal_plans/{id}`, `body_composition_reports/{id}` | Uploaded plans and compatible existing report records |
| `users/{uid}/chat_sessions/{id}`, `weekly_reports/{id}` | Private coaching history and weekly reports |
| `usage_events/{id}`, `usage_users/{uid}`, `usage_user_days/{id}` | Restricted usage metadata and aggregates |

Rules require approved access for private data. A user cannot grant their own approval/owner role or read another person's health records. Canonical measurement mutations and analytics use validated server operations; legacy records stay readable through compatibility adapters.

Owner bootstrap is a separate privileged command that targets one explicitly supplied, existing Firebase UID. It does not infer the owner from a frontend flag or the active CLI account. See [QA and owner bootstrap](docs/QA.md#owner-bootstrap).

## Development and local checks

Install the dependencies in the [local development guide](docs/LOCAL_DEVELOPMENT.md#ejecutá-las-verificaciones-locales), then run this from the repository root:

```powershell
npm run check
```

The default check runs frontend lint/build, offline Python tests, environment guards, Firebase emulator authorization tests and Playwright against local demo data. It does not deploy, send real email or make paid model calls.

The complete local Playwright suite is mandatory after the final implementation/test change and before publication. Focused runs supplement it; they do not replace it. Local Playwright runs without a separate cloud-QA request. Deployed-QA regression and live model testing remain on demand only.

Individual checks:

```powershell
npm run lint --prefix web
npm run build --prefix web
npm run test:backend
npm run test:environment
npm run test:security
npm run test:playwright
```

The local browser suites cover preserved workout data/units/defaults, completion/history/editing/deletion, timing, navigation, measurement workflows, access/usage views and responsive layouts. Visual captures from the redesign checks are written to ignored `web/test-results/design/`.

Routine regression coverage uses synthetic before-and-after records for template edits, legacy conversions, renamed or removed exercises, resumable drafts and older workout history.

`web/playwright.config.ts` discovers only local `web/e2e/` tests. The separate `web/playwright.qa.config.ts` and `web/e2e-cloud/` are manual-only and require exact QA project/URL confirmation, a verified deployment marker and synthetic credentials. The normal CI workflow uses local checks; it does not include cloud regression.

## Environment setup and releases

Keep production and QA in different Firebase/Google/OpenAI projects and runtime identities. Start from the non-secret examples in `environments/`; local manifests, generated parameters and credentials are ignored by Git.

The [QA guide](docs/QA.md) covers billing/API readiness, Firebase providers and resources, workload identity checkpoints, synthetic account seeding, Secret Manager, owner bootstrap and exact manual-run commands.

```powershell
npm run qa:prepare -- --config environments/qa.local.json
```

Preparation generates local configuration only. Cloud deployment requires a matching project confirmation. Cloud regression requires a separate explicit request and is never inferred from a push, merge or deployment. Live-AI measurement verification has an additional explicit project flag and a documented paid-call scope.

QA runs on manual demand: zero minimum instances, at most one instance per function, no scheduled cleanup or automatic analytics TTL deletion, and real AI locked until an operator opens a short, scoped request budget. Deployment leaves it locked. Use `npm run qa:status -- --config environments/qa.local.json` to inspect the AI lock, and the [QA guide](docs/QA.md) for explicit activation, revocation and maintenance. Retained cloud storage, builds and actual requests can still incur costs.

An ordinary deploy request includes **both QA and production**, unless explicitly narrowed. Real measurements, reports, personal coach memory and training data belong in production; QA is reserved for synthetic regression data and testing on demand. Each destination uses its own reviewed configuration and must be verified independently. See [production release status](docs/PRODUCTION_SETUP_STATUS.md) for the actual published versions and evidence. A local demo test, prepared manifest, created cloud project or successful QA seed is not a production release or a live federation check.

## Project layout

```text
functions/
  main.py, agents/                  coaching and LangGraph routing
  access_api.py, usage_api.py       authorization, invitations and telemetry
  measurement_api.py               reviewed facts and asynchronous progress jobs
  lib/openai_client.py              Responses API + workload identity
  lib/measurements.py               normalization and deterministic calculations
  scripts/                         guarded QA seeding and owner bootstrap
  tests/                           offline backend and safety checks
web/
  src/components/layout/           shared shell, navigation and theme components
  src/components/measurements/     measurement workspace and compatible history
  src/pages/                       Today, Train, Progress, Coach, Profile, owner space
  src/pages/onboarding/            three-step setup
  src/firebase/, src/demo/         cloud adapters and isolated local simulation
  e2e/, e2e-rules/, e2e-cloud/      local UI, emulator rules and separate cloud QA
scripts/                           environment, checks and guarded cloud runner
environments/                      non-secret manifest examples
docs/QA.md                         setup, manual scopes and cleanup
```

Exercise demonstrations and metadata use [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db).
