data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  base       = "${var.name_prefix}-${var.environment}"
  compact    = "${var.name_prefix}${var.environment == "production" ? "prod" : "qa"}${random_string.suffix.result}"
  tags       = merge({ app = "training-ai-coach", environment = var.environment, managed_by = "terraform" }, var.tags)
  kv_secrets = toset(var.function_secret_names)
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.base}"
  location = var.location
  tags     = local.tags
}

# ── Identity (replaces the Firebase runtime service account) ─────────────────
resource "azurerm_user_assigned_identity" "runtime" {
  name                = "id-${local.base}-runtime"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = local.tags
}

# ── Observability ────────────────────────────────────────────────────────────
resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.base}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.base}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = local.tags
}

# ── Key Vault (SMTP / model credentials; values set out-of-band) ─────────────
resource "azurerm_key_vault" "main" {
  name                       = substr("kv${local.compact}", 0, 24)
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 30
  tags                       = local.tags
}

resource "azurerm_role_assignment" "runtime_kv_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.runtime.principal_id
}

# ── Cosmos DB (replaces Firestore; serverless, Entra-only data plane) ────────
resource "azurerm_cosmosdb_account" "main" {
  name                          = "cosmos-${local.compact}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  offer_type                    = "Standard"
  kind                          = "GlobalDocumentDB"
  free_tier_enabled             = var.cosmos_enable_free_tier
  local_authentication_disabled = true
  minimal_tls_version           = "Tls12"
  tags                          = local.tags

  capabilities {
    name = "EnableServerless"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }

  backup {
    type = "Continuous"
    tier = "Continuous7Days"
  }
}

resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "training_coach"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}

resource "azurerm_cosmosdb_sql_container" "containers" {
  for_each              = var.cosmos_containers
  name                  = each.key
  resource_group_name   = azurerm_resource_group.main.name
  account_name          = azurerm_cosmosdb_account.main.name
  database_name         = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths   = [each.value]
  partition_key_version = 2
}

# Built-in "Cosmos DB Built-in Data Contributor" role.
resource "azurerm_cosmosdb_sql_role_assignment" "runtime" {
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.runtime.principal_id
  scope               = azurerm_cosmosdb_account.main.id
}

# ── Blob storage for user uploads (replaces Firebase Storage) ────────────────
resource "azurerm_storage_account" "uploads" {
  name                            = substr("stup${local.compact}", 0, 24)
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  tags                            = local.tags

  blob_properties {
    delete_retention_policy {
      days = 14
    }
  }
}

resource "azurerm_storage_container" "uploads" {
  name                  = "uploads"
  storage_account_id    = azurerm_storage_account.uploads.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "runtime_uploads" {
  scope                = azurerm_storage_account.uploads.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.runtime.principal_id
}

# ── Function App (replaces Cloud Functions, Python 3.12) ─────────────────────
# Runtime storage uses an access key (kept in Terraform state: use a protected
# remote backend). Moving to identity-based AzureWebJobsStorage is a follow-up.
resource "azurerm_storage_account" "func" {
  name                            = substr("stfn${local.compact}", 0, 24)
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  tags                            = local.tags
}

resource "azurerm_service_plan" "func" {
  name                = "asp-${local.base}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"
  tags                = local.tags
}

resource "azurerm_static_web_app" "web" {
  name                = "swa-${local.base}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.static_web_app_location
  sku_tier            = var.static_web_app_sku
  sku_size            = var.static_web_app_sku
  tags                = local.tags
}

resource "azurerm_linux_function_app" "api" {
  name                          = "func-${local.base}-${random_string.suffix.result}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  service_plan_id               = azurerm_service_plan.func.id
  storage_account_name          = azurerm_storage_account.func.name
  storage_account_access_key    = azurerm_storage_account.func.primary_access_key
  https_only                    = true
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false
  key_vault_reference_identity_id = azurerm_user_assigned_identity.runtime.id
  tags                          = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.runtime.id]
  }

  site_config {
    minimum_tls_version = "1.2"
    ftps_state          = "Disabled"

    application_stack {
      python_version = "3.12"
    }

    cors {
      allowed_origins = ["https://${azurerm_static_web_app.web.default_host_name}"]
    }
  }

  app_settings = merge(
    {
      APP_ENV                               = var.environment
      AZURE_CLIENT_ID                       = azurerm_user_assigned_identity.runtime.client_id
      COSMOS_ENDPOINT                       = azurerm_cosmosdb_account.main.endpoint
      COSMOS_DATABASE                       = azurerm_cosmosdb_sql_database.main.name
      UPLOADS_ACCOUNT_URL                   = azurerm_storage_account.uploads.primary_blob_endpoint
      UPLOADS_CONTAINER                     = azurerm_storage_container.uploads.name
      SMTP_HOST                             = var.smtp_host
      SMTP_PORT                             = var.smtp_port
      ADMIN_EMAIL                           = var.admin_email
      OPENAI_GENERAL_MODEL                  = var.openai_general_model
      OPENAI_ANALYSIS_MODEL                 = var.openai_analysis_model
      APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.main.connection_string
      SCM_DO_BUILD_DURING_DEPLOYMENT        = "true"
    },
    { for n in local.kv_secrets : replace(n, "-", "_") => "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault.main.vault_uri}secrets/${n}/)" }
  )

  depends_on = [azurerm_role_assignment.runtime_kv_secrets]
}
