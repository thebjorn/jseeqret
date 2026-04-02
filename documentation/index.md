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


## Security Concerns

Each feature area has a dedicated security review covering threat modeling, risk ratings, and mitigations:

- [Auto-Rotation](auto-rotation/security-concerns.md) — Rotation != revocation, clock skew, audit metadata leakage
- [Linked Vault](linked-vault/security-concerns.md) — Cloud sync exposure, unsigned manifests, stale outbox files
- [Multi-Vault](multi-vault/security-concerns.md) — Registry misdirection, path injection, vault location disclosure
- [Server Vault](server-vault/security-concerns.md) — File watcher injection, privilege separation, reload atomicity
- [Shared Vault](shared-vault/security-concerns.md) — Advisory ACL bypass, identity spoofing, key distribution
- [Sync-Merge](sync-merge/security-concerns.md) — LWW overwrites, tombstone manipulation, replay attacks
- [Vault-to-Vault](vault-to-vault/security-concerns.md) — No forward secrecy, inbox persistence, unsigned exports
- [Vault Hierarchy](vault-hierarchy/security-concerns.md) — Trust revocation gaps, DAG scope bypass, policy cascade
- [Master Vault](master-vault/security-concerns.md) — Reinforces anti-pattern decision (single point of compromise)
- [Vault Architecture Roadmap](feature-plans/vault-architecture-roadmap/security-concerns.md) — Cross-cutting: plaintext keys, memory protection, trust bootstrap


## Open Issues
- ~~how can a user request a secret from another user?~~ → Addressed in [Vault-to-Vault](vault-to-vault/index.md) Phase 4 (secret request protocol)