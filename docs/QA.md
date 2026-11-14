# Isolated QA and manual cloud regression

The normal development and CI path uses local demo data, offline backend tests and Firebase emulators. Cloud regression is a separate, explicitly requested action. Neither a push, a pull request nor `npm run check` authorizes or starts a cloud run.

An ordinary request to **deploy** or **publish** now means releasing the reviewed candidate to **both QA and production**, unless the user explicitly names a single environment. This deployment scope does not start cloud regression or paid model tests. The explicit `qa:deploy` operator command below remains QA-only.

**Real personal data belongs in production**. Use synthetic accounts and records in QA. See [QA setup status](QA_SETUP_STATUS.md) for deployment details.

## Idle by default

QA deploys with automatic paid AI closed. Browsing QA, signing in, finishing onboarding, saving a synthetic measurement or leaving a tab open does not open an AI window. The separately enabled manual-chat policy below permits only explicitly submitted chat messages; synthetic and demo accounts have ten messages per Costa Rica day. Production real accounts have no application daily chat cap. The QA policy retains compatibility for approved real owners and accepted invitees, but personal coaching and records belong in production. Other actual QA provider requests require a server-only, project-specific lease for an exact synthetic user and task. Missing, expired, exhausted or revoked grants fail closed before provider authentication or a model call. Browser clients cannot write the controls, and grants are never positively cached.

QA weekly reports are read from saved data and generated only after an explicit click. Missing/stale reports, read failures and language changes do not start generation. Production and the on-device demo retain automatic weekly reports. QA usage keeps explicit screen/action events but disables the periodic usage heartbeat. Pending measurement status checks pause in hidden QA tabs and stop after 60 seconds; **Refresh status** starts another bounded observation window without requesting a new analysis.

This controls paid AI and background activity; it does not promise a zero cloud bill. Manually browsing QA still uses Auth, Firestore reads/listeners and read-only Functions, and explicit uploads use Storage. Hosting, retained uploads/build artifacts and other provisioned resources can have small costs. Use **Try the demo** for local sample data, simulated coaching and local measurement parsing; it requires no cloud account. Exercise images/library assets may still load from their public static source.

Read the current lease status without opening one:

```powershell
npm run qa:status -- --config environments/qa.local.json
```

Disable any open AI window when finished:

```powershell
npm run qa:ai:disable -- --config environments/qa.local.json
```

The separate QA idle operation also removes the QA analytics cleanup Scheduler resource and disables its analytics TTL policies. It requires the exact QA project confirmation; it does not destroy the application or its fixtures:

```powershell
npm run qa:idle -- --config environments/qa.local.json --confirm-project training-coach-qa-20261017
```

## Manual chat for real users and demos

An operator can separately enable the server-only `runtime_controls/qa_manual_chat` policy for the exact QA project:

```json
{
  "enabled": true,
  "project_id": "training-coach-qa-20261017",
  "timezone": "America/Costa_Rica",
  "demo_daily_messages": 10,
  "real_users_unlimited": true
}
```

The server requires approved status and derives the account category from protected records. A real owner role or a linked accepted invitation grants uncapped manual chat when `real_users_unlimited` is explicitly true. Invitation verification checks `user_status.invitation_id`, the invitation's accepted status, matching `accepted_by` UID and matching email; `acquisition` alone is insufficient. Trusted synthetic/test markers, reserved fixture UIDs and reserved test email addresses take precedence, even when that account also has an owner role or accepted invitation. Client-writable profile data and request flags cannot select a category. Unknown approved users without verified invitation provenance retain the ordinary explicit test-lease path; missing policy grants no manual allowance.

Only the authenticated chat callable enters the server scope. Real accounts do not read or write daily quota counters, including old exhausted counters. Synthetic/demo accounts atomically reserve one message against `qa_manual_chat_usage/{uid}_{YYYY-MM-DD}` and stop at ten per day. The date key resets this allowance at Costa Rica midnight without scheduled work; failed demo attempts spend their reserved message. Every message still permits at most two provider attempts: classifier plus answer, including the progress specialist. QA SDK retries remain disabled. A shared reservation follows graph context copies and is revoked when the request exits, including errors. Policy, approval and category are rechecked before each provider attempt. Automatic analysis, report jobs, extraction and other callables cannot inherit this scope.

