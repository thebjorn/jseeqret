# Linked/Synced Vault Documentation

Scenario: As a developer wfh, I add a secret to my home vault.

If I forget to export the secret to myself, so I can import it at my work vault, then my work vault is missing secrets the new wfh-code is using.

It is generally too early to decide on exports when trying out new code that needs a new secret (the "finished" set of secrets will eventually need to be exported to everyone that needs them, but the "in-progress" set of secrets is more volatile and may not be worth exporting until they are finished). So, it would be nice if the vaults could be linked/synced together, so that any changes made to one vault are automatically reflected in the other vaults. This way, I can work on my secrets in my home vault and have them automatically available in my work vault without having to remember to export them.

Note the one vault will be at home behind a vpn and inaccessible from work (I cannot create a network connection from work to home).