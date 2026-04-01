# Auto-Rotation

## Problem

In the current design, secrets do not expire. Once added to a vault, a secret remains unchanged until someone manually updates or deletes it. In practice, many secrets have a limited lifespan:

- **API keys** are rotated periodically by the provider or by policy.
- **Database passwords** should be changed on a regular schedule.
- **OAuth tokens** have built-in expiration.
- **Certificates** have validity periods.

When a secret expires or is rotated, every application and user that depends on it must be updated. Today there is no mechanism to track expiration, warn about upcoming rotations, or propagate rotated values to other vaults.

## Desired Behavior

1. **Expiration tracking** -- each secret can have an optional `expires_at` timestamp.
2. **Rotation tracking** -- when a secret is updated, record `rotated_at` to know when it was last changed.
3. **Audit warnings** -- a command that lists expired and soon-to-expire secrets.
4. **Propagation** -- when a secret is rotated in one vault, the new value reaches all other vaults that share it (via [linked vault](../linked-vault/) sync or [vault-to-vault](../vault-to-vault/) push).
5. **Application notification** -- running applications are told when a secret they depend on has been rotated, so they can reload or reconnect.

## Constraints

- The `expires_at` and `rotated_at` columns must be backward-compatible with the Python `seeqret` tool (nullable columns, graceful degradation if the columns don't exist).
- Expiration is **informational**, not enforced. An expired secret is still returned by `get_sync()` -- jseeqret logs a warning but does not block access. Failing hard could crash production.
- Clock accuracy matters. Expiration checks compare `expires_at` against the local system clock.

## Relationship to Other Features

| Feature | Relationship |
|---------|-------------|
| [Server Vault](../server-vault/) | Server applications need to know when to `reload()` after a rotation. |
| [Vault-to-Vault](../vault-to-vault/) | Rotated secrets should be pushed to recipients. |
| [Linked Vault](../linked-vault/) | Rotated secrets propagate through linked vault sync (they have a new `updated_at`). |
| [Shared Vault](../shared-vault/) | In a shared vault, rotation is immediately visible to all users. Notification is still needed for running applications. |
| [Sync-Merge](../sync-merge/) | Rotation metadata (`rotated_at`, `expires_at`) should be included in sync manifests. |

## Use Cases

### UC1: Audit before deployment
Before deploying to production, run `jseeqret audit --env prod` to check for expired or soon-to-expire secrets. Fix any issues before deploying.

### UC2: Scheduled rotation reminder
A CI/CD pipeline runs `jseeqret audit --warn-days 7` daily. If any secrets expire within 7 days, it posts a warning to the team's Slack channel.

### UC3: Post-rotation propagation
Admin rotates `DB_PASSWORD` in the shared vault. The server vault picks up the change via sync. The web server receives a reload event and reconnects to the database with the new password.

### UC4: Compliance reporting
`jseeqret audit --format json` outputs a machine-readable report of all secrets with their rotation history, for compliance documentation.

## Open Questions

1. **Expiration enforcement level**: Should `get_sync()` return expired secrets with a warning, throw an error, or accept an `allow_expired` parameter? Recommendation: return with a warning (log to stderr).
2. **Rotation triggers**: Should jseeqret support automatic rotation (e.g., calling a provider API to generate a new key)? Or is rotation always manual? Recommendation: manual for v1, with hooks for automation later.
3. **Notification channel**: How does a running application learn about a rotation? Options: file watcher + `reload()` event (from [server vault](../server-vault/)), polling, or SSE (from vault service).
4. **Rotation history**: Should the vault keep a history of previous values, or only the current value plus `rotated_at`? History is useful for rollback but increases storage and security surface.

## Documents

- [Implementation Plan](plan.md) -- schema changes, audit command, and propagation design
