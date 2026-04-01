# Master Vault?

This is the idea that there is a single "master vault" that contains all secrets, and users can fetch secrets from it. This is the simplest design, but it has some drawbacks:
- It creates a single point of failure. If the master vault is compromised, all secrets are at risk.
- It creates a single point of access. If the master vault is unavailable, users cannot fetch secrets.
- It creates a single point of management. If the master vault is misconfigured, all secrets are at risk.