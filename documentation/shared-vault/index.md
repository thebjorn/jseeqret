# What if two (or more) users want to share a vault?

In the current design, there is a single vault directory (default: `/srv/.seeqret`) that contains one `seeqret.key` and one `seeqrets.db`. This means that only one user can have access to the vault at a time. What if two (or more) users want to share a vault? For example, a team of developers working on the same project might want to share a vault that contains the secrets for that project. How can we design the vault system to allow for shared access while still maintaining security and privacy?
