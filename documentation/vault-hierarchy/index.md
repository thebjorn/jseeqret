# Vault Hierarchy

## Problem

As the number of vaults grows -- per-project vaults, shared team vaults, server vaults, personal vaults -- managing access becomes unwieldy. Each vault has its own ACL, its own user list, and its own trust relationships. There is no way to say "this team vault trusts the company vault" or "access to the staging vault implies access to the dev vault."

A vault hierarchy organizes vaults into a tree (or DAG) of trust relationships, where access and policies can be inherited from parent vaults.

## Desired Behavior

1. **Trust links** -- a vault can declare that it trusts another vault. Secrets and access rules flow downward through the trust chain.
2. **Scope inheritance** -- a user granted access at a higher level automatically has access to child vaults (subject to scope narrowing).
3. **Delegation** -- a vault admin can delegate sub-administration of child vaults without granting full access to the parent.
4. **Policy propagation** -- rotation policies, expiration defaults, and ACL rules can be set at a parent level and inherited by children.

## Example Hierarchy

```
company-vault (root)
├── team-backend
│   ├── server-prod
│   ├── server-staging
│   └── dev-alice
├── team-frontend
│   ├── server-cdn
│   └── dev-bob
└── ops
    ├── monitoring
    └── ci-cd
```

- `company-vault` sets company-wide policies (e.g., all secrets must expire within 90 days).
- `team-backend` inherits company policies and adds team-specific secrets.
- `server-prod` inherits from `team-backend` and has its own runtime secrets.
- `dev-alice` is Alice's personal dev vault, linked to `team-backend` for shared secrets.

## Constraints

- The hierarchy is a DAG (directed acyclic graph), not a strict tree. A vault can trust multiple parents (e.g., a staging vault trusts both the backend team vault and the ops vault).
- Trust links are cryptographic -- they are signed by the parent vault's identity key and verified by the child.
- The hierarchy is optional. Vaults with no trust links work exactly as they do today (standalone).
- This is a Phase 4 (Future) feature from the roadmap. It depends on vault identity, multi-vault, and linked vault.

## Relationship to Other Features

| Feature                            | Relationship                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Multi-Vault](../multi-vault/)     | Prerequisite -- vaults must be addressable by name in a registry.                                            |
| [Linked Vault](../linked-vault/)   | Trust links are a formalized version of vault links, with cryptographic verification and policy inheritance. |
| [Shared Vault](../shared-vault/)   | A shared vault can be a node in the hierarchy. Its ACL can inherit rules from a parent.                      |
| [Master Vault](../master-vault/)   | The hierarchy root is *not* a master vault -- it delegates rather than centralizes.                          |
| [Sync-Merge](../sync-merge/)       | Secrets propagate through the hierarchy using the sync-merge algorithm.                                      |
| [Auto-Rotation](../auto-rotation/) | Rotation policies (max age, required rotation interval) can be set at the parent level and inherited.        |

## Trust Model

### Trust Link
A signed declaration: "Vault A trusts Vault B with scope S." The scope defines what secrets and access rules flow through the link.

### Scope Narrowing
A child vault can only have equal or narrower scope than its parent. If `team-backend` has access to `myapp:*:*`, it can delegate `myapp:staging:*` to `server-staging`, but not `otherapp:*:*`.

### Unidirectional Trust
Trust flows downward (parent → child). A child vault trusting a parent does not give the child access to the parent's secrets -- it allows the parent's policies and delegated secrets to flow to the child.

## Open Questions

1. **When is this needed?** Only when the project scales to many vaults (10+) across multiple teams. For small teams (2-5 people, 2-3 vaults), the simpler features (multi-vault, linked vault, shared vault) are sufficient.
2. **Python compatibility**: The Python `seeqret` tool would need to implement the same trust model to participate in a hierarchy. This is a significant effort and may not be practical in the near term.
3. **Conflict resolution in hierarchy**: If a parent and child vault both have the same secret with different values, which wins? Options: parent always wins (authoritative), most recent wins (LWW), or manual resolution.
4. **Revocation propagation**: If a user's access is revoked at the parent level, how quickly does this propagate to child vaults? Immediately (requires real-time communication) or eventually (on next sync)?

## Documents

- [Implementation Plan](plan.md) -- trust link design, scope model, and phased implementation
