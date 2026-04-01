# Vault Hierarchy -- Implementation Plan

## Overview

Vault hierarchy introduces cryptographic trust links between vaults, enabling policy inheritance and scoped delegation. This is a Phase 4 (Future) feature -- it builds on vault identity, multi-vault, linked vault, and shared vault.

**Recommendation**: Do not build this until the project has a concrete need for 10+ vaults across multiple teams. The simpler features (multi-vault, linked vault, shared vault) cover the near-term use cases.

## Prerequisites

- **Vault identity** (from [linked vault](../linked-vault/plan.md) Phase 2) -- each vault has a stable UUID.
- **Multi-vault registry** (from [multi-vault](../multi-vault/plan.md)) -- vaults are addressable by name.
- **Sync-merge** (from [sync-merge](../sync-merge/plan.md)) -- conflict resolution for secret propagation.
- **ACL** (from [shared vault](../shared-vault/plan.md)) -- access control rules that can be inherited.

## Phase 1: Trust Links

### Goal
A vault can declare a cryptographic trust relationship with another vault.

### Trust Link Record

```sql
CREATE TABLE IF NOT EXISTS trust_links (
    id              TEXT PRIMARY KEY,
    parent_vault_id TEXT NOT NULL,       -- vault ID of the parent
    child_vault_id  TEXT NOT NULL,       -- vault ID of the child (this vault)
    scope           TEXT NOT NULL,       -- FilterSpec glob defining what flows through this link
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL,       -- who established the trust
    signature       TEXT NOT NULL,       -- NaCl signature by parent vault's identity key
    UNIQUE(parent_vault_id, child_vault_id)
);
```

### Establishing Trust

1. Parent vault admin creates a trust offer:
   ```powershell
   jseeqret trust offer --to team-backend --scope "myapp:*:*"
   ```
   This generates a signed trust offer file.

2. Child vault admin accepts the offer:
   ```powershell
   jseeqret trust accept trust-offer-20260401.json
   ```
   This verifies the parent's signature and stores the trust link.

### Revoking Trust

```powershell
jseeqret trust revoke --child team-backend
```

Revocation removes the trust link. The child vault retains its existing secrets but stops receiving updates from the parent.

### Deliverables
- Migration adding `trust_links` table
- `src/core/trust.js` module -- create, verify, store, revoke trust links
- `src/cli/commands/trust.js` -- trust offer, accept, revoke, list
- Tests for trust link lifecycle

## Phase 2: Policy Inheritance

### Goal
ACL rules and rotation policies flow from parent to child through trust links.

### Inherited Policies

When a child vault syncs with its parent, it receives:

1. **ACL rules** scoped to the trust link's scope. If the parent has `alice: admin, *:*:*` and the trust scope is `myapp:*:*`, the child inherits `alice: admin, myapp:*:*`.
2. **Rotation policies** (e.g., "all secrets must expire within 90 days"). These are stored in `vault_meta` and propagated through trust links.
3. **User public keys** so the child vault can verify identities that were established at the parent level.

### Policy Storage

```sql
CREATE TABLE IF NOT EXISTS policies (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,       -- 'max_expiry_days', 'required_rotation_days', etc.
    value       TEXT NOT NULL,
    scope       TEXT DEFAULT '*:*:*',
    inherited_from TEXT,             -- vault_id of the source, NULL if local
    created_at  TEXT NOT NULL
);
```

### Policy Enforcement

Policies are advisory in Plan A (like ACLs). The CLI and GUI warn when a policy is violated but don't block operations. Example: adding a secret without an `expires_at` when the inherited policy requires it produces a warning.

### Deliverables
- Migration adding `policies` table
- Policy inheritance logic during sync
- Policy enforcement (warnings) in CLI and storage
- Tests for policy inheritance across trust links

## Phase 3: Scoped Secret Propagation

### Goal
Secrets from a parent vault automatically propagate to child vaults within the trust scope.

### Mechanism

This reuses the [sync-merge](../sync-merge/plan.md) algorithm with a scope filter:

1. During sync, the parent vault's manifest is filtered by the trust link's scope.
2. Only secrets matching the scope are included in the diff.
3. The sync direction is parent → child (unidirectional by default). The child can configure bidirectional sync for vaults where the child also creates secrets that should flow upward.

### Scope Narrowing Enforcement

When establishing a trust link, the scope must be a subset of (or equal to) any scope inherited from the grandparent. This prevents privilege escalation:

```
company-vault (scope: *:*:*)
  └── team-backend (scope: myapp:*:*)
        └── server-staging (scope: myapp:staging:*)  ✓ valid
        └── server-all (scope: *:*:*)               ✗ rejected (wider than parent)
```

### Deliverables
- Scoped sync integration (trust scope → FilterSpec → sync-merge)
- Scope narrowing validation on trust link creation
- Tests for scoped propagation and narrowing enforcement

## Phase 4: Hierarchy Visualization

### Goal
The GUI shows the vault hierarchy as an interactive tree.

### Design
- **Tree view** showing parent-child relationships between vaults.
- **Scope labels** on each edge showing what flows through the trust link.
- **Status indicators** showing sync status (last sync time, pending changes).
- **Policy view** showing inherited vs. local policies for each vault.
- **Trust management** -- create offers, accept offers, revoke trust from the GUI.

### CLI Hierarchy View

```powershell
jseeqret trust tree

  company-vault
  ├── team-backend (scope: myapp:*:*)
  │   ├── server-prod (scope: myapp:prod:*)
  │   ├── server-staging (scope: myapp:staging:*)
  │   └── dev-alice (scope: myapp:dev:*)
  └── ops (scope: *:*:infra-*)
      └── ci-cd (scope: *:*:infra-*)
```

### Deliverables
- `jseeqret trust tree` command
- Svelte tree visualization component
- Policy and scope display in the GUI

## Complexity Assessment

This is the most complex feature area in jseeqret. Key risks:

| Risk | Mitigation |
|------|-----------|
| Over-engineering for current scale | Don't build until 10+ vaults are needed. |
| Python compatibility | Accept that the Python tool may not implement hierarchy. Hierarchy is JS-only until Python catches up. |
| Scope enforcement complexity | Start with simple FilterSpec scopes. Add more sophisticated scope algebra later if needed. |
| Trust link key management | Reuse existing NaCl keypairs. Don't introduce a separate identity key system. |

## Implementation Order

```
Phase 1: Trust links                   ← depends on vault identity
Phase 2: Policy inheritance            ← depends on Phase 1 + ACL
Phase 3: Scoped secret propagation     ← depends on Phase 1 + sync-merge
Phase 4: Hierarchy visualization       ← depends on Phases 1-3
```

Phases 2 and 3 can be developed in parallel after Phase 1 is complete.

## Open Questions

1. **DAG vs. tree**: Should a vault be allowed to trust multiple parents? A DAG is more flexible but introduces complexity (conflicting policies from different parents). Recommendation: allow multiple parents, use priority ordering to resolve conflicts.
2. **Trust expiration**: Should trust links have an expiration date? This would force periodic renewal, improving security at the cost of operational overhead.
3. **Offline trust verification**: How does a child vault verify the parent's signature if the parent is offline? Answer: the signature is verified at acceptance time. Ongoing verification isn't needed -- the trust link is stored locally.
