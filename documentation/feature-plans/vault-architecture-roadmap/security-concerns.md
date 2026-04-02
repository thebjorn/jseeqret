# Vault Architecture Roadmap -- Security Concerns

This document covers cross-cutting security concerns that span the three architectural plans and the phased roadmap. For feature-specific concerns, see the `security-concerns.md` in each feature directory.

## Cross-Plan Concerns

### 1. Plaintext Key Files on Disk

**Risk**: High | **Category**: Key management (all plans)

All three plans inherit the current design where `seeqret.key`, `private.key`, and `public.key` are stored as plaintext base64-encoded files in the vault directory. Any process or user with read access to the vault directory can extract the encryption keys.

**Mitigation**:
- Vault directories must have restrictive filesystem permissions (documented in deployment guides).
- Future enhancement: encrypt `seeqret.key` with a passphrase (key derivation via Argon2 or scrypt). The passphrase would be entered at `init()` time.
- On Windows, consider using DPAPI to protect key files at rest (ties decryption to the Windows user account).
- On Linux, consider integration with the kernel keyring or secret service API.

### 2. No Memory Protection for Secrets

**Risk**: Medium | **Category**: Runtime security (all plans)

Decrypted secrets reside in JavaScript heap memory as plain strings. They are not zeroed after use, and the garbage collector may leave copies in freed memory. Memory dumps (core dumps, crash reports, heap snapshots) could contain plaintext secrets.

**Mitigation**:
- This is a fundamental limitation of JavaScript/Node.js (no secure memory allocation).
- Document that systems handling highly sensitive secrets should use process isolation (containers, VMs) to limit memory dump exposure.
- Avoid logging or serializing the in-memory cache unnecessarily.

### 3. Migration Backward Compatibility as an Attack Surface

**Risk**: Medium | **Category**: Integrity (all plans)

The migration strategy uses nullable columns with graceful degradation. This means old tooling versions ignore security-relevant columns:
- Python `seeqret` ignores `expires_at` -- expired secrets produce no warnings.
- Old JS versions ignore `acl.json` -- access control is silently bypassed.
- Old versions ignore `deleted_at` -- tombstones appear as normal secrets.

An attacker could downgrade the tooling version to bypass security features.

**Mitigation**: Consider a minimum schema version check: if the database has security-relevant columns, the tooling should refuse to operate if it doesn't understand them. Add a `min_tool_version` row to `vault_meta` that is updated by migrations.

### 4. No Transport Layer Security for Local Services

**Risk**: High | **Category**: Network security (Plan B)

Plan B's vault service binds to localhost by default, but the plan mentions remote access scenarios. If the service is exposed on a network interface without TLS:
- Secrets transit the network in the clear (within the NaCl auth envelope, but the HTTP layer is unprotected).
- Session tokens can be sniffed and replayed.
- Man-in-the-middle attacks can intercept the NaCl challenge-response.

**Mitigation**: Require TLS for any non-localhost binding. Consider bundling a self-signed certificate generator for development use and requiring trusted certificates for production.

### 5. Trust Establishment Bootstrap Problem

**Risk**: Medium | **Category**: Trust model (Plan C, also relevant to vault-to-vault)

All trust in jseeqret ultimately derives from the initial key exchange: when Alice adds Bob's public key, she must trust that it's really Bob's key. None of the three plans address this bootstrap problem:
- There is no certificate authority or key server.
- Public keys are exchanged out-of-band (email, chat, file).
- A MITM during initial key exchange compromises all subsequent communication.

**Mitigation**:
- Display key fingerprints during `user add` and provide a CLI command to verify fingerprints out-of-band.
- Consider a TOFU (Trust On First Use) model with fingerprint verification.
- Document that the initial key exchange is the security foundation and must happen over a trusted channel.

## Plan-Specific Concerns

### Plan A: Incremental Extension

**Risk Area**: Advisory security creates a false sense of protection.

Plan A's ACL is advisory, identity is spoofable, and all security relies on filesystem permissions. Users may see "access control" features in the CLI and believe they are protected, when in reality anyone with `seeqret.key` has full access.

**Mitigation**: Use clear, honest language in documentation and CLI output. When the ACL blocks an operation, the error message should include: "Note: This is advisory access control. Users with direct access to seeqret.key can bypass this restriction."

### Plan B: Vault Service

**Risk Area**: Service availability becomes a security dependency.

Plan B moves all access through an HTTP service. If the service crashes, hangs, or is DDoS'd, all applications lose access to secrets. The service also becomes a single point for authentication attacks (brute force, credential stuffing).

**Mitigation**: Implement rate limiting, health checks, and graceful degradation (fall back to cached values if the service is unreachable). The `VaultClient` should cache secrets locally and serve from cache during outages.

### Plan C: Federated Vaults

**Risk Area**: Complexity breeds vulnerabilities.

Plan C introduces the most new cryptographic and distributed systems concepts: trust links, signed sync records, version vectors, gossip protocol, scope inheritance. Each of these is a potential source of implementation bugs. The trust graph traversal, in particular, is easy to get wrong (cycles, scope escalation, revocation propagation).

**Mitigation**: Plan C should not be attempted without extensive property-based testing, formal verification of the scope narrowing logic, and a security audit before deployment.

## Roadmap Phase Risks

### Phase 1 (Foundation) -- Low Risk
Auto-rotation and multi-vault are additive features with no new attack surface. The migration is backward-compatible. Risk: users rely on `expires_at` for security instead of treating it as informational.

### Phase 2 (Sharing) -- Medium Risk
Shared vault ACL and server push/pull introduce multi-user concerns. The advisory ACL is the main risk. Secret request protocol introduces signed messages -- implementation must be correct.

### Phase 3 (Service) -- High Risk
The vault service introduces network attack surface, authentication, session management, and real-time communication. This phase requires security review before deployment.

### Phase 4 (Federation) -- Very High Risk
Trust links, distributed sync, and scope inheritance are the most security-critical features. Implementation bugs here could enable privilege escalation, unauthorized access, or data loss. This phase should include a formal security audit.

## Recommendations

1. **Phase security reviews into the roadmap**: Each phase should include a security review before declaring it complete. Plan A features need less review; Plan B/C features need more.
2. **Add threat modeling to each feature plan**: Each feature's `security-concerns.md` should be reviewed and updated as implementation progresses.
3. **Establish a key ceremony process**: Document how initial key exchange should happen for different threat levels (casual team, compliance-regulated environment, cross-organization).
4. **Consider a security configuration level**: A vault-wide setting (`security_level: 'advisory' | 'enforced'`) that controls whether the tooling operates in advisory mode (Plan A) or enforced mode (Plan B/C).
5. **Implement `min_tool_version` checks**: Prevent security bypasses via tooling downgrades.

## Summary

| #   | Concern                      | Risk   | Plans Affected | Action Required                 |
| --- | ---------------------------- | ------ | -------------- | ------------------------------- |
| 1   | Plaintext key files          | High   | All            | OS-level key protection         |
| 2   | No memory protection         | Medium | All            | Document as limitation          |
| 3   | Migration downgrade attack   | Medium | All            | `min_tool_version` check        |
| 4   | No TLS for vault service     | High   | Plan B         | Require TLS for non-localhost   |
| 5   | Trust bootstrap problem      | Medium | Plan C, V2V    | Key fingerprint verification    |
| 6   | Advisory ACL false security  | Medium | Plan A         | Honest documentation            |
| 7   | Service as availability risk | Medium | Plan B         | Caching + graceful degradation  |
| 8   | Complexity breeds bugs       | High   | Plan C         | Formal testing + security audit |
