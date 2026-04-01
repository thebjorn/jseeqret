# Shared Vault

## Problem

In the current design, a vault is a directory containing one `seeqret.key` and one `seeqrets.db`. A single user owns the key and has full control. What if a team of developers working on the same project needs shared access to the same set of secrets?

Today, the only way to share secrets is through [vault-to-vault](../vault-to-vault/) export/import -- each user maintains their own copy. This leads to drift: one developer updates a secret but forgets to re-export it, and others are left with stale values.

## Desired Behavior

1. **Multiple users access the same vault** -- one `seeqrets.db`, shared across team members.
2. **Access control** -- not all users should have the same permissions. Some can read all secrets, others only secrets for specific apps or environments.
3. **Audit trail** -- who added, modified, or deleted each secret, and when.
4. **Concurrent access** -- two users can read/write to the vault without corrupting the database.
5. **No single key holder** -- if only one person has `seeqret.key` and they leave the organization, the vault is effectively locked.

## Access Models

### Model A: Shared Symmetric Key
All authorized users have a copy of `seeqret.key`. Anyone with the key has full access to all secrets. This is simple but provides no granularity -- it's all-or-nothing.

**Pros**: Simple, no infrastructure changes.
**Cons**: No access control, no audit trail, key compromise exposes everything.

### Model B: Advisory ACL (Plan A from roadmap)
An `acl.json` file in the vault directory defines who can access which secrets. The ACL is advisory -- anyone with `seeqret.key` can technically bypass it, but the CLI and GUI enforce the rules.

**Pros**: Simple to implement, human-readable ACL file, works with existing vault structure.
**Cons**: Not enforceable at the crypto level. Relies on trust and tooling compliance.

### Model C: Service-Mediated Access (Plan B from roadmap)
A vault service mediates all access. Users authenticate with their NaCl keypair. The service enforces ACL rules before returning decrypted secrets. No user ever touches `seeqret.key` directly.

**Pros**: Real access control, audit logging, revocable access.
**Cons**: Requires running a service, more operational complexity.

## Constraints

- The vault directory may be on a shared filesystem (network share, cloud-synced folder) or accessed through a service.
- SQLite does not handle concurrent writers well over network filesystems. If the vault is shared via a network path, concurrent writes need coordination.
- Must remain compatible with the Python `seeqret` tool (shared vault features should degrade gracefully if the Python tool doesn't implement ACLs).

## Relationship to Other Features

| Feature | Relationship |
|---------|-------------|
| [Multi-Vault](../multi-vault/) | A shared vault appears in each user's registry, pointing to the same directory. |
| [Vault-to-Vault](../vault-to-vault/) | Alternative: instead of sharing a vault, send secrets between individual vaults. |
| [Linked Vault](../linked-vault/) | Complementary: linked vault = one user, multiple vaults. Shared vault = multiple users, one vault. |
| [Auto-Rotation](../auto-rotation/) | Rotated secrets in a shared vault are immediately visible to all users. |
| [Server Vault](../server-vault/) | A server vault is often a shared vault -- multiple admins manage it. |
| [Vault Hierarchy](../vault-hierarchy/) | Shared vaults can be organized into a hierarchy with inherited access rules. |
| [Master Vault](../master-vault/) | A shared vault for the entire organization is essentially a master vault (with all its drawbacks). |

## Use Cases

### UC1: Team project vault
A team of 4 developers shares a vault for their project. All can read secrets. Two senior devs can add/update. The ACL restricts the junior dev to read-only on production secrets.

### UC2: Admin pool
Three sysadmins share a vault for server credentials. Any admin can add or rotate secrets. The audit trail tracks who changed what.

### UC3: Contractor access
A contractor needs temporary read access to a subset of secrets. They are added to the ACL with a filter (`myapp:staging:*`) and an expiration date. When the contract ends, their access is revoked.

## Open Questions

1. **ACL storage**: File (`acl.json`) or database table? A file is easier to version-control and review. A table is atomic and doesn't require a separate file.
2. **Concurrency**: How to handle simultaneous writes from two admins? Options: SQLite WAL mode (works for local filesystems), lockfile coordination, or service-mediated access.
3. **Key distribution**: How does a new team member get `seeqret.key`? Options: encrypted with their NaCl public key and sent via vault-to-vault, or derived from a team passphrase.
4. **Key rotation**: If a team member leaves, should `seeqret.key` be rotated? This requires re-encrypting all secrets -- expensive but necessary for security.

## Documents

- [Implementation Plan](plan.md) -- ACL design, audit columns, and phased implementation
