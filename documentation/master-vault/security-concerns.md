# Master Vault -- Security Concerns

> **Note**: The master vault is an anti-pattern that jseeqret deliberately avoids. This security analysis reinforces that decision by cataloguing the security risks.

## 1. Single Point of Compromise (Total Blast Radius)

**Risk**: Critical | **Category**: Confidentiality

A master vault containing all organizational secrets means that a single breach exposes everything. The analysis document quantifies this: with distributed vaults, a compromise exposes ~33 secrets (one team's vault); with a master vault, all ~200 secrets are exposed. The attacker's reward-to-effort ratio is maximized.

**Assessment**: This is the primary reason to avoid the master vault pattern. No mitigation can reduce this to acceptable levels without fundamentally changing the architecture (at which point it's no longer a master vault).

## 2. Key Compromise Is Catastrophic

**Risk**: Critical | **Category**: Key management

One `seeqret.key` encrypts everything. If this key is leaked:
- Every secret in the organization is immediately decryptable.
- Key rotation requires re-encrypting every secret -- an operation that is both expensive and risky at scale.
- There is no compartmentalization: the key for the CEO's credentials is the same key for the test environment's dummy passwords.

**Assessment**: With distributed vaults, key compromise is scoped. Each vault has its own key, limiting the blast radius.

## 3. Availability vs. Security Tension

**Risk**: High | **Category**: Architectural

The master vault must be always available (applications crash without secrets) and always secure (it contains everything). These goals conflict:
- High availability requires network exposure, replicas, and failover -- each adding attack surface.
- High security requires minimal exposure, strict access control, and audit -- each adding operational complexity and potential failure points.

**Assessment**: Distributed vaults resolve this tension: each vault optimizes for its own availability/security balance independently.

## 4. Administrative Single Point of Failure

**Risk**: High | **Category**: Operational

A single admin (or small admin team) manages all secrets for the entire organization. Mistakes cascade:
- An accidental `DELETE FROM secrets` affects every application.
- A misconfigured ACL could lock out entire teams.
- Admin account compromise grants total control.

**Assessment**: Per-team vault administration distributes this risk.

## 5. Network Attack Surface

**Risk**: High | **Category**: Infrastructure

A master vault serving multiple clients requires a network service (Plan B's vault service at minimum). This service must:
- Accept connections from every application and every admin.
- Be reachable from every network segment where applications run.
- Handle authentication for every user in the organization.

Each of these is an attack surface: credential stuffing, DoS, man-in-the-middle, API exploitation.

**Assessment**: Distributed vaults minimize network exposure. Most vaults are local files with no network attack surface.

## 6. Insider Threat Amplification

**Risk**: High | **Category**: Trust model

In a master vault, every admin has access to every secret. A disgruntled admin can exfiltrate the entire organization's secret inventory in one operation. With distributed vaults, an admin only has access to the vaults they're responsible for.

**Assessment**: The principle of least privilege is impossible to enforce with a single vault.

## 7. Compliance and Audit Complexity

**Risk**: Medium | **Category**: Compliance

A master vault creates a single audit log for all secret access across the organization. While this seems simpler, it means:
- The audit log is itself a high-value target (it reveals who accessed what).
- Compliance scoping becomes harder: PCI secrets and non-PCI secrets share the same infrastructure.
- Access reviews must cover the entire organization rather than team-scoped reviews.

**Assessment**: Per-vault audit logs are naturally scoped to their compliance domain.

## Decision Reinforcement

The existing analysis document correctly identifies the master vault as an anti-pattern. This security review reinforces that decision. Every concern listed above is either eliminated or significantly reduced by the distributed vault approach (multi-vault + linked vault + shared vault + hierarchy).

The only scenario where revisiting this decision makes sense is if the vault service (Plan B) is implemented with enterprise-grade infrastructure (HA clustering, fine-grained policy engine, professional operations). Even then, the distributed model provides better defense-in-depth.
