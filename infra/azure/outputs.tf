output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "static_web_app_hostname" {
  value = azurerm_static_web_app.web.default_host_name
}

output "function_app_name" {
  value = azurerm_linux_function_app.api.name
}

output "function_app_hostname" {
  value = azurerm_linux_function_app.api.default_hostname
}

output "key_vault_name" {
  description = "Set the secrets listed in var.function_secret_names here, out-of-band."
  value       = azurerm_key_vault.main.name
}

output "cosmos_endpoint" {
  value = azurerm_cosmosdb_account.main.endpoint
}

output "uploads_blob_endpoint" {
  value = azurerm_storage_account.uploads.primary_blob_endpoint
}

output "runtime_identity_client_id" {
  value = azurerm_user_assigned_identity.runtime.client_id
}
