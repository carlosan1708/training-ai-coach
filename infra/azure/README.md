# Azure Terraform root (`infra/azure`)

Source-only Terraform for an Azure landing zone intended to replace the current
Firebase/Google Cloud stack. **Nothing here has been planned, applied or
deployed, and no CI/CD workflow applies it.** An operator must review and run it
manually.

## Mapping from the current stack

| Current (Firebase/GCP) | Azure resource in this root |
| --- | --- |
| Firebase Hosting (`web/dist`) | Static Web App |
| Cloud Functions (Python 3.12, `functions/`) | Linux Function App (Consumption `Y1`) + runtime storage |
| Runtime service account | User-assigned managed identity |
| Firestore | Cosmos DB for NoSQL (serverless, key auth disabled, Entra RBAC) |
| Firebase Storage | Private Blob container (`uploads`, shared keys disabled) |
| Functions secrets (SMTP) / OpenAI | Key Vault (RBAC) + Key Vault references |
| Cloud logging | Log Analytics + Application Insights |

## Root, inputs, outputs

- Root: `infra/azure` (`versions.tf`, `variables.tf`, `main.tf`, `outputs.tf`).
- Required inputs: `subscription_id`, `environment` (`qa` | `production`). Others have defaults (see `variables.tf`); copy `example.tfvars` to the git-ignored `terraform.tfvars`.
- Backend: partial `azurerm` backend; copy `backend.example.hcl` to `backend.local.hcl`. Use a separate state key (ideally separate subscription) per environment, preserving the repo's production/QA separation.
- Manual review commands (no apply):
  ```
  terraform -chdir=infra/azure init -backend=false
  terraform -chdir=infra/azure fmt -check
  terraform -chdir=infra/azure validate
  ```
  A real `plan` needs an initialised backend and credentials.

## Assumptions and gaps (must be resolved before any cutover)

1. **Application code is not ported.** The backend uses `firebase_functions`, `firebase_admin`/Firestore, Firebase callable semantics, Firestore triggers (`firestore_fn`), scheduled cleanup and Storage. Azure Functions needs a rewrite (HTTP/Cosmos change-feed/timer triggers, Cosmos and Blob SDKs). `firebase.json`, Firestore/Storage rules and `scripts/*.mjs` remain untouched and Firebase remains the live system.
2. **Authentication is not provisioned.** Firebase Auth (providers, invitations, approvals) needs a replacement such as Entra External ID or Static Web Apps auth; it is not manageable through this `azurerm` root. The web client (`web/src/firebase/*`) must be changed.
3. **Authorization rules** in `firestore.rules`/`storage.rules` have no Cosmos/Blob equivalent; per-user isolation must be enforced in the API tier and re-tested.
4. **Data model:** `cosmos_containers` is an assumed mapping of Firestore collections/subcollections. Existing history (workouts, measurements, logs, original reports) must be migrated with a separately reviewed, non-destructive process, consistent with `AGENTS.md` (never wipe/reseed history). Keep Firebase read-only/intact until migration is verified.
5. **OpenAI auth:** the current setup uses workload-identity federation. This root assumes a Key Vault secret `OPENAI-API-KEY`; an Azure-side federation design is undecided. Secret values (SMTP, OpenAI) are never in Terraform; set them in Key Vault out-of-band. Setting them requires the operator to hold a Key Vault Secrets Officer role.
6. Function runtime storage uses an account access key, which lands in Terraform state; protect the state backend. Consumption plan may be insufficient for 300 s AI calls with cold starts; reconsider Flex Consumption/Premium and the `qa_runtime` cost controls.
7. Region defaults (`centralus`) and SKUs are placeholders; confirm quotas, residency, and Cosmos free-tier availability.
8. No custom domain, WAF/Front Door, private networking, budgets or alerts are included.
9. `.terraform.lock.hcl` is not committed yet; generate it with `terraform init` and commit it.

## Checks still required

- `terraform fmt`, `init -backend=false`, `validate` (not run here: no Terraform binary or Azure access was used).
- Provider-version review of argument names (azurerm 4.x) via `terraform plan` against QA first.
- Security/cost review of the plan; confirm no secret in state beyond the noted storage key.
- Port and test the backend/web client; run `npm run check` (unchanged by this PR).
- Data-migration design, rollback plan and cutover decision, all separate from this PR.
