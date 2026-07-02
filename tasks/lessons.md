# Lessons

## electron-vite: the word import + apostrophe in a comment breaks the build (2026-07)

- A doc comment saying "an import's carried timestamp" made
  `pnpm build` fail with "Unterminated string literal" deep in the
  bundled chunk. electron-vite's `vite:esm-shim` plugin finds the LAST
  ESM import statement with a regex (mlly-style) and appends its
  CommonJS shim right after it; `import's ...` parses as
  `import '<specifier>'` whose specifier swallows everything (newlines
  included) up to the next single quote — a SQL string two functions
  later — so the shim was spliced into the middle of that string.
- Symptoms that identify it: per-file esbuild/node parses are clean,
  an esbuild --bundle of the same entry works, only the electron-vite
  main/preload chunk fails, and the error frame shows
  `// -- CommonJS Shims --` right after the "unterminated" line.
- Fix/rule: in files bundled for main/preload, never write the word
  import directly followed by an apostrophe in comments or strings.
  Debug trick that found it: a one-off `renderChunk` dump plugin in
  electron.vite.config to capture the chunk between plugins.

## Onboarding import skipped the slack-binding stamp (2026-07)

- A freshly provisioned vault could not send BACK to any teammate over
  Slack: `require_verified_binding` refused with "not linked". The TL
  side stamps the binding at approve, but `import_user_list` /
  `accept_introduction` added users WITHOUT it — even though the list
  arrived Box-authenticated by the voice-call-verified TL key, i.e.
  with exactly the assurance `slack link` records. Asymmetry between
  the two sides of a handshake is a smell: whatever trust artifact one
  side records, check whether the mirror-image flow needs it too.
- Found in the field (sandbox export), not by tests: every slack-send
  test used the TL vault, where approve had stamped bindings. Exercise
  the PROVISIONED vault as a sender, not only as a receiver.

## CSS: descendant selectors leak into nested widgets (2026-07)

- ExportView's generic `.form-group label { display: block;
  text-transform: uppercase; ... }` and `.form-group input { width:
  100% }` captured the NESTED `.recipient` checkbox labels too: block
  display broke their flex row (checkbox on its own line), names came
  out uppercase/muted, checkboxes stretched full-width. Shipped in
  v2.4.0; user screenshot caught it.
- When a form container styles `label`/`input` generically, scope with
  a child combinator (`.form-group > label`) the moment the group can
  contain composite widgets — or the widget silently inherits layout.
- Checking a new component in isolation isn't enough: eyeball each
  VARIANT of the container it sits in (a checkbox list inside
  .form-group looked fine in the code, wrong on screen).

## Slack transport: the mock's one behavioral lie hid a total failure (2026-07)

- `files.uploadV2` shares the file into the channel ASYNCHRONOUSLY —
  the response usually has empty `shares`, and `file.timestamp` is a
  creation time, not a message ts. The fallback to it anchored the
  recipient mention outside the file's thread, so `poll_inbox` (which
  matches mentions among the file message's replies) matched NOTHING
  over real Slack, in both directions. Every onboarding envelope was
  invisible; rows sat at `invited` forever.
- `tests/slack-mock.js` returns a proper share ts synchronously — the
  one place the mock diverges from real Slack is exactly where the bug
  lived. 400+ green tests proved the protocol, not the transport. For
  code that talks to an external service, run at least one self-cleaning
  integration check against the real service (see the transport
  self-test pattern: send to self, assert thread structure + poll match,
  delete_thread).
- Reading the actual channel (Slack MCP) found it in minutes: the
  mention messages were visibly top-level with ts ~0.7s BEFORE their
  file messages. Look at the real artifacts, not just the code.

## Code signing: "Successfully signed" says nothing about WHO signed (2026-07)

- `signtool sign /a` (auto-select) picked a stray self-signed
  `trust_<guid>` cert from the store instead of the Sectigo EV token
  cert — no PIN prompt, exit 0, "Successfully signed", and an untrusted
  installer went onto the v2.3.0 release before the missing PIN prompt
  raised suspicion. The signer identity was printed right there in the
  output ("Issued to: trust_59d2…") and I didn't read it.
- Fixes: sign.js pins subject+issuer (`/n 'Norsk Test as' /i Sectigo`)
  and runs `signtool verify /pa` after every sign (untrusted chain =
  build failure). Release skill now requires checking
  `Get-AuthenticodeSignature` status + signer CN before upload.
- General pattern: when a tool selects a credential/key implicitly,
  verify WHICH one it selected, not just that the operation succeeded.
  Absence of an expected interactive prompt (PIN, 2FA) is a red flag,
  not a convenience.

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
