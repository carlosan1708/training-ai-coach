terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Partial configuration: no subscription, account or key is committed.
  # Supply values at init time, e.g.
  #   terraform init -backend-config=backend.local.hcl
  # (backend.local.hcl is git-ignored; see README.md).
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}
