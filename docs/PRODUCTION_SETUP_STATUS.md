# Production release status

## Mobile action hierarchy and private usage counts — October 25, 2026

Published and verified at `2026-10-25T23:39:16.028Z` (UTC). Hosting matches HTML, the environment marker, all **77** JS/CSS assets and cache policies. Existing `record_usage` and `usage_report` callables are ACTIVE and reject anonymous requests with 401. The environment retains **36** functions; non-target metadata, runtime identities, parameters, secret references and triggers are unchanged. Google materialized the two production HTTP functions' previously unset maximum as **100**, the documented platform default; this sole normalization is recorded and every other runtime setting was preserved.

The interface prioritizes compact weight/repetition/set recording and groups occasional controls. Interaction counts are private, bounded batches without health values or text, stored separately from ordinary daily analytics so older writers cannot erase them or inflate visit/active-day statistics. Completed workouts, measurements and daily logs were not migrated or rewritten. The final local gate passed 282 Playwright cases, 225 backend cases (six opt-in skips), 24 environment guards, ten emulator security cases, lint/build. No authenticated cloud journey or model call ran.

Initial redesign released on October 17, 2026 (Costa Rica). Machine verification timestamps below use UTC.

## Saved weight and convention recovery — October 22, 2026

Published to both Hosting environments; final verification completed at `2026-10-22T21:49:19.075Z` (UTC). Review-blocked weights remain visible as references, unrelated edits retain raw per-set values, explicit active convention choices carry into future defaults, and draft discard restores prior values. New unspecified configurations default to machine display.

Complete `npm run check` passed **265 local Playwright cases**, 189 backend passes (six opt-in skips), 24 environment/process guards, ten emulator security cases, lint/build. Each host matches HTML, marker, all 77 script/style assets and caching policies. All 36 production / 32 QA function metadata records and paused QA controls are unchanged. A metadata 429 after deployment was resolved by read-only verification, without redeployment. No backend deployment, authenticated cloud regression or model call ran.

## Workout weights, notices and permanent AI alternatives — October 22, 2026

Published to production and QA at `2026-10-22T21:24:34.535Z` (UTC), Hosting only. New workouts can reuse earlier compatible exercise loads across days/routines; active and completed sets retain their saved values. Removed-set notices have an explicit close control and expire while retaining Undo. AI alternatives offer this-workout-only (default) or permanent replacement on the selected routine day. Permanent choices retain stable identities, completed original sets, separate historical movement progress and the full future set count, even when the current draft is discarded.

Complete local `npm run check` passed: **256 Playwright cases**, 189 backend passes (six opt-in skips), 24 environment/process guards, ten emulator security cases, lint/build. Both hosts matched HTML, environment markers, all **77** JS/CSS assets and cache policies. Backend source and all function metadata remained unchanged (36 production / 32 QA); paused QA AI controls remained unchanged. No backend deployment, application-data migration, authenticated cloud regression or model call ran.

## Concise progress after report uploads — October 21, 2026

Saving a report now immediately shows **Your progress update**, outside the selected Summary/History view. It reuses the existing revision-safe background analysis and performs one summary read when that job is ready; it does not start another analysis/model call. The card displays a summary capped at 45 words, one next step capped at 30 words, and at most two numerical comparisons with values, dates, units, source/method and daily-median context. Percentage changes use percentage points. Only the uploaded report's date, source/method and metric units qualify; absent, incompatible or undated comparisons are a baseline, never an invented trend. Saved measurements remain available if coaching or its final read fails. The full analysis remains accessible.

The existing worker prompt now asks for concise goal-aware coaching grounded in supplied comparisons and workouts. It distinguishes BIA estimates from proof of tissue change and weight change from evidence of fat loss, muscle gain or improved fitness. Insufficient evidence leads to a measurement/training-recording next step rather than an invented calorie, load or routine adjustment. Model selection remains Terra; historical observations, original files, workouts and previous narratives were not migrated or rewritten.

The final complete `npm run check` passed after the final implementation/test change: **235 local Playwright cases (7.3 minutes)**, **189 backend passes** (195 discovered, six opt-in skips), 24 environment/process guards, ten emulator security cases, lint and build. Eight new synthetic upload journeys cover automatic display, one next step, dated numeric evidence, baseline/incompatible/undated readings, stale revisions, failed coaching, paused QA AI and retrying a failed statement read without a second extraction/save. EN desktop/mobile and ES mobile screenshots were inspected. Original reports and actual user records were not test fixtures. No live model inference or authenticated cloud regression ran.

Publication completed at `2026-10-22T01:10:44.092Z` (UTC). Scope: existing `measurement_job_written` and Hosting in QA and production. Each host matched all **76** JS/CSS assets, HTML, environment marker and cache policy. Both workers are ACTIVE with unchanged event triggers, runtime settings, plain model/identity parameters and secret references; all non-target function metadata stayed unchanged (32 QA / 36 production). QA retains its paused automatic AI, unchanged manual-chat controls, minimum zero/maximum one/concurrency one, and no cleanup schedule or analytics TTL. Worker readiness used metadata; no cloud event or user record was sent to invoke it. Production worker: `measurement-job-written-00003-nit`; QA worker: `measurement-job-written-00004-tiy`.

## Smart-scale reports: save first, edit afterward — October 21, 2026

Published at `2026-10-22T00:18:40.699Z` (UTC). Uploading a report now uses one **Save report** action: upload, read and save the measurements/original, then open History for optional editing. Manual entry and pasted-text review remain explicit. Saved details show the main measurements with all remaining results under **More readings**. Original files, source/device, BIA method, date, raw values/units and evidence are preserved. No user records were migrated or rewritten.

The blocker was a blanket rejection of percentages above 100. Segmental fat/muscle balance and weight-to-target percentages are ratios relative to a standard and may exceed 100. Only known body-composition shares are bounded to 0–100. Extraction guidance distinguishes reference ratios, recognizes Fitdays/Intelligent Weigh BIA reports, retains device context and excludes illustrative exercise-calorie tables. Exact duplicate results repeated in charts/tables collapse; conflicting values are not silently selected.

A failed save retains extracted results and the original for retry with the same request ID, without another upload/model request. Closing after a possibly committed save cannot delete its original. Missing dates stay unknown. The final complete `npm run check` passed: **227 local Playwright cases (7.1 minutes)**, **188 backend passes** (194 discovered, six opt-in skips), 24 environment/process guards, ten emulator security cases, lint/build. Tests cover reference ratios, body-share bounds, duplicates, save/retry before and after commit, original retention, later editing and unchanged prior records/workouts. Mobile upload/saved-detail screenshots were inspected. Owner report contents were not fixtures; no live model call or authenticated cloud regression ran.

Scope: existing `parse_measurement_import`, `save_measurement_entries`, `update_measurement_entry`, and Hosting in both environments. Each host matched all 76 JS/CSS assets, HTML, environment markers and cache policies; all six anonymous probes returned 401. Inventories remain 32 QA / 36 production, with unchanged non-target functions and QA controls. Terra remains selected; the mutation endpoints' unused model parameters were aligned to it. Other parameters/secrets/runtime settings were preserved except Google materializing the two production mutation endpoints' previously unset instance caps as 60. QA retains zero minimum, one maximum and concurrency one, paused automatic AI and unchanged manual controls, without recurring cleanup/TTL.

The first publication stopped because the anonymous edit probe omitted an entry ID and received input validation. The corrected operator uses an inert ID, reuses the already verified QA backend, pins its operator hash and retains the exact passing application/test manifest. No product/test changes occurred during this operational correction.

## Terra for coaching and analysis — October 21, 2026

Both `OPENAI_GENERAL_MODEL` and `OPENAI_ANALYSIS_MODEL` are now explicitly `gpt-5.6-terra` on all ten active OpenAI-calling functions in each environment. The rollout completed at `2026-10-21T16:53:08.935Z`. This covers chat/classification, routine/session recommendations, weekly reports, meal/exercise/body-report extraction, measurement imports and the progress-analysis worker. Independent local defaults and QA/production manifests also select Terra for future deployments. [Official Terra capabilities](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

The complete local `npm run check` passed after the final implementation/test change: **223 Playwright cases (4.9 minutes)**, 186 backend passes (192 discovered, six opt-in integrations skipped), **24** environment/process guards, ten emulator security cases, lint and build. The initial sandbox run could not bind the emulator hub; the complete rerun with local-port access passed. Live Terra account access, output quality and latency were not evaluated: the rollout made zero live model calls and ran no authenticated cloud journeys.

The Cloud Functions configuration API rebuilt each existing function from its existing source archive. The first QA guard stopped on the unexpected build/generation change. The resumed publisher verified original/copied archive size, CRC32C and MD5 for every function, all other runtime parameters, identities, secret references and triggers, plus anonymous 401 rejection on all nine callables per environment. It pinned its own operator hash while retaining the exact passing application/test manifest. Source archives were unchanged; no local source was uploaded, Hosting was not redeployed, and no application records or historical summaries were rewritten. Inventories remain 32 QA / 36 production, and non-target functions are unchanged.

Google materialized the production `measurement_job_written` worker's previously unset maximum instance count as **60**. This sole platform normalization was explicitly recorded; other runtime settings were preserved. QA retains minimum zero, maximum one, concurrency one, paused automatic AI, unchanged manual-chat controls, and no cleanup schedule or analytics TTL.

## Fitdays import recovery and loading — October 21, 2026

The October 20 production import returned HTTP 200 after **152.13 seconds**; the browser used Firebase's default **70-second** callable timeout. This mismatch could report failure while the server completed extraction. The import client now waits up to 330 seconds, covering the callable's existing 300-second window without extending other callables or changing models. Reading may still take a few minutes.

Uploads show actual transfer percentages, followed by an indeterminate reading stage with elapsed time and a longer-wait message. The progress panel remains visible above the picture on mobile, and upload/review uses the full phone screen. Errors distinguish upload, extraction, timeout and session/access failures while retaining the selected picture for retry. A failed upload download-URL lookup now rejects instead of leaving the spinner pending indefinitely. Reading never saves measurements automatically.

A same-content retry reuses extracted results. In a transaction, only an unsaved review draft can attach the newly validated owned upload path; saved imports, readings, source units and workouts remain unchanged. This repairs the original-file link when an earlier timed-out client removed its staged upload.

The final complete `npm run check` passed after the final implementation/test change: **223 local Playwright cases (5.0 minutes)**, **186 backend passes** (192 discovered; six opt-in integrations skipped), 22 environment/process guards, ten emulator security cases, frontend lint and build. Tests cover a real Firebase client with a simulated 152-second response, upload-link rejection, EN/ES progress visibility, retry without a second upload, retained previews, original-link repair and unchanged saved records. No new live model inference or authenticated cloud regression was run.

Publication completed at `2026-10-21T16:22:31.164Z`. The existing `parse_measurement_import` function and Hosting were updated in QA and production. Final readiness verified all **76** JavaScript/CSS assets per host, HTML, environment markers and cache policies; both final anonymous import checks returned 401 before data/model access. Function inventories remain 32 QA / 36 production. QA controls and non-target functions stayed unchanged. No user-data migration ran.

The production rollout guard caught Google materializing a previously unset `maxInstanceCount` as **60**. Two configuration-only clears completed but retained that platform default, as documented in earlier releases. The resumed release explicitly accepts and records only this production normalization; every other application-owned runtime setting, identity, model parameter and secret reference was verified unchanged. QA retains minimum zero, maximum one and concurrency one. The initial guard stop and recovery-verifier scope error remain in the private evidence; the corrected verifier passed a static undefined-variable check before completing publication. Validated application/test inputs stayed unchanged throughout recovery.

| Environment | Verified at (UTC) | Import revision | Entry bundle | SHA-256 |
| --- | --- | --- | --- | --- |
| qa | `2026-10-21T16:21:53.248Z` | `parse-measurement-import-00005-led` | `/assets/index-DeJwGucQ.js` | `cf2c9be2f9e7315185daf79aab9831c60cc1ff7e39edcf928add18999713b4e1` |
| production | `2026-10-21T16:22:15.548Z` | `parse-measurement-import-00004-cuj` | `/assets/index-DjERx_Bv.js` | `6ba102c7a8ee32e742d37e6144b8156d1efa08179f67227d3b4ff3e1d6ebc7fe` |

## Editable load choices — October 19, 2026

Visible, mutually exclusive controls now let the user choose total weight, weight per dumbbell, machine display or weight per side in active workouts, historical workout edits and routine configuration. Legacy sessions start without a selected criterion; the user can also clear a saved choice. A session choice describes its recorded numbers without multiplying or dividing them. Historical corrections update only that workout and its linked daily-log mirror; current prescriptions, other sessions and manual log entries are preserved. Editing only the criterion also preserves original weight units, target-set counts, completed sets, loads, repetitions and dates.

Progress reads the convention from each historical snapshot and marks mixed, unconfirmed or review-required loads. AI-generated routines now retain the server-returned convention when saved; substitution previews show it before acceptance. The already deployed backend reads fresh, bounded current/history load facts, and the offline context regression confirms a corrected historical total remains distinct from a current per-dumbbell prescription without converting its load. No real model recommendation was tested or claimed.

The final complete `npm run check` passed after the last source/test change: **219 local Playwright cases (4.9 minutes)**, **185 backend passes** (191 discovered; six opt-in integrations skipped), 22 environment/process guards, ten emulator security cases, frontend lint and build. Synthetic EN/ES mobile/desktop regressions cover no default selection, save/cancel/clear/reload, active autosave, conflicting kg/lb preferences, daily-log preservation, historical progress, routine edits and generated-routine metadata.

Hosting-only publication completed at `2026-10-19T18:09:17.336Z` in QA and production. All **76** JavaScript/CSS assets per environment, HTML, environment markers and cache policies matched their validated candidates. Backend runtime source and full function metadata remained unchanged (32 QA / 36 production functions); paused QA AI controls remained unchanged. No user-data migration, application sign-in, callable invocation, cloud regression or model call ran.

| Environment | Verified at (UTC) | Entry bundle | SHA-256 |
| --- | --- | --- | --- |
| qa | `2026-10-19T18:08:39.322Z` | `/assets/index-BGYvtWX1.js` | `bae79c8a9b71e22031652d1be665173f02a49b03da664f5fd74bd66cefeb8711` |
| production | `2026-10-19T18:09:01.526Z` | `/assets/index-CCw1vxUI.js` | `0eaa9e24d58217b9540647a8f0bf2c748900acfc74afc1688bce75f6cb752451` |

## Load conventions and AI context — October 19, 2026

Explicit `load_basis` metadata now distinguishes one dumbbell, combined total, machine display and one side. The UI explains the criterion in EN/ES routine configuration, routine cards, active workouts, editors, historical summaries and progress. Legacy snapshots without metadata remain unconfirmed; their numbers are not reinterpreted. Review-required defaults do not automatically refill weights under a new criterion. Existing kg/lb preferences and canonical kilogram storage remain unchanged.

Chat reads bounded current-routine and recent-session load facts from Firestore, independently of measurement caches. Planning, routine generation, substitutions and weekly-report prompts receive the same recording rules. The planner rejects a generated change of basis; newly generated dumbbell loads without a matching explicit basis start at zero rather than relabeling an ambiguous number. Entered-weight volume is not represented as a verified physical load across limbs. No live model inference was run or claimed.

The final complete `npm run check` passed: **212 local Playwright cases**, **185 backend passes** (191 discovered; six opt-in integrations skipped), 22 environment/process guards, ten emulator security cases, frontend lint and build. Focused EN/ES mobile/desktop checks cover per-dumbbell entry, ambiguous defaults and unchanged historical snapshots. Two separate synthetic operator checks passed.

Publication completed at `2026-10-19T17:40:16.037Z`. Only Hosting and the existing `chat`, `generate_routine`, `plan_workout_session` and `generate_weekly_report` callables were deployed in each environment. All eight anonymous callable checks returned `401 UNAUTHENTICATED` before model/data access. All **76** script/style assets per host, HTML, environment markers and cache policies matched the validated candidates. Inventories remain 36 production/32 QA. Runtime identities, application-owned parameters, secret references, scaling/concurrency and non-target function metadata were preserved exactly; QA controls, absent cleanup scheduler and disabled analytics TTL remained unchanged. No authenticated cloud journey, cloud regression or model call ran.

| Environment | Verified at (UTC) | Entry bundle | SHA-256 |
| --- | --- | --- | --- |
| qa | `2026-10-19T17:36:58.357Z` | `/assets/index-DWCUxRMY.js` | `976bef93a3f59189fb805c1b640b0ec274159e58d50425388f904b6a9390e034` |
| production | `2026-10-19T17:40:13.319Z` | `/assets/index-vxjpqfB9.js` | `d6e3cf53f1037421b446cb78d416be9245d3e0138b22941e6e924334c2b92855` |

## Circumference references and readable workout actions — October 18, 2026

Published to production and QA: manual measurements now include relaxed arm, tensed arm, waist, thighs and calf without adding each field separately. Small factual references show the earlier value, saved unit, date, source and method. Exact source/method matches take priority; same-day repeats use a labelled daily median. The selected measurement date and edited-reading exclusion determine which earlier records qualify. Missing readings stay unknown, and new values stay blank until entered. Generic arm readings and skinfolds do not substitute for distinct circumferences; opening references writes no measurement history or AI jobs.

The dashboard's Change day / Cambiar día action now has an explicit white label on a transparent background, readable hover styling and a visible keyboard-focus outline. The local cases cover pending and completed workout cards in English and Spanish at 360 and 1280 pixels, including at least 4.5:1 contrast over both gradient endpoints and unchanged history after opening/cancelling the chooser.

The final complete `npm run check` passed: **207 local Playwright cases (7.3 minutes)**, **179 passing backend cases** (185 discovered; six opt-in integration cases skipped), 22 environment/process guards, ten emulator security cases, frontend lint and build. Eight additional offline release-metadata checks passed. The validated application/test manifest stayed unchanged through publication, which completed at `2026-10-19T00:11:13.185Z` (October 18 in Costa Rica).

| Environment | Verified at (UTC) | Callable revision | Entry bundle | SHA-256 |
| --- | --- | --- | --- | --- |
| Production | `2026-10-19T00:11:13.126Z` | `get-measurement-workspace-00004-xoj` | `/assets/index-BWLp4mAW.js` | `d272e5b11f9d86cabff0c0ce3675f50d2c108e08568203c87bfe27d172c02726` |
| QA | `2026-10-19T00:00:21.698Z` | `get-measurement-workspace-00007-nir` | `/assets/index-Cl1A06oD.js` | `40ada985c61697e7f461768a3888bff835463db0df1d5cd84d7fabd982e74665` |

The release deployed only Hosting and the existing `get_measurement_workspace` callable in both environments. Both functions read back `ACTIVE` on their dedicated runtime identities; production's final update time is `2026-10-19T00:07:58.299858779Z`, and QA's is `2026-10-18T23:59:52.182731675Z`. HTML, environment markers and all **76** script/style assets per environment matched their candidates and expected cache policies. Anonymous reference requests returned `401 UNAUTHENTICATED` in both environments. Function inventories remain 36 in production and 32 in QA; non-target function metadata, application-owned parameters/secrets and QA's paused controls were preserved. There was no application-data migration, authenticated cloud journey, cloud regression or model call.

Production Hosting publication paused when Google populated a previously absent `maxInstanceCount` with **60** on the updated callable. Both configuration-only clear attempts, first omitting the field and then explicitly setting zero, completed but Google retained 60. The reviewed decision retained this platform-applied cap without raising quotas or editing the managed Run service. The receipt therefore records `runtimeSettingsUnchanged: false` and `runtimeSettingsUnchangedExceptMaxInstanceDefault: true`, with prior unset/current 60; every other application-owned/non-generated runtime setting was preserved. The generated `FUNCTION_SIGNATURE_TYPE` field also normalized from `http` to absent, retaining its HTTP default. QA's minimum-zero/maximum-one/concurrency-one settings stayed unchanged.

Those configuration attempts produced new build/archive generations without changing deployed source. The before/after source archives matched at 120,774 bytes with identical MD5 and CRC32C checksums. The retired original generation returned 404 and was compared through its captured verified baseline; the final generation was verified live with status 200. Private receipts, the scaling decision and source comparison remain under ignored `.qa/measurement-references-release/2026-10-18T23-57-15-548Z/`.

## Shared exercise autocomplete and previews — October 18, 2026

Published to production and QA: library autocomplete, visual suggestions and animated previews throughout routine selection/configuration, active or historical workout editing, and daily exercise logs. Custom names remain available when the library is unavailable. Explicit selection preserves entered sets, stable routine identities and units; library identity/media survive save/reopen, starts, promotion, substitution and daily mirrors. Custom GIF failures recover when the source changes.

The same release fixes fast day/view navigation: dialogs retain their intended day/exercise identity and query updates use the current URL. Deterministic regressions cover changing day then immediately editing it, and leaving progress then immediately changing day, with historical snapshots preserved.

Complete final `npm run check` passed: **197 local Playwright cases (4.6 minutes)**, 173 backend cases (six opt-in integration cases skipped), 22 environment/process guards, ten emulator security cases, lint and build. Publication completed at `2026-10-18T17:20:49.192Z` and verified all **76** script/style assets per environment against the validated candidate.

| Environment | Verified at (UTC) | Entry bundle | SHA-256 |
| --- | --- | --- | --- |
| Production | `2026-10-18T17:20:31.321Z` | `/assets/index-DaKcB37v.js` | `ad8a7fcb739dbba014f868571f98efcb5504a489bb3199551ce7d8965b89d0cb` |
| QA | `2026-10-18T17:20:08.981Z` | `/assets/index-BLAf5TS0.js` | `79727060f11a7f642f31580a337b077a5c7c99225e572b04bc5d93f878a62ce7` |

Hosting only; no data migration or backend deployment. The validated source remained unchanged, HTML/markers matched with `no-cache`, and every asset matched its hash and immutable cache policy. All 36 production functions and 32 QA functions retained their metadata; paused QA controls remained unchanged. No authenticated cloud journey, callable or model request ran.

## Active-workout additions and Finish recovery — October 18, 2026

Published to production and QA: add an exercise during an active workout for this session only or permanently in its exact routine/day, and save temporary additions in the routine later while keeping all entered/completed sets. Stable addition IDs and a retained applied-request map prevent duplicate retries or restoration of a deliberately substituted entry. AI substitutions preserve completed original sets, replace only pending work and leave the routine unchanged.

The Finish screen now recovers once from a confirmed stale history-module failure after completion has been saved. Persistent failures show a translated reload action. Existing older tabs need one manual refresh to receive the handler. A read-only production diagnosis confirmed the reported session and generated logs were already saved; no replay or data repair was performed.

The final complete `npm run check` passed: **191 local Playwright cases**, 173 backend cases (six opt-in integration cases skipped), 22 environment/process guards, ten emulator security cases, lint and build. Publication completed at `2026-10-18T16:45:15.421Z` and verified all **77** script/style assets per environment against the validated candidate. HTML and environment markers matched with `no-cache`; assets matched their hashes with immutable caching.

| Environment | Verified at (UTC) | Entry bundle | SHA-256 |
| --- | --- | --- | --- |
| Production | `2026-10-18T16:44:59.402Z` | `/assets/index-_fahoQyZ.js` | `0ba6f3a79de72beacae57630be0280f377dc89be4601d27de2cf4f4064cd5ad9` |
| QA | `2026-10-18T16:44:36.312Z` | `/assets/index-BlwMnSKa.js` | `31edd6a5f1e518e51e78d9fc8567d502f55c0cf4617dca2d4c91a22edb1a4903` |

This was Hosting only: no data migration or backend deployment. The source manifest stayed unchanged throughout publication, all 36 production functions and 32 QA functions retained their metadata, and paused QA controls remained unchanged. No authenticated cloud journey, callable or model request ran. Private evidence is retained under ignored `.qa/routine-history-release/2026-10-18T16-43-38-450Z/`.

## Routine continuity update — October 18, 2026

The same validated candidate was republished on the owner's repeated request. Production Hosting and all 78 assets were verified again at `2026-10-18T15:26:08.292Z`, and QA at `2026-10-18T15:25:49.349Z`. Source hashes, backend metadata and paused QA controls remained unchanged; no cloud regression or model call ran.

Published to production and QA: exercise progress uses stable identities and retained names, retired exercises remain selectable in progress, earlier sessions can be paginated, and active drafts stay resumable after template edits. Single-workout conversion retains ownership of original sessions independently of later day/exercise changes. Immediate day selection followed by Start uses the day selected when clicked, including exact active-session resumption.

Complete final local validation passed: **180 Playwright cases**, 173 backend cases (six opt-in integration cases skipped), 22 environment/process guards, ten emulator security cases, lint and build. Eight additional offline release-metadata checks passed. Complete local Playwright is mandatory after final code/test changes and before publication; deployed-QA regression remains on explicit demand.

This release deployed **Hosting only**, with no application-data migration. All 36 production functions and 32 QA functions retained their metadata, revisions and update times. QA controls stayed paused and unchanged. Public HTML, environment markers and all 78 JavaScript/CSS assets per environment matched their candidate builds, including cache headers. No authenticated cloud journey, callable or model request was run.

| Environment | Verified at (UTC) | Entry bundle | SHA-256 |
| --- | --- | --- | --- |
| Production | `2026-10-18T15:19:27.228Z` | `/assets/index-CRSxVvv_.js` | `21120e95474f8ff30a4eef96b3971fc3b55bc7a44cc9f73b9b4049f9eb80429c` |
| QA | `2026-10-18T15:19:03.622Z` | `/assets/index-D1we5ad9.js` | `b6b5b208937e70dde4bdc42adf317cbbb5dbdb572ee3d57243efb07528fba2c5` |

Private evidence is retained under ignored `.qa/routine-history-release/2026-10-18T15-18-07-416Z/`. Publication checked the same SHA-256 source/test/build-input manifest captured by the successful complete local run. A pre-deployment stop exposed non-significant ordering differences in Google's event-filter metadata; normalization now ignores ordering only for event filters and secret-reference sets while retaining all actual values and revisions.

## Workout update — October 18, 2026

Published to production and QA: preferred routines, today's scheduled/pending workout, direct workout start, dated day exchanges, optional rest timers, reviewed AI exercise substitutions that preserve completed sets, and repetition fields that clear zero when focused and stay empty while editing.

This update deployed Hosting and the existing `plan_workout_session` callable. The complete function inventories stayed at 36 in production and 32 in QA; every other function retained its previous update time. Each updated callable is `ACTIVE` on its environment's existing runtime identity, and its deployed parameters were preserved. QA retained zero minimum instances, a one-instance/concurrency-one cap, and a closed automatic-AI lease.

| Environment | Verified at (UTC) | Callable revision | Entry bundle |
| --- | --- | --- | --- |
| Production | `2026-10-18T14:42:53.895Z` | `plan-workout-session-00012-buv` | `/assets/index-Cf5IYuDD.js` |
| QA | `2026-10-18T14:40:34.987Z` | `plan-workout-session-00004-bix` | `/assets/index-Cyo4KQ9S.js` |

The environment markers, exact HTML and all 78 generated JavaScript/CSS assets matched their respective builds. HTML revalidation and immutable asset caching were verified. An anonymous substitution request returned `401 UNAUTHENTICATED` in each environment; publication verification made zero model calls. Live model output and authenticated cloud regression were outside this deployment verification.

Local validation included 30 focused workout browser cases, a two-case repeat after the repetition-field correction, 173 passing backend tests with six opt-in cases skipped, 22 environment/process guards, focused lint and both environment builds. Private source hashes, before/after function metadata and deployment receipts are retained under ignored `.qa/workout-experience-release/2026-10-18T14-36-31-655Z/`.

## Destinations and release convention

An ordinary deploy request covers **both QA and production** unless explicitly narrowed. Real measurements, original reports, personal coaching memory and actual training data belong in production. QA is reserved for synthetic regression data and explicitly requested testing.

| Environment | Application | Use |
| --- | --- | --- |
| Production | `https://ai-training-coach-6880b.web.app` | Real users and personal data |
| QA | `https://training-coach-qa-20261017.web.app` | Isolated, manual regression |

Publication does not implicitly copy data between projects or authorize cloud regression, email, invitations or paid model testing.

## Published application and backend

The complete redesign is published to production: training-first navigation, owner People/Invitations/Analytics, preserved workout editing/history/units, flexible measurements, safe Markdown, durable coach memory, New chat, and selective Progress loading. Production uses its own attached runtime identity and OpenAI federation configuration; QA parameters and test sign-in are excluded from the production build.

Production has **33 current active exports**, including eight Firestore handlers and its daily metadata-only usage cleanup. Three pre-existing functions were preserved unchanged, including the billing-alert handler, for 36 total. The current exports all use `training-coach-ai@ai-training-coach-6880b.iam.gserviceaccount.com` and the verified production parameters. Firestore remains in its existing `nam5` location; Functions remain in `us-central1`. No database relocation occurred.

Existing approved users retain access. The release preserved Auth providers and SMTP secret versions.

The dedicated runtime received only Firestore application access, Eventarc receiver access, read access to the production upload bucket, and accessor rights on the two existing SMTP secrets. Each of the eight event handlers has a verified caller-specific invoker grant on its own destination service. The Storage service agent has the precise cross-service Rules role required for Firestore approval checks. Private before/after IAM snapshots retained conditions and ETags.

Production retains automatic measurement/weekly AI behavior and the daily usage-retention schedule; QA stays on its separate idle/cost controls. The Scheduler target, POST method, exact OIDC audience, identity, 24-hour interval and Costa Rica timezone passed metadata verification. The job was not run as a test.

## Verification

- Backend: 168 discovered, 162 passed and six opt-in integration cases skipped.
- Environment/process/runtime guards: 22 passed.
- Real local Firebase emulator security checks: 10 passed.
- Local Playwright: 158 passed in the final complete run, including the new evening/date regression.
- Full lint and frontend builds passed. An initial demo check exposed UTC seeding advancing evening readings to tomorrow; seeding now uses local calendar dates. The corrected full browser suite passed.

Production Hosting integrity passed at `2026-10-18T02:12:14.260Z`: `/assets/index-w_XGoae9.js`, SHA-256 `86582f8d55b78b03c7d246224355170c2a4b13b02e2ba28f24f4ddb4940b9457`. The exact production marker, HTML and bundle matched; HTML revalidates and hashed assets are immutable. QA Hosting also matched its separate QA build at `2026-10-18T02:09:14.981Z`: `/assets/index-DYSss3Ra.js`, SHA-256 `3b2f3e3299d8820f91368434dfe9518c52f1533992eed654e766c1a36e9c7976`.
