# GUI fixes

- [x] delete and edit users
- [x] export should go through slack
- [x] export should be able to select multiple users
- [x] the follow-ups in todo.md
- [x] the TL needs to see their own fingerprint during onboarding
- [x] new users should send introductions to slack, other users must actively accept them
- [x] there is a name field in the user profile, but it is not filled during onboarding
- [x] export should be able to select names, not user records. export should then go to all users with those names
- [x] on the dashboard, clicking on the secrets/users/vault owner "buttons" should take you to the respective page
- [x] text contrast could generally be a little better
- [x] go throught the UI and find opportunities for improvements, missing functionality, and bugs - then fix them.

## Plan (2026-07-02)

Grouped so core/IPC foundations land first, then the GUI, then a sweep.
Tests cover core per CLAUDE.md; IPC/GUI stay thin wrappers.

### A. Users: edit + delete (issue 1)

- [x] Core: `SqliteStorage.update_user(username, fields)` — partial update
      of name/email/pubkey; when pubkey changes, clear the slack binding
      (slack_key_fingerprint/slack_verified_at no longer hold). Tests.
- [x] IPC `users:update`, `users:remove` (+ preload). Guard: refuse to
      remove or re-key the vault owner (id=1 / fetch_admin).
- [x] GUI UserList: actions column — Edit (dialog: name/email/pubkey with
      re-key warning), Delete (confirm). Owner row badged, not deletable.

### B. Onboarding fills the name field (issue 7)

- [x] Wizard create step gains a "Your name" input; `vaults:create`
      accepts `{ name }` and stamps it on the owner row after migrations.
- [x] `onboard_join` introduction payload carries `name: self.name`;
      TL's `onboard_poll` captures it (invite-provided name wins). Tests.
- [x] `vault:introduction` returns `name` + fingerprint already there.

### C. Export rework (issues 2, 3, 8 + broken Save File)

- [x] IPC `secrets:export` accepts `to: string[]`; returns per-recipient
      outputs. Selection in GUI is by *display name*; each name fans out
      to every user record sharing it.
- [x] IPC `secrets:export-save`: real file save via dialog (single file,
      or one file per recipient in a chosen directory). The old "Save
      File" mode only previewed — never wrote a file.
- [x] IPC `secrets:send-slack`: json-crypt blob per recipient over the
      existing transport (`send_blob`), gated on `require_verified_binding`
      + slack preflight, recipient resolved by email (same as CLI `send`).
- [x] GUI ExportView: name-grouped multi-select recipients; output modes
      Clipboard | Save file | Slack (slack forces json-crypt; clipboard
      limited to a single recipient record); per-recipient result list.

### D. TL sees own fingerprint (issue 5)

- [x] OnboardingView: persistent "your fingerprint" card (big, mono) fed
      by `vault:introduction`.
- [x] ApproveDialog: also show the TL's own fingerprint (read aloud on
      the same call).

### E. Introductions inbox — active accept (issue 6)

New teammates already introduce themselves over Slack; at approval the
TL relays the newcomer's record to every existing teammate as a
`user_list` envelope. Nothing consumed those broadcasts. Now:

- [x] Core `inbox_introductions()`: poll `user_list` envelopes addressed
      to me WITHOUT importing; decrypt with the OOB-anchored TL pubkey
      when it matches (vouched), else with the self-reported from_pubkey
      for display only (unvouched, must be fingerprint-verified by the
      human). Skip lists whose users are all already in the vault. Tests.
- [x] Core `accept_introduction()`: import gate — vouched path requires
      the trusted pubkey; unvouched path requires explicit verified flag
      + typed fingerprint of the sender key. Delete thread best-effort.
      Tests incl. forged-sender rejection.
- [x] IPC `onboard:inbox` / `onboard:accept` + preload.
- [x] GUI Users view: "Pending introductions" section with Accept
      (vouched: one click; unvouched: verify dialog) + Dismiss.

### F. Follow-ups from todo.md (issue 4)

