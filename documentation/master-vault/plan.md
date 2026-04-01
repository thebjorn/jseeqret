# Master Vault -- Analysis

> **Note**: This is not an implementation plan. The master vault is an anti-pattern that jseeqret deliberately avoids. This document exists to analyze the risks and document why the decision was made, so the reasoning is preserved.

## Risk Analysis

### Threat Model

| Threat | Impact with Master Vault | Impact with Distributed Vaults |
|--------|--------------------------|-------------------------------|
| Vault server compromise | All secrets for the entire organization exposed | One team's or one project's secrets exposed |
| Vault key (`seeqret.key`) leaked | All secrets decryptable | One vault's secrets decryptable |
| Network outage to vault server | All applications unable to read secrets | Only applications depending on that specific vault affected |
| Database corruption | All secrets lost (unless backed up) | One vault's secrets lost |
| Admin error (accidental delete) | Potentially affects every secret | Scoped to one vault |
| Key rotation | Must re-encrypt every secret in the organization | Scoped to one vault |

### Availability Calculation

For a master vault with 99.9% uptime (8.7 hours downtime/year):
- An organization with 10 applications that each start once per day has a ~1% chance that at least one application fails to start on any given day due to vault downtime.
- With distributed vaults (each at 99.9%), the same application has a 0.1% chance of its specific vault being down.

The master vault's downtime affects everyone simultaneously, making the perceived reliability much worse than the raw uptime number suggests.

### Scaling Analysis

jseeqret uses sql.js (WASM SQLite) with in-process databases. This architecture is not designed for concurrent access from multiple machines:

| Pattern | Concurrent Reads | Concurrent Writes | Network Access |
|---------|-----------------|-------------------|----------------|
| Local vault | Excellent (in-process) | Single writer (OK for CLI/GUI) | None needed |
| Shared vault | Good (WAL mode) | Single writer with retry | Local filesystem or network share |
| Master vault | Requires a service layer | Requires a service layer | Network to every client |

A master vault would require building the vault service (Plan B from the roadmap) as a prerequisite -- and then running it at high availability. This is significant infrastructure for a tool designed to be simple.

## Comparison with Alternatives

### Scenario: 3 teams, 2 environments, 15 developers

**Master vault approach:**
- 1 vault, 1 service, ~200 secrets
- All 15 developers have accounts on the service
- Every CI/CD pipeline connects to the same service
- Single admin manages everything

**Distributed approach:**
- 6 vaults (3 teams × 2 environments)
- Each team manages their own vault
- CI/CD pipelines connect to their team's vault
- Admins are per-team, not org-wide

| Criterion | Master Vault | Distributed |
|-----------|-------------|-------------|
| Blast radius | 200 secrets | ~33 secrets |
| Admin bottleneck | 1 person | 3 people (per-team) |
| Infrastructure | Must run HA service | No services (file-based) |
| Onboarding | Grant access to 1 vault | Grant access to team vault(s) |
| Offboarding | Revoke access to 1 vault | Revoke from team vault(s), rotate team key |

## Historical Context

The master vault pattern is common in enterprise secret managers (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault). These tools are designed for it -- they have:
- Dedicated server infrastructure with HA clustering
- Fine-grained, policy-based access control enforced at the server level
- Audit logging built into the server
- Professional operations teams to manage them

jseeqret is not competing with these tools. jseeqret is a lightweight, file-based secret manager for small teams and individual developers. Attempting to replicate the master vault pattern without the enterprise infrastructure would be insecure and unreliable.

## Decision Record

**Decision**: Do not implement a master vault.

**Date**: 2026-04-01

**Rationale**: The risks (single point of failure, single point of compromise, scaling limits) outweigh the benefits (simplicity, consistency). The alternatives (multi-vault + linked vault + shared vault + hierarchy) provide the same benefits with better fault isolation, and they align with jseeqret's file-based, no-infrastructure design philosophy.

**Revisit when**: The project needs to support organizations with 50+ developers or 100+ vaults, AND the vault service (Plan B) has been implemented and proven reliable.
