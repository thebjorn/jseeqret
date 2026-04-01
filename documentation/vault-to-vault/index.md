# Vault-to-Vault communication

In the current design, a user must 

1. import the public key of the user they want to share secrets with, and then
2. export the secrets they want to share, encrypting them with the recipient's public key
3. transmit the encrypted secrets to the recipient (e.g. via email, API, etc.)
4. the recipient can then import the encrypted secrets into their own vault, decrypting them with their private key (and encrypting them with their own vault key)


## Server Vaults

For server vaults we could potentially create an ssh connection where the user can run a command line to import secrets to the server vault.


## Shared Vaults

For shared vaults, multiple users can have physical access to the same vault, allowing them to share secrets without the need for individual key exchanges.


## Ideas for user-to-user vault communication

- Implementing a secure messaging system within the vault application to facilitate direct secret sharing between users.

- Creating a web interface where users can manage their vaults and share secrets with other users through a secure API.

A typical user does not have a service running...