- [x] Sender-side envelope cleanup: `onboard_approve` records the
      file/reply ids of the envelopes it sent TO THE NEW USER in the kv
      (`onboard.sent.<email>`). New `received` envelope kind: the user
      posts it (with a NaCl-Box proof) after provisioning completes;
      `onboard_poll` verifies the proof and deletes the TL's own
      provisioning messages. Receiver-side delete stays best-effort.
- [x] Provision-poll cursor: `onboard:provision-poll` (and CLI receive)
      keep `slack.onboard_user_last_seen_ts`, advanced only when a poll
      produced no warnings — old/broken envelopes stop being re-scanned
      from oldest=0 forever, without ever skipping a failed import.
- [x] Transport self-test: core `transport_selftest()` — send a
      `selftest` envelope to self, assert the poller matches it (thread
      structure), delete it. CLI `slack doctor --transport`; GUI button
      on SlackStatusCard.

### G. Dashboard navigation (issue 9)

- [x] Stat cards become buttons: secrets → Secrets, users → Users,
      owner → Introduction.

### H. Contrast (issue 10)

- [x] main.css: raise `--text` / `--text-muted` (muted was ~4:1 on
      inputs), lift placeholder/hint opacities, add a readable danger
      text color for alerts (accent red on dark bg is ~4.4:1).

### I. UI sweep (issue 11)

- [x] Sweep done (review agents hit the session token limit, so the
      sweep was completed manually over every renderer component + the
      new IPC surface). Fixed:
      - Export "Save File" never wrote a file (only previewed) → real
        save dialogs (single file, or per-recipient files in a chosen
        directory).
      - Platform toggle shown for serializers it cannot affect → only
        rendered for env/command output.
      - SecretList reveal/copy keyed by *filtered row index* → after a
        re-filter/sort the wrong secret could be revealed/copied. Now
        keyed by app:env:key; rows got stable #each keys.
      - No way to add a user from the GUI although users:add existed →
        Add-user form on the Users view.
      - IntroductionView omitted the display name and fingerprint; the
        onboarding command now includes --name.
      - StatusBar.svelte was dead code (imported nowhere) → deleted.
      - VaultSwitcher swallowed every error into console.error
        (invisible in a packaged app) → errors surface in the dropdown;
        unregister now confirms (registry-only, no files deleted).
      - Svelte autofixer run on the rewritten UserList: no issues.

### Verification (2026-07-02)

- [x] pnpm test — 444 passing / 5 skipped, 46 files (27 new tests in
      tests/onboarding-inbox.test.js: name threading, inbox/accept incl.
      forged-sender rejection, received-ack cleanup incl. forged-ack and
      missing-key paths, transport selftest, stale-ts cursor support,
      SqliteStorage.update_user incl. binding invalidation).
- [x] pnpm build — main/preload/renderer compile clean.
- [x] CLI smoke: `slack doctor --transport --help`, `onboard receive
      --help` load; cli-onboard/cli-slack-doctor black-box suites green.

### Review

**Status: implemented, tested, swept — uncommitted (2026-07-02).**

Design notes:
- Issue 6 interpretation: the newcomer already introduces themselves
  over Slack during onboarding; at approval the TL relays the vouched
  record to each teammate (this existed but was never consumed). The
  "actively accept" half is new: a pending-introductions inbox on the
  Users page; import happens only on Accept, re-validated in core
  (vouched = Box opens with the OOB-anchored TL key; otherwise the
  full fingerprint ceremony). A direct newcomer→teammate broadcast was
  rejected: teammates have no trust anchor for an unknown sender, so
  TL-vouching is the sound path and unvouched senders fall back to the
  human fingerprint check.
- Sender-side cleanup needed a new `received` envelope kind. Forgery is
  blocked by a NaCl-Box proof verified against the pubkey captured at
  introduction time; an unverifiable ack is reported and left alone.
- Cursor safety: stale_ts only ever covers messages older than 15 min
  (a settling mention lands in seconds), and the user-side cursor never
  advances across a sweep that produced warnings (fail-closed).
- Python seeqret mirror: none of this changes the DB schema or the
  secret/user wire formats. The introduction payload gained an optional
  `name` field and there are two new envelope kinds (`received`,
  `selftest`) — pythons-side support can be added later; unknown kinds
  are skipped by both pollers.
