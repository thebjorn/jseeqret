# Developer docs
This is the documentation for developers working on the project. It includes information about the architecture, coding standards, and other technical details.


## Table of Contents

- [Server Vaults](server-vault/index.md) — Runtime secret access and admin management
- [Vault-to-Vault Communication](vault-to-vault/index.md) — Sharing secrets between vaults
- [Shared Vault](shared-vault/index.md) — Multi-user access to a single vault
- [Multi-Vault](multi-vault/index.md) — Multiple vaults per user
- [Master Vault](master-vault/index.md) — Centralized vault design and trade-offs
- [Vault Hierarchy](vault-hierarchy/index.md) — Web of trust and granular access control
- [Auto-Rotation](auto-rotation/index.md) — Secret expiration and rotation
- [Linked Vault](linked-vault/index.md) — Keeping multiple personal vaults in sync
- [Sync-Merge](sync-merge/index.md) — Conflict resolution algorithm for vault synchronization


## Feature Plans

- [Vault Architecture Roadmap](feature-plans/vault-architecture-roadmap/README.md) — Comparative analysis of three plans (Incremental, Vault Service, Federated) with recommended phased roadmap


## Open Issues
- ~~how can a user request a secret from another user?~~ → Addressed in [Vault-to-Vault](vault-to-vault/index.md) Phase 4 (secret request protocol)