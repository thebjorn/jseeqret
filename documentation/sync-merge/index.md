# Synchronizing Vaults Documentation

Scenario: I have two vaults and want to keep them in sync.

I want to make sure that a set of secrets (potentially all) are the same in 2+ vaults.

- new secrets only in vault A should be added to vault B
- new secrets only in vault B should be added to vault A
- secrets that are in both vaults but have different values should be updated to the most recent value (based on last modified timestamp)
- secrets that are in both vaults and have the same value should be left unchanged
- secrets that are in one vault but not the other should be added to the other vault
- secrets that are deleted from one vault but still exist in the other vault should be deleted from the other vault as well (if they were deleted more recently than they were modified in the other vault)