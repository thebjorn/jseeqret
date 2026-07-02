# Lessons

## Onboarding: wizard unmounted itself; GUI flows need lifecycle state (2026-07)

- **Deriving "show the wizard" from `vault_status.initialized` was a
  self-defeating condition:** the wizard's own first step creates the
  vault, flipping `initialized` true, which unmounted the wizard before
  the Slack/introduce steps could ever render. Every wizard step past
  "create" was dead code in production, so the v2.2.0 introduce-email fix
  changed nothing for a real fresh install. Multi-step GUI flows that
  *cause* the condition they're gated on need their own persisted
  lifecycle flag (here: `onboard.wizard` in the vault kv), cleared
  explicitly on finish/skip.

- **First-run paths only manifest on genuinely fresh machines.** Dev
  machines always have a vault + registry default, and core tests drive
  components in isolation, so nothing exercised the App.svelte mount
  condition across the create transition. Windows Sandbox was the first
  real fresh environment — and it failed for a reason no test could see.

- **A packaged Electron app with zero file logging is undebuggable in the
  field.** `console.error` in the main process goes nowhere without a
  console. Added `src/main/logger.js` + a `handle()` wrapper so every IPC
  failure lands in `%APPDATA%\jseeqret\logs\main.log` with its channel
  name; never log payloads/tokens/keys.

- **Results collected into a `warnings` array are silent failures unless
  something renders them.** `onboard_provision_poll` faithfully returned
  per-envelope import errors; the wizard never read them, so a failed
  provisioning spun forever. When adding a warnings channel, grep every
  caller for who displays it.

## Onboarding: identity divergence + tests that mask it (2026-07)

- **A fresh vault's self-identity is `user@host` with a placeholder email,
  NOT the invited email.** The new-user wizard auto-creates the vault via
  `vaults:create`, which sets `email = qualified_user()` (e.g.
  `WDAGUtilityAccount@<host>`). The TL matches introductions to invites by
  the **invited email** (`onboard_poll` → `onboarding_get(payload.email)`),
  so the introduction MUST carry the invited email (from the received
  invite), not `self.email`. Fixed by threading `invite.email` through
  `onboard_join` (core + `onboard:join` IPC + wizard + CLI).

- **Onboarding tests set the new user's vault email == the invited email**
  (`user_self` email `newbie@test.com`, invited as `newbie@test.com`), so
  the whole `self.email`-vs-invited-email divergence was invisible to a green
  suite. When a value can legitimately differ between two actors, give them
  DIFFERENT values in the fixture or the test proves nothing. Added a
  regression test with a diverged `user@host` identity.

- **Don't over-index on the first plausible root cause.** I had a detailed
  `files.uploadV2` share-ts theory ready to patch before the user's Slack
  screenshot showed the invite (mention + blob) was posted fine — the real
  blocker was the identity mismatch. Confirm the symptom against real
  evidence before editing security-sensitive transport code.

- **`onboard_invite` blocked all resends.** The guard refused any non-
  terminal row, so a stuck `invited` row could not be re-sent for 7 days.
  `invited` has nothing captured yet (unlike `introduced`+), so resend is
  safe there; relaxed the guard and added a GUI **Resend** action.

## Onboarding implementation (2026-06)

- **`process.exit(1)` after sql.js is loaded crashes on Windows** with a
  libuv assertion (`UV_HANDLE_CLOSING`, `async.c:76`), turning a clean exit
  1 into 0xC0000409. CLI error paths must use `process.exitCode = 1` and
  return (let the loop drain) instead of `process.exit()`. Commands that
  exit naturally (no `process.exit`) are fine. Keep `process.exit(0)` only
  where a live undici/Slack agent would otherwise keep the loop alive.

- **vitest globs `.claude/worktrees/`.** Agent worktrees are separate
  checkouts on other branches; their (possibly mid-migration) test copies
  fail the suite. `vitest.config.js` excludes `**/.claude/**`. A failure
  whose path contains `.claude/worktrees/` is NOT this project.

- **Bumping the DB schema breaks tests that hardcode the latest version.**
  Adding migration v004 broke `migrations-extra.test.js` assertions of
  `toBe(3)`. Grep tests for the old version number when adding a migration.

- **The onboarding table needs `pubkey`, not just `fingerprint`.** The plan
  stored only the captured fingerprint "to survive Slack retention," but
  approve also needs the user's pubkey to add them — so it must be captured
  locally too. Added a `pubkey` column.

- **Trust gate authenticates on the FULL pubkey, not the 5-char
  fingerprint.** First cut gated imports on `fingerprint(from_pubkey) ===
  trusted_fingerprint`. The fingerprint is only 20 bits, and the attacker
  controls both the ciphertext AND `from_pubkey`, so they could grind ~2^20
  keypairs to a fingerprint collision and forge teammate keys/secrets (NaCl
  Box doesn't help when the attacker also supplies the sender key). Fix:
  decrypt with the OOB-anchored **full TL pubkey** (`trusted_pubkey`, stored
  at join) as the Box sender — Box.open then needs the real TL private key.
  The fingerprint stays ONLY as the human OOB display value, recomputed from
  the pubkey we actually anchor. **Lesson: never use a truncated hash as an
  authentication primitive when the verifier also controls the input.**

- **A plaintext ack can't be trusted just because a `from_pubkey` field
  says so.** The `complete` ack now carries a NaCl-Box proof decrypted with
  the trusted pubkey; a plaintext-only complete is ignored (it can't strand
  the wizard).

- **The gate is enforced in core** (`onboard_approve` re-validates the
  verification flag + fingerprint; `import_*` require the trusted pubkey),
  not just the GUI checkbox.

- **Adversarial review caught the above.** Tests passing ≠ correct: a
  fan-out review (find → verify) surfaced a real high-severity auth flaw the
  green suite missed. Run it on security-sensitive code.
