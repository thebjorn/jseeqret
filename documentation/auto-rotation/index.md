# Secrets should/do expire

In the current design, secrets do not have an expiration date. Once a secret is added to the vault, it will remain there until it is manually deleted or updated. Many secrets (e.g. API keys, database passwords) have a limited lifespan and should be rotated regularly. How can we implement secret expiration and rotation in the vault?

How do we communicate rotations to everyone sharing the secret? For example, if a database password is rotated, how do we ensure that all applications and users that rely on that password are updated with the new value?