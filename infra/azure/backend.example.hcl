# Copy to backend.local.hcl (git-ignored). Placeholders only.
resource_group_name  = "REPLACE_STATE_RESOURCE_GROUP"
storage_account_name = "REPLACE_STATE_STORAGE_ACCOUNT"
container_name       = "tfstate"
key                  = "training-ai-coach/qa.tfstate" # one key per environment
use_azuread_auth     = true