The on-device **Try the demo** chat also allows ten simulated messages per Costa Rica day. Its browser allowance persists across reloads, demo resets and demo exit/re-entry, then resets at Costa Rica midnight. It does not call a model provider.

The demo allowance is a request limit, not a fixed dollar budget. Disable manual chat by setting its server policy's `enabled` to `false`; preserve existing demo counters. `qa:status`, `qa:ai:disable` and `qa:idle` refer to the separate temporary test lease, which keeps automatic QA AI closed. Deployments never enable the manual policy or reset its counters. The app cannot read or change the server controls or daily budget. Reaching the demo cap leaves the message recoverable in the composer without resending it automatically. Production chat remains unchanged and has no application daily cap from this QA policy.

## Chat formatting, personal memory and factual progress

Coach replies, including existing messages, display Markdown headings, emphasis, lists and tables. Wide tables and code scroll inside the message on mobile. User messages remain plain text. Raw HTML is skipped, remote images show only their alternative text, and links permit only HTTP, HTTPS or email destinations with safe new-tab attributes.

**New chat** / **Nuevo chat** is visible in the chat header on narrow mobile screens and desktop. It clears the current conversation view, unsent draft and error/status messages while retaining saved sessions, personal memory and the demo's daily allowance. It is disabled while a reply is pending. Starting another chat does not create an empty saved session: the next explicit send creates the new session. Auth changes clear the active view, and late replies cannot populate another account's conversation.

**Coach memory** opens two separate views. **About you** lists durable personal facts saved across conversations; **Your progress** shows a calculated overview of saved measurements and completed workouts. Only the selected tab is fetched: opening personal memory does not query progress, and progress is loaded when selected. The closed dialog makes no requests and does not poll or request model output. **Tell the coach something** prepares a draft; sending it is an ordinary manual chat request. **Forget** and **Forget all** require confirmation and remove saved personal facts while keeping the original chat, profile and measurement records.

The **Progress** landing view makes no measurement queries until **Summary**, **Trends** or **History** is selected. Each selection requests its own data. History requests ten rows at a time using a real server cursor; loading more fetches the next page instead of revealing an already downloaded full history. Trends sends its period, metric/unit and source/method filters to the server. Summary uses the deterministic history digest described below. These reads do not start model analysis; explicitly requested mutations or analysis retain their existing QA gates.

Personal memory holds at most 30 facts of 400 characters each in `users/{uid}/chat_memory/state`. Only complete, explicit first-person statements from the latest user message can become facts; assistant claims, inferred health conclusions, one-off readings, secrets and instructions are excluded. Each fact retains its category, source session/message and timestamps. A reply and up to four memory proposals share the specialist's structured Responses request: the normal path remains one classifier request plus one answer request, with no extra model pass for memory. The app reports whether memory was saved, unavailable, full or changed concurrently.

The existing `chat` callable handles `action: "memory_get"` and `action: "memory_delete"` before entering model quota or manual-chat scope. Explicit, unambiguous forget commands also work without a model allowance. Authentication and approval still apply, and Firestore clients cannot write memory directly. Deletion requires the current revision; every deletion advances it, including clearing an empty list. A late reply using an older revision cannot restore a forgotten fact. Memory read failures do not overwrite unknown facts.

The factual progress digest is deterministic and separate from personal memory and model-generated analysis. It covers all available measurement/workout history, plus a recent 90-day view, using daily medians and separate source/method/metric/unit groups. Mass and percentage remain distinct; percentage changes use percentage points. Invalid/future dates and any read/detail limits are disclosed rather than turned into trends. Reads are bounded to 5,000 observations and 5,000 sessions; a limit means the overview describes the loaded history. Source fingerprints and revisions prevent stale cached summaries after edits or deletions. Reading or rebuilding this digest makes no provider request and enqueues no AI job, although ordinary Functions/Firestore work still occurs.

