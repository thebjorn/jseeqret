# Master Vault

## The Idea

A single "master vault" that contains all secrets for an entire organization. Users and servers fetch secrets from this central vault. One vault to rule them all.

## Why It's Tempting

- **Simplicity**: One place to look, one place to manage. No sync, no links, no hierarchy.
- **Consistency**: Everyone gets the same value for the same secret. No drift between vaults.
- **Audit**: One audit log captures all access. Easy to answer "who accessed what, when."

## Why We Don't Recommend It

The master vault pattern has fundamental problems that outweigh its simplicity:

### Single Point of Failure
If the master vault is unavailable (server down, network outage, disk failure), no application in the organization can read secrets. Every web server, every CI pipeline, every developer is blocked.

### Single Point of Compromise
If the master vault is breached, every secret in the organization is exposed. The blast radius is total. With distributed vaults, a compromise of one vault only exposes that vault's secrets.

### Single Point of Management
All administrative operations flow through one vault. Misconfigurations, accidental deletions, and key rotations affect everyone simultaneously. There is no isolation between teams or projects.

### Availability vs. Security Tension
A master vault must be highly available (so applications don't crash) and highly secure (because it contains everything). These goals conflict: high availability means more network exposure, more replicas, more attack surface.

### Scaling Limits
SQLite (jseeqret's storage layer) is designed for single-machine use. A master vault serving many concurrent clients would need a different storage backend, fundamentally changing the architecture.

## What to Do Instead

The other feature areas provide the benefits of centralization without the risks:

| Master Vault Benefit | Alternative                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| One place to manage  | [Multi-Vault](../multi-vault/) with registry -- name-based access to any vault           |
| Consistency          | [Linked Vault](../linked-vault/) sync -- eventual consistency without central dependency |
| Shared access        | [Shared Vault](../shared-vault/) -- scoped to a team, not the whole org                  |
| Audit                | Audit columns in each vault + [Auto-Rotation](../auto-rotation/) audit command           |
| Hierarchy            | [Vault Hierarchy](../vault-hierarchy/) -- delegation without centralization              |

## When a "Root Vault" Makes Sense

In the [vault hierarchy](../vault-hierarchy/), the root vault is superficially similar to a master vault. The critical difference:

- A **master vault** stores all secrets and serves them directly. It is the runtime dependency.
- A **root vault** sets policies and delegates. It may contain no runtime secrets at all. Applications never read from it directly -- they read from leaf vaults that inherited policies (and possibly secrets) from the root.

The root vault can go offline without affecting running applications. It is a management plane, not a data plane.

## Recommendation

**Do not build a master vault.** The roadmap explicitly excludes it across all three plans (A, B, and C). Instead, use multi-vault + linked vault + shared vault for the same benefits with better fault isolation.

## Documents

- [Analysis](plan.md) -- detailed risk analysis and comparison with alternatives
