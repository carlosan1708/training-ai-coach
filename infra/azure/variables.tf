variable "subscription_id" {
  description = "Target Azure subscription ID (required by azurerm 4.x)."
  type        = string
}

variable "environment" {
  description = "Environment name. Production and QA must use separate states and subscriptions/resource groups."
  type        = string

  validation {
    condition     = contains(["qa", "production"], var.environment)
    error_message = "environment must be \"qa\" or \"production\"."
  }
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "centralus"
}

variable "static_web_app_location" {
  description = "Azure Static Web Apps is only available in a few regions (e.g. centralus, eastus2, westus2, westeurope, eastasia)."
  type        = string
  default     = "centralus"
}

variable "name_prefix" {
  description = "Short lowercase prefix (3-12 chars, letters/digits) used in resource names."
  type        = string
  default     = "tcoach"

  validation {
    condition     = can(regex("^[a-z0-9]{3,12}$", var.name_prefix))
    error_message = "name_prefix must be 3-12 lowercase letters or digits."
  }
}

variable "static_web_app_sku" {
  description = "Free or Standard."
  type        = string
  default     = "Free"

  validation {
    condition     = contains(["Free", "Standard"], var.static_web_app_sku)
    error_message = "static_web_app_sku must be Free or Standard."
  }
}

variable "cosmos_containers" {
  description = <<-EOT
    Cosmos DB (NoSQL, serverless) containers standing in for Firestore collections.
    Map key = container name, value = partition key path. Firestore subcollections
    under users/{uid}/... are assumed to become documents in "user_data" partitioned
    by /uid with a "kind" discriminator. This is a data-model assumption that the
    application port must honour; Terraform does not migrate data.
  EOT
  type        = map(string)
  default = {
    user_data   = "/uid"
    user_status = "/uid"
    invitations = "/id"
    usage       = "/uid"
    qa_mail     = "/id"
  }
}

variable "cosmos_enable_free_tier" {
  description = "Cosmos free tier (one per subscription)."
  type        = bool
  default     = false
}

variable "smtp_host" {
  type    = string
  default = "smtp.gmail.com"
}

variable "smtp_port" {
  type    = string
  default = "587"
}

variable "admin_email" {
  description = "Recipient of signup notifications. Non-secret, but still personal data: supply via git-ignored tfvars."
  type        = string
  default     = ""
}

variable "openai_general_model" {
  type    = string
  default = "gpt-5.6-terra"
}

variable "openai_analysis_model" {
  type    = string
  default = "gpt-5.6-terra"
}

variable "function_secret_names" {
  description = "Key Vault secret names referenced by the Function App. Values are set out-of-band, never by Terraform."
  type        = list(string)
  default     = ["SMTP-USER", "SMTP-PASSWORD", "OPENAI-API-KEY"]
}

variable "tags" {
  type    = map(string)
  default = {}
}