Narrative version 2 keeps the `progress-facts-v1` wire kind and expands the overview into seven explanatory sections: coverage, weight chronology, body composition and girths, recent versus full-history changes, saved workouts, method limits and future manual tracking. Dated intermediate checkpoints and daily-median extremes prevent an endpoint delta from hiding intervening phases. Per-week changes describe only the observed interval, with no forecast. Version-aware fingerprints refresh an older short summary once. Formula-qualified anthropometry metrics retain their own labels and series; they are never subtracted from BIA estimates to claim tissue gain or loss. General BIA testing-condition wording follows [manufacturer guidance](https://inbodyusa.com/general/inbody-test/).

Manual entry includes named arm/calf circumferences, bone breadths and individual/summed skinfolds with cm/mm defaults. It still starts with three blank fields; absent optional measurements are omitted. Save the actual source and method when continuing without a clinic report. The guarded operator importer supports the reviewed Fitdays export and reviewed anthropometry-PDF format only; each anthropometry visit must link a unique original PDF/hash/date. It creates observations and factual entry memories atomically after backup, invalidates prior analysis, and never starts an AI job. Original PDF text may contain invisible spreadsheet cells: only visually reviewed values belong in confirmed facts; hidden cells, reference tables and rounded chart duplicates remain separate provenance.

These features reuse existing callable exports; QA has 32 exports, with no new trigger, scheduled task or background job for these features. Production has 33 current functions plus three retained legacy functions. The automatic QA AI lease stays closed by default, and the separately controlled manual-chat policy is unchanged. Local Markdown, memory and factual-digest tests use synthetic fixtures or a stub provider; their results do not establish live model quality. Current deployment evidence is recorded in [QA setup status](QA_SETUP_STATUS.md).

## Environments and readiness

Production is `ai-training-coach-6880b`. The dedicated QA project is `training-coach-qa-20261017`; use its exact project ID throughout. A created Google Cloud project is not a deployed or validated QA application.

Copy `environments/qa.example.json` to ignored `environments/qa.local.json` and supply the actual Firebase web app, bucket, runtime service account and OpenAI federation IDs. The manifest contains identifiers, not credentials. The QA Hosting origin must be exactly `https://PROJECT_ID.web.app`, and the bucket and runtime identity must belong to that project.

Complete these checkpoints before deployment or seeding:

1. Attach an active billing account and enable the APIs needed by Firebase Auth, Firestore, Storage, Hosting, Functions and Secret Manager. Functions and Storage provisioning can remain blocked until billing is active.
2. Create the Firebase web app, Firestore database and Storage bucket. Enable Google sign-in. Enable email/password sign-in only in QA for the reserved synthetic accounts; the production UI and build must keep QA authentication disabled.
3. Create the dedicated QA AI runtime service account. Configure its required Firebase resource permissions and use this identity for the AI functions. Do not share production storage, credentials or runtime identities.
4. Configure a separate OpenAI project, identity provider and service account for QA. Bind the Google runtime subject and the configured audience to that identity. Record `OPENAI_IDENTITY_PROVIDER_ID`, `OPENAI_SERVICE_ACCOUNT_ID` and `OPENAI_AUDIENCE`; confirm that the configured models are accessible from that project. Set an appropriate project budget before any live-AI request.
5. Prepare parameters with `APP_ENV=qa`, the exact `QA_FIREBASE_PROJECT_ID` and `APP_BASE_URL`. QA captures invitation/signup notification metadata instead of sending real email. `AI_MOCK_ENABLED=false` permits the real provider path only through the separately enabled manual-chat policy or a valid explicit QA AI lease. Measurement mutations may enqueue jobs while automatic AI is closed; their facts remain saved, and the worker records a paused failure without a provider call or automatic requeue.
6. Deploy the guarded QA configuration, rules and indexes. Verify the Hosting `/environment.json` marker reports both `environment: "qa"` and the exact project ID. Never point QA at a production deployment.

Preparation is local and does not provision cloud resources:

```powershell
npm run qa:prepare -- --config environments/qa.local.json
```

The separately requested deployment uses an exact project confirmation:

```powershell
npm run qa:deploy -- --config environments/qa.local.json --confirm-project training-coach-qa-20261017
```

The configured model defaults are `gpt-6-luna` for general coaching and `gpt-6.1-sol` for extraction/progress analysis. These are deployment parameters, not a guarantee of account entitlement. There is no API-key or downloadable service-account-key setup path for OpenAI: the server uses the SDK's short-lived GCP workload identity provider.

## Synthetic accounts and credentials

Run the seed tool only after the QA resources and deployment parameters are ready. It accepts a dedicated `-qa-` project and an exact repeated confirmation; it rejects production, mismatched project IDs and mixed cloud/emulator settings before any cloud access.

```powershell
functions/venv/Scripts/python.exe functions/scripts/seed_qa.py --project training-coach-qa-20261017 --confirm-project training-coach-qa-20261017 --run-id seed-v1 --dry-run
functions/venv/Scripts/python.exe functions/scripts/seed_qa.py --project training-coach-qa-20261017 --confirm-project training-coach-qa-20261017 --run-id seed-v1
```

The tool creates these stable, verified synthetic email/password Auth accounts; none is a real Google account:

| Role in credentials JSON | Reserved UID | Access |
| --- | --- | --- |
| `owner` | `qa_owner` | Server-owned owner role |
| `approvedA` | `qa_approved_a` | Approved private space A |
| `approvedB` | `qa_approved_b` | Approved private space B |
| `pending` | `qa_pending` | Pending approval |
| `rejected` | `qa_rejected` | Declined access |
| `invitationRecipient` | `qa_invitation_recipient` | Pending recipient for a deliberately created invitation |

All fixture addresses use `@training-coach-qa.example.test`. The script refuses to overwrite a reserved UID with a different email or an existing fixture document without its synthetic marker.

Passwords are generated in memory and stored only in the project's Secret Manager secret `training-coach-qa-test-users` by default. The JSON contract is:

```text
{
  schemaVersion: 1,
  projectId: "the confirmed QA project",
  runId: "seed-v1",
  generatedAt: "ISO timestamp",
  users: {
    owner: { uid, email, displayName, password },
    approvedA: { uid, email, displayName, password },
    approvedB: { uid, email, displayName, password },
    pending: { uid, email, displayName, password },
    rejected: { uid, email, displayName, password },
    invitationRecipient: { uid, email, displayName, password }
  }
}
```

The seed is repeatable: it retains existing secret values and reapplies the same passwords to the reserved accounts. Only `--rotate-passwords` generates replacements. A missing password for an existing account causes a refusal unless rotation is explicitly selected. Re-seeding refreshes the synthetic baseline and weekly report; use it when the requested cloud run needs a clean baseline. A fresh report is fixture data, not the AI cost guard.

No password, access token or secret JSON is printed or put in command-line arguments. The scripts prefer ADC, then capture a short-lived `gcloud auth print-access-token` result inside Python. User credentials explicitly use the confirmed target as their quota project; the active gcloud project and production quota settings are not changed. They do not download credential JSON keys. SDK failures report only a stage, exception class and safe code.

An optional local credential store must be explicitly selected. This bypasses Secret Manager completely and is suitable while that API/billing setup is blocked:

```powershell
functions/venv/Scripts/python.exe functions/scripts/seed_qa.py --project training-coach-qa-20261017 --confirm-project training-coach-qa-20261017 --credentials-file .qa/test-users.local.json
```

This path must resolve inside ignored `.qa/`; the file is written with mode `0600` before any Auth mutations. A failure can be retried with the same file and passwords. Do not commit this file or place it in the web public directory. In this explicit mode the local file is authoritative; the cloud regression runner cannot use it until it is published to Secret Manager.

When Secret Manager is ready, publish the same credentials without rotating them. Publication reads the private file and writes the secret only; it does not re-seed or modify Auth/Firestore:

```powershell
functions/venv/Scripts/python.exe functions/scripts/seed_qa.py --project training-coach-qa-20261017 --confirm-project training-coach-qa-20261017 --credentials-file .qa/test-users.local.json --publish-secret
```

The seed writes profiles, routines, canonical measurement observations and a fresh synthetic weekly report for approved accounts. It never creates legacy daily logs, workout sessions, report imports or measurement jobs. Some of those paths can enqueue analysis jobs; actual provider processing remains blocked by the closed QA AI lease.

## Owner bootstrap

Production owner access comes from an Admin SDK-created `admins/{uid}` document, not a frontend UID flag. The bootstrap tool requires the exact project and the exact UID of an existing enabled Firebase Auth account:

```powershell
functions/venv/Scripts/python.exe functions/scripts/bootstrap_owner.py --project ai-training-coach-6880b --confirm-project ai-training-coach-6880b --uid EXISTING_FIREBASE_AUTH_UID --dry-run
```

Remove `--dry-run` only for the requested owner-role setup. The tool creates one owner-role document, preserves any existing role, and leaves profiles, status records and Auth accounts unchanged. It never infers the owner from the active CLI identity.

## Restoring the owner's existing training data

Historical workflow retained for recovery evidence, not current QA seeding. The current policy keeps real training data in production and uses synthetic QA fixtures.

The earlier owner-requested `functions/scripts/restore_training.py` copy moved original production routines and completed sessions into the same person's QA account. Both enabled, email-verified Auth accounts must have the same Google provider identity and email. The target must already have approved access, and QA AI must be closed. This is separate from synthetic seeding and cloud regression.

Run a read-only inventory with the exact account IDs and reviewed counts:

```powershell
functions/venv/Scripts/python.exe functions/scripts/restore_training.py --target-project training-coach-qa-20261017 --confirm-target-project training-coach-qa-20261017 --source-uid ORIGINAL_OWNER_UID --target-uid QA_OWNER_UID --expected-routines 1 --expected-sessions 1
```

After reviewing the counts, add `--apply` for the requested copy. The tool saves a private typed backup under ignored `.qa/training-restore/`, preserves document IDs and raw training fields, and creates missing target documents only. Different existing documents, active or unknown-status source sessions, and private source media block the copy. Readback verifies field fidelity and the app's history query; an identical repeat creates nothing. Production is read only. Profiles, measurements, daily logs and AI jobs are outside this transfer.

## Reviewed historical measurement imports

The normal production upload flow accepts report images and PDFs, shows the original beside editable extracted values, and saves only after review. Fitdays mass and percentage readings remain separate. Printed readings, reference ranges and recommended changes are distinguished. A `.csv` filename is not proof of CSV content.

The QA importer commands below document the historical owner-data import and its recovery safeguards. They are not the current path for real measurements: use production, and keep QA imports synthetic.

`functions/scripts/import_measurements.py` accepts a reviewed JSON envelope under ignored `.qa/` with the original file SHA-256, stable per-reading IDs, normalized entries and separate source metadata. It requires an exact confirmed QA project, an enabled and verified owner with approved status, an explicitly closed AI control, and the expected entry count. An optional source UID verifies the same original production Google identity without changing production.

```powershell
functions/venv/Scripts/python.exe functions/scripts/import_measurements.py --project training-coach-qa-20261017 --confirm-project training-coach-qa-20261017 --uid QA_OWNER_UID --input-file .qa/reviewed-measurements.json --expected-entries EXPECTED_COUNT --source-uid ORIGINAL_OWNER_UID
```

The default is read only. After reviewing the counts, add `--apply` for the requested import. A private typed backup precedes an atomic create-only transaction. Each observation receives a deterministic `facts-v2` memory, including separate same-day readings; unknown values are never filled with zero. Targets, reference values, original cells and attachment discrepancies remain provenance. Existing differing or edited records block the operation, and an identical repeat changes nothing. The rolling AI view is marked stale with `QA_AI_PAUSED`; no analysis jobs or model requests are created. Source files must already be preserved in the owner's exact QA measurement-import folder. Original provenance survives later edits and cannot be replaced by client-supplied metadata.

## Manual cloud smoke tests

For an exploratory manual walkthrough, offer the following scope before starting. Use only this QA project and its six synthetic accounts, refresh the seed baseline first, and agree whether live AI is included. Allow about 15–25 minutes for the core walkthrough; the automated cloud smoke below is a shorter alternative.

| Journey | Manual checks | Live-AI scope |
| --- | --- | --- |
| Welcome and navigation | Desktop, narrow mobile, EN/ES, Today/Train/Progress/Coach, profile and sign-out | No |
| Access boundaries | Approved A/B have separate spaces; pending/rejected accounts stay gated; owner controls stay private | No |
| Invitations | Create/copy, wrong-email handling, verified recipient acceptance, resend invalidates old link, revoke; QA email stays captured | No |
| Usage | Navigate as approved A/B and review owner totals/activity; confirm health/chat/report contents are absent | No |
| Routine editing | Create a manual multi-day routine, edit one day, keep other days/history intact; use the searchable exercise library | No |
| Workout tracking | Saved targets, per-machine units, per-set values, resume/reload, timer, finish, history corrections and deletion | No, with AI adjustment left off |
| Cancellation | Acknowledge an autosave, discard the active workout, verify prior targets/history/logs; preserve a newer explicit routine edit | No |
| Existing measurements | Read seeded records, original previews where available, source/method/unit filters and daily-median chart behavior; open/cancel manual drafts | No |
| Coach memory and factual progress | Read both memory tabs; confirm forgetting one/all personal facts preserves chat and measurements; inspect factual history and its limitations | No; these actions do not reserve a model message or request output |
| Measurement processing | Manual save, pasted extraction, PDF/image extraction, correction/backdate/delete, saved memory and on-demand refresh | Only in an explicitly opened lease; saves/edits/deletes/refresh can enqueue analysis, and extraction is a separate provider request |
| Other AI coaching | Send chat, generate a routine, choose AI session adjustment, request weekly report, analyze meal/exercise photos or parse a meal plan | Yes |

Do not expand a no-AI run into measurement saves or AI coaching. For live checks, state the exact cases, permitted users/tasks, request ceiling, expiry and potential API usage before execution. QA disables SDK retries; each real provider attempt consumes a permit, including separate agent/analysis calls, and failed attempts do not refund permits. The one-PDF scope below is a bounded first check. Record actual outcomes and retained synthetic artifacts; leave unsupported/unrun cases clearly marked.

Deployment integrity checking is separate from these journeys. Immediately after publishing a QA build, verify its marker, HTML, bundle and caching against the current local candidate:

```powershell
node scripts/verify-hosting.mjs --config environments/qa.local.json
```

The cloud suite lives in `web/e2e-cloud/` and uses `web/playwright.qa.config.ts`. The ordinary Playwright configuration only discovers `web/e2e/`.

After an explicit request for this QA project:

```powershell
npm run qa:regression -- --config environments/qa.local.json --run-requested training-coach-qa-20261017
```

The runner verifies the exact Hosting environment marker, fetches `training-coach-qa-test-users` into memory just before execution, and injects it as `QA_TEST_USERS_JSON`. Never print or paste that payload. The frontend script contract is `npm run test:qa --prefix web`, which runs `playwright test --config playwright.qa.config.ts`.

The suite refuses configuration unless:

- `QA_REGRESSION_REQUESTED` exactly equals `QA_FIREBASE_PROJECT_ID` and identifies a dedicated QA project.
- `QA_BASE_URL` is exactly `https://PROJECT_ID.web.app`.
- The live marker confirms that project and `environment: "qa"` before any login or test action.
- The injected credentials have the expected project, schema and six synthetic roles.

Default cloud smoke coverage checks the public Google sign-in button, approved A/B private spaces, pending/rejected gates, and owner usage/people metadata. It does not click Google OAuth, approve people, issue invitations, start workouts, change measurements or request model output. Authentication and the app's normal usage telemetry can still write QA metadata.

Model callables and mutation endpoints that enqueue measurement AI are blocked by default; an attempted automatic AI request fails the smoke test before that browser request reaches the server. The backend lease independently blocks provider work, including already queued jobs. Keep the lease closed for no-AI smoke and avoid overlapping another operator's live-AI run.

Playwright retries, traces and video are disabled for this suite. Failure screenshots contain synthetic UI data; passwords are masked, password-entry failures are redacted, and credentials are not attached to reports. Outputs go to ignored `web/test-results/cloud-qa/`.

## Separately requested live-AI measurement check

The runner defaults `QA_LIVE_AI_TESTS` to `false` even if the parent environment says otherwise. A live request requires both an already open, bounded server lease and the separate exact project flag. It does not open a lease automatically.

After the live scope is explicitly requested, open a window for the test's actual account, `qa_approved_b`, and only its extraction/progress tasks:

```powershell
npm run qa:ai:enable -- --config environments/qa.local.json --run-requested training-coach-qa-20261017 --uid qa_approved_b --task extraction --task progress --minutes 10 --requests 4
npm run qa:status -- --config environments/qa.local.json
```

The defaults are 10 minutes and 4 provider requests; the hard limits are 30 minutes and 20 requests. Only reserved approved fixture UIDs (`qa_owner`, `qa_approved_a`, `qa_approved_b`) and explicit tasks (`general`, `extraction`, `progress`) are accepted. A duration/request limit is a technical ceiling, not approval to use the whole budget.

The additional test uploads a generated one-page synthetic PDF, checks extracted date/weight/body-fat/waist values, confirms the reviewed reading, and waits for the real background progress memory:

```powershell
npm run qa:regression -- --config environments/qa.local.json --run-requested training-coach-qa-20261017 --live-ai-requested training-coach-qa-20261017
```

Only that explicit live scope injects `QA_LIVE_AI_TESTS=true`. Both the manual regression flag and the live-AI flag must match the QA project. Before launching the browser, the runner checks that the existing lease permits `qa_approved_b`, extraction and progress with sufficient remaining requests. It disables that lease in its completion/failure cleanup; status and explicit disable remain available if the operator is interrupted.

Before enabling it, confirm the environment, one-run scope and potential costs. This makes a real extraction request plus real summary processing, uses QA Storage/Firestore/Functions, and may take several minutes. SDK retries and automatic Playwright reruns are disabled in QA. It requires working QA billing, OpenAI federation, model access and budget. No production or personal health data is used.

The run ID can be supplied as `QA_RUN_ID`; the source and notes identify the generated reading. The reading is retained as QA evidence. Deleting it can enqueue summary work, but a closed lease parks that processing. A paused job is never automatically revived by opening a lease: a deliberately requested retry is required. Do not add automatic deletion or repeatedly retry a failed live-AI run without reviewing its state/costs.

## Cleanup and local safeguards

Every seed has a synthetic `qa_runs/{runId}` marker containing its exact document list and Auth UIDs created by that run. Cleanup is explicit and limited to matching synthetic records:

```powershell
functions/venv/Scripts/python.exe functions/scripts/seed_qa.py --project training-coach-qa-20261017 --confirm-project training-coach-qa-20261017 --cleanup-run seed-v1 --dry-run
functions/venv/Scripts/python.exe functions/scripts/seed_qa.py --project training-coach-qa-20261017 --confirm-project training-coach-qa-20261017 --cleanup-run seed-v1
```

It does not enumerate/delete all Auth users or recursively remove user collections. Records owned by a later seed run are retained; the credentials secret is retained. The cleanup targets seed-owned baseline documents, not additional cloud-test uploads/jobs/telemetry. Remove those only by their explicitly identified run/account/artifact scope.

For the separate local emulator exception, use exactly `demo-training-coach`, loopback `FIREBASE_AUTH_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST`, and an explicit `.qa/` credentials file. No other project may use emulator overrides.

Run the offline safety tests without cloud credentials:

```powershell
functions/venv/Scripts/python.exe -m unittest discover -s functions/tests -p test_qa_safety.py -v
```

They check production refusal before network access, emulator confinement, inert fixture paths, stable passwords, UID collision refusal, cleanup containment, redacted failures and owner bootstrap preservation. Passing local checks is evidence about the local implementation; it is not evidence that QA billing, deployment or live model federation works.
