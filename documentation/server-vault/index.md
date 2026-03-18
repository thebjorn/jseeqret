# Server Vaults

There are two main use-cases for the server vault:

1. It is where the web server reads secrets from at runtime. The vault provides an API for fetching secrets, and the web server uses it to get the secrets it needs to run the application.
2. It is where administrators can add or update secrets. The vault provides an API for adding or updating secrets, and administrators can use it to manage the secrets in the vault.