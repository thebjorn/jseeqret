# Lessons

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
