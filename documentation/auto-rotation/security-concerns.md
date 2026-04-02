# Auto-Rotation -- Security Concerns

## 1. Expired Secrets Remain Accessible

**Risk**: Medium | **Category**: Design trade-off

The plan explicitly returns expired secrets with a warning rather than blocking access. This is the right call for availability, but it means expiration is purely informational. An attacker who obtains an expired secret can still use it against jseeqret -- the tool won't stop them. The real revocation must happen at the provider (database, API service, etc.).

**Mitigation**: Document clearly that `expires_at` is a reminder, not a security boundary. The `on_expired: 'throw'` option should be prominent for environments where hard enforcement is acceptable.

## 2. Clock Skew and Timestamp Manipulation

**Risk**: Medium | **Category**: Integrity

Expiration checks compare `expires_at` against the local system clock. On machines with incorrect clocks:
- Secrets may appear valid when they've actually expired (false negative -- security risk).
- Secrets may appear expired when they're still valid (false positive -- availability risk).

An attacker with write access to the system clock can suppress expiration warnings indefinitely.

**Mitigation**: The audit command should log the current system time in its output so discrepancies are visible. Consider adding an optional NTP check or UTC offset warning when the clock differs significantly from a known reference.

## 3. Audit Command Output Leaks Metadata

**Risk**: Low | **Category**: Information disclosure

The `jseeqret audit` command outputs secret names, apps, environments, and expiration dates. The `--format json` output is designed for CI/CD pipelines. If this output is logged to a build system, monitoring tool, or Slack channel, it reveals the full inventory of secrets (names, not values) and their rotation status.

**Mitigation**: Document that audit output contains sensitive metadata. The JSON output should not include secret values (it doesn't in the current plan -- good). CI/CD integrations should treat audit output as confidential.

## 4. Rotation Does Not Invalidate Old Values

**Risk**: High | **Category**: Operational security

The plan acknowledges this: "Rotating a secret in jseeqret does not revoke the old value at the provider." This is the most significant security gap. A user who rotates `DB_PASSWORD` in jseeqret may believe the old password is invalidated, when in fact the old password still works at the database level until separately changed there.

**Mitigation**: The `update` command (when it sets `rotated_at`) should print a clear warning: "Remember to rotate this credential at the source (database, API provider, etc.)." The audit command should distinguish between "rotated in jseeqret" and "confirmed rotated at provider" (though the latter requires provider integration, which is out of scope for v1).

## 5. Rotation History as an Attack Surface

**Risk**: Medium | **Category**: Data exposure

Open Question #2 in the plan considers a `rotation_history` table storing previous values. If implemented, this table becomes a high-value target -- it contains not just the current secret but all historical values, any of which may still be valid at the provider.

**Mitigation**: If rotation history is implemented in a future version, historical values should be Fernet-encrypted (they already would be if stored as tokens), and there should be a configurable retention limit with automatic purging. Consider storing only content hashes rather than actual previous values.

## 6. `on_expiring_soon` Callback Timing

**Risk**: Low | **Category**: Denial of service

The `on_expiring_soon` callback fires during `init()` for all expiring secrets. If a vault has many secrets approaching expiration simultaneously, and the callback performs expensive operations (e.g., network calls, logging to external services), `init()` could become very slow or fail entirely, preventing the application from starting.

**Mitigation**: Document that the callback should be lightweight. Consider making the callback async and non-blocking, or providing a way to batch notifications.

## 7. Exit Code Semantics in CI/CD

**Risk**: Low | **Category**: Operational

The plan defines exit code 1 for expired secrets and 2 for expiring-soon. If a CI/CD pipeline uses `jseeqret audit --strict` as a gate, an attacker who can manipulate secret metadata (e.g., by setting `expires_at` to a past date) could force deployments to fail -- a denial-of-service on the deployment pipeline.

**Mitigation**: Ensure that only users with write access can modify `expires_at`. In shared vaults, the ACL should restrict who can set expiration dates.

## Summary

| #   | Concern                             | Risk   | Action Required                             |
| --- | ----------------------------------- | ------ | ------------------------------------------- |
| 1   | Expired secrets still accessible    | Medium | Document as design trade-off                |
| 2   | Clock skew affects accuracy         | Medium | Log system time in audit output             |
| 3   | Audit output leaks metadata         | Low    | Document as confidential output             |
| 4   | Rotation != provider revocation     | High   | Add CLI warning on rotation                 |
| 5   | Rotation history stores old secrets | Medium | Limit retention if implemented              |
| 6   | Callback performance on init        | Low    | Document lightweight callback best practice |
| 7   | Exit codes as DoS vector            | Low    | ACL on expiration metadata                  |
