# Vault Hierarchy -- Security Concerns

## 1. Trust Link Signature Verification is One-Time

**Risk**: High | **Category**: Trust model

Trust links are signed by the parent vault's identity key and verified at acceptance time. After acceptance, the trust link is stored locally and the signature is not re-verified. If the parent vault's private key is later compromised:
- The attacker can create new trust offers that appear legitimate.
- Existing trust links remain valid (they were signed with the now-compromised key).
- There is no mechanism to propagate key revocation through the trust graph.

**Mitigation**:
- Implement a trust link expiration mechanism (Open Question #2) -- require periodic re-signing.
- Add a key revocation protocol: if a vault's key is compromised, it should be able to broadcast a revocation record that propagates through the trust graph.
- Consider a "last seen pubkey" check where child vaults verify the parent's current public key on each sync, not just at trust establishment.

## 2. Scope Narrowing Bypass via DAG Paths

**Risk**: High | **Category**: Privilege escalation

The plan enforces scope narrowing: a child can only have equal or narrower scope than its parent. But in a DAG (not tree), a vault can have multiple parents. An attacker who controls two vaults at different levels of the hierarchy could create a path that circumvents scope restrictions:

```
company-vault (scope: *:*:*)
  +-- team-a (scope: app-a:*:*)
  +-- team-b (scope: app-b:*:*)

If team-a trusts vault-x for app-a:*:* and team-b also trusts vault-x for app-b:*:*,
then vault-x effectively has scope app-a:*:* + app-b:*:*, which is wider than
either parent individually granted.
```

**Mitigation**: The effective scope of a vault should be the intersection (not union) of all paths from the root, or each trust link should be independently scoped and enforced. Document clearly how multi-parent scopes compose. Consider requiring that a child vault's total effective scope must be approved by all parents.

## 3. Policy Inheritance Creates Implicit Dependencies

**Risk**: Medium | **Category**: Operational security

Inherited policies (max expiry, required rotation) flow from parent to child. If a parent vault changes a policy (e.g., reduces max expiry from 90 to 30 days), all child vaults are affected on the next sync. A mistake or malicious change at the top of the hierarchy cascades downward.

**Mitigation**:
- Policy changes should propagate with a delay or require acknowledgment from child vault admins.
- Child vaults should be able to set stricter (but not looser) local policies that override inherited ones.
- Log all policy changes with the source vault and timestamp.

## 4. Trust Revocation Does Not Remove Secrets

**Risk**: High | **Category**: Data lifecycle

When trust is revoked (`jseeqret trust revoke --child team-backend`), the child vault retains all secrets it has already received. Trust revocation stops future sync but does not delete existing data. A revoked vault still has plaintext access to everything it received before revocation.

**Mitigation**:
- Document that trust revocation is not equivalent to secret revocation.
- After revoking trust, all secrets that were shared through the trust link should be rotated.
- Consider a "cascade revoke" option that re-encrypts affected secrets in the parent vault (rendering the child's copies stale).

## 5. Unidirectional Trust Assumption

**Risk**: Medium | **Category**: Trust model

Trust flows parent-to-child by default (parent delegates to child). But if bidirectional sync is configured, the child can push changes upward. A compromised child vault could:
- Push malicious secret values up to the parent, which then propagates them to all other children.
- Push tombstones to delete secrets across the entire subtree.

**Mitigation**: Bidirectional sync should be a separate, explicit opt-in with clear warnings. Upward pushes should require additional verification (e.g., admin approval at the parent level). Consider requiring that upward pushes are signed by a key the parent explicitly authorized for write access.

## 6. Identity Key Management Complexity

**Risk**: Medium | **Category**: Key management

Each vault has its own identity (UUID based on public key). In a hierarchy with many vaults, this creates:
- Many keypairs to manage (one per vault, plus user keypairs).
- Key rotation at any level requires re-signing all trust links from that vault.
- Lost private keys can orphan a vault from the trust graph.

**Mitigation**:
- Reuse existing NaCl keypairs for vault identity (as the plan suggests) -- don't introduce a separate key type.
- Implement key backup/recovery procedures.
- Allow a parent admin to re-establish trust with a vault that has regenerated its keys.

## 7. Trust Graph Cycles

**Risk**: Low | **Category**: Integrity

The plan specifies a DAG (directed acyclic graph), but there is no described mechanism to prevent cycles. If vault A trusts B, and B trusts A (through any path), sync propagation could loop indefinitely.

**Mitigation**: The trust link creation command should verify acyclicity before accepting. During sync, track visited vaults to detect loops. Reject trust offers that would create a cycle.

## 8. Offline Vaults Miss Policy Updates

**Risk**: Medium | **Category**: Compliance

Policies propagate through trust links during sync. An offline vault does not receive policy updates. If the parent vault tightens a rotation policy (e.g., from 90 days to 30 days), an offline child vault continues operating under the old policy indefinitely.

**Mitigation**: When a vault comes back online and syncs, policy changes should be applied immediately and retroactively. The audit command should check inherited policies and warn if they haven't been synced recently.

## Summary

| # | Concern | Risk | Action Required |
|---|---------|------|-----------------|
| 1 | Trust signatures verified once | High | Periodic re-signing or expiration |
| 2 | DAG allows scope combination | High | Define scope composition rules |
| 3 | Policy cascade from parent | Medium | Delay propagation, allow stricter overrides |
| 4 | Revocation doesn't remove secrets | High | Rotate secrets after revocation |
| 5 | Bidirectional sync = upward attack | Medium | Separate opt-in for upward push |
| 6 | Too many identity keys | Medium | Reuse NaCl keys, backup procedures |
| 7 | Possible trust graph cycles | Low | Verify acyclicity on trust creation |
| 8 | Offline vaults miss policy updates | Medium | Retroactive policy enforcement on sync |
