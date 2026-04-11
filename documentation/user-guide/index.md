# jseeqret User Guide

jseeqret is a secure secrets manager. It stores, encrypts, and exchanges
API keys, database passwords, and other credentials across a small team
without requiring a shared infrastructure.

Two guides live here:

- **[admin-guide.md](admin-guide.md)** -- for the person who creates the
  vault, provisions the Slack workspace, onboards teammates, and keeps
  `slack doctor` green. Start here if you are setting jseeqret up for
  a team.
- **[end-user.md](end-user.md)** -- for the day-to-day user sending and
  receiving secrets through an already-provisioned vault and Slack
  channel. Start here if someone has already told you "we use jseeqret
  for secrets, please log in".

Both guides focus on the Slack-based exchange transport (see
[`../slack-exchange/`](../slack-exchange/) for the design). The older
file-based `export` / `load` commands still work and are covered in
their command help (`jseeqret export --help`).
