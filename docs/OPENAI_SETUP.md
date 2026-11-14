# Keyless OpenAI setup

The Python backend uses the official OpenAI SDK's Google ID-token provider and Responses API. Google issues short-lived tokens to the attached runtime service account; OpenAI exchanges them through the configured workload identity provider. No OpenAI API key or downloaded Google private key is required. [Official Google Cloud federation guide](https://developers.openai.com/api/docs/guides/workload-identity-federation/google-cloud).

## Environment identities

Use a dedicated Google runtime service account and a separate OpenAI project and service account for each environment. Configure OIDC discovery with issuer `https://accounts.google.com` and audience `https://api.openai.com/v1`. Map the numeric Google service-account subject to its corresponding OpenAI service account and grant Responses access. Populate the local manifest from the examples in `environments/`.

## Parameters and behavior

`AI_RUNTIME_SERVICE_ACCOUNT` selects the attached Google identity. `OPENAI_IDENTITY_PROVIDER_ID`, `OPENAI_SERVICE_ACCOUNT_ID` and `OPENAI_AUDIENCE` configure token exchange. Both general coaching and extraction/progress analysis default to `gpt-5.6-terra`, configurable independently through `OPENAI_GENERAL_MODEL` and `OPENAI_ANALYSIS_MODEL`. [Terra supports Responses, image inputs and Structured Outputs](https://developers.openai.com/api/docs/models/gpt-5.6-terra). This model configuration does not establish live account access, extraction quality or a latency improvement.

Requests use `store:false`, bounded output and transport retries. PDF/image inputs are sent inline; the app does not create OpenAI file or conversation objects. Saved measurement facts remain available if analysis fails.

QA automatic model requests remain closed by default. An operator can separately enable `runtime_controls/qa_manual_chat` with `enabled: true`, `project_id: "training-coach-qa-20261017"`, `timezone: "America/Costa_Rica"`, `demo_daily_messages: 10` and `real_users_unlimited: true`. Approved real owners and verified accepted real invitees have no application daily chat cap and do not read or write daily quota counters. Accepted invitation verification checks the protected status link, accepted invitation, UID and email; an acquisition label or client profile cannot grant access. Trusted synthetic/test markers and reserved fixture identities take precedence over both owner roles and accepted invitations, so synthetic/demo accounts retain ten messages per Costa Rica day. The local browser demo has the same ten-message daily allowance for simulated replies; it persists across demo resets and resets at Costa Rica midnight.

Each manually submitted chat permits at most two provider attempts, classifier plus answer, including the progress specialist. That server scope covers only chat and cannot grant access to automatic workers or other callables. Other live QA requests require a short-lived, server-only `runtime_controls/qa_ai` lease for approved synthetic accounts and selected tasks. Each provider request consumes its lease budget transactionally; expiry, exhaustion, revocation, missing configuration or a control-store outage blocks the next request before token exchange. The default test window is ten minutes and four requests, bounded to thirty minutes and twenty requests. QA SDK transport retries are disabled; production retains its existing retries and is unaffected by the QA daily demo allowance. Request limits are not fixed dollar budgets.

Use the guarded manual commands in [QA.md](QA.md). Deployment, page navigation and ordinary regression never open a live-AI window. No scheduled job is required to expire it.

## Selective chat memory and factual context

The specialist answer uses Responses Structured Outputs with `text.format.type: "json_schema"` and `strict: true`. Its schema returns `reply` and at most four `memory_updates` proposals together. This keeps the normal chat path at one classifier request plus one answer request; memory extraction adds no separate provider call. See the [official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Replies render as safe Markdown, with HTML skipped, remote-image loading disabled and scrolling tables; user messages remain plain text.

Persistent personal memory is user-scoped, limited to 30 facts of 400 characters each, and grounded in complete first-person clauses from the latest user message. Server validation preserves negation and qualification and rejects assistant-derived claims, unsupported inferences, secrets and instructions. Facts retain source session/message provenance and timestamps. They are supplied to subsequent chat sessions as quoted user data. Transactional revision checks protect corrections and deletion: an in-flight answer cannot recreate a fact forgotten against a newer revision. A read outage leaves unknown memory unchanged; the UI reports persistence status separately from the answer.

The **Coach memory** dialog separates **About you** from **Your progress**, with explicit review, confirmed individual/all forgetting and a draft for telling the coach a new fact. The existing `chat` callable dispatches `memory_get` and `memory_delete` before model quota reservation; explicit unambiguous forget commands also bypass the provider. Approval is required, and clients cannot write memory directly.

Progress context also includes a deterministic facts-only digest of available measurement and completed-workout history, including a recent 90-day view. It calculates daily medians, comparable source/method/unit groups and recorded workout totals without diagnosing causes or treating logged volume as measured strength. Read/detail limits are explicit. Fingerprints and revisions invalidate stale cached history after source changes. The existing workspace read and chat context preparation can build this digest without provider authentication, model output or an analysis job. Personal memory and this digest reuse existing exports (32 in QA, 33 current production exports including its cleanup schedule); they add no trigger or background job and do not open the default closed QA AI lease. Ordinary Firestore/Functions costs still apply. See [QA.md](QA.md#chat-formatting-personal-memory-and-factual-progress) for behavior and manual checks.

## Verification and release checkpoints

Offline tests verify SDK configuration, stateless requests, missing-configuration failures and production mock refusal.

The broader QA live-AI regression in [QA.md](QA.md) remains separately requested and uses synthetic data. It is never part of default tests or deployment. Set the desired OpenAI project budget before authorizing that run.

Before a production release, confirm the existing owner account, bootstrap its server-owned `admins/{uid}` role, grant the production runtime its required resource permissions, fill the production parameters and deploy the verified candidate. Preserve existing SMTP credentials. Retire the old provider secret only after the authorized cutover and rollback checks are complete.
