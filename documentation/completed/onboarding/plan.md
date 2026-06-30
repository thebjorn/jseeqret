# Onboarding Implementation Plan (GUI-first)

Implementation plan for the automated user-onboarding flow sketched in
[`index.md`](index.md). This plan turns the 16-step sequence diagram into a
buildable feature grounded in the current codebase, **driven from the
Electron GUI as a wizard for novice users**. The CLI `onboard` commands are
the underlying primitives that power the same flow for power users and
automation; the GUI is the default front door.

## Implementation status

**Implemented end to end (2026-06-29, commit `91211a5`).** All 9 phases
shipped; `pnpm test` green (361 passing), `pnpm build` clean. Core is fully
unit-tested through an in-memory mock Slack workspace (`tests/slack-mock.js`,
`tests/onboarding*.test.js`).

What was built, by file:

| Concern | Landed in |
| ------- | --------- |
| Typed envelopes | `src/core/serializers/envelope.js`; `transport.send_payload`/`poll_envelopes` |
| User payload | `src/core/serializers/user-list.js` |
| Onboarding state | migration **v004** (`src/core/migrations.js`) + `SqliteStorage` CRUD |
| Slack session over IPC | `src/core/slack/session.js` (shared by CLI + IPC) + `slack:*` handlers |
| Orchestration | `src/core/onboarding.js` (`onboard_invite/poll/approve/join/receive_invite/provision_poll`, import gates, `expire_stale`, trust context) |
| GUI | `OnboardingWizard`, `OnboardingView`, `ApproveDialog`, `SlackStatusCard` + `onboard:*` IPC + preload |
| CLI | `src/cli/commands/onboard.js` (`invite/status/watch/join/receive/approve`) |

Deviations from this plan, as built (kept faithful to its intent):

1. **Trust gate authenticates on the FULL TL pubkey, not the 5-char
   fingerprint.** An adversarial review found that gating on the 20-bit
   fingerprint is forgeable: the attacker controls the envelope's
   `from_pubkey`, so they can grind an offline collision and NaCl Box would
   still "authenticate" them. Imports now decrypt with the out-of-band-
   anchored full TL pubkey (`trusted_pubkey`); the fingerprint is only the
   human voice-call display, recomputed from that pubkey at join. The
   `complete` ack carries a NaCl-Box proof rather than a plaintext flag.
2. **The `onboarding` table has an extra `pubkey` column** beyond the schema
   below: approve needs the user's pubkey, and it must survive Slack's 24h
   retention exactly like the captured fingerprint.
3. **Added an `invite` envelope kind** (steps 1-4) so the new user discovers
   the TL's Slack id + pubkey/fingerprint, and an **`onboard receive`** CLI
   subcommand alongside `join` for the import step.
4. **The TL watch loop is renderer-polled** (`onboard:poll` on an interval)
   rather than a background tray poller (resolved question 3's tray option is
   deferred; CLI `onboard watch` covers the headless case).
5. **The GUI migrates the active vault on startup and on switch**, so vaults
   that predate a migration (e.g. v004) gain new tables — previously only CLI
   `slack login` ran `upgrade_db`.

## TL;DR

- Onboarding is **a GUI experience layered on the existing Slack exchange
  transport** ([`../slack-exchange/index.md`](../slack-exchange/index.md)),
  which is already implemented (`send`/`receive --via slack` work today).
- The GUI is two guided surfaces: a **Team Lead panel** (invite form +
  in-flight onboarding list + Approve dialog) and a **new-user first-run
  wizard** (install -> auto-init -> slack login -> wait -> done). Both call
  the **same core primitives** in `src/core/`.
- What is missing is everything *above* the transport: an invite concept,
  typed message envelopes, the ability to ship **users** (not just secrets)
  over the pipe, a **project** scoping concept, a persisted **onboarding
  state machine**, and the IPC + Svelte surface that exposes all of it.
- **One security decision dominates the design:** the diagram as drawn
  auto-trusts a public key that arrives over Slack. That contradicts the
  cornerstone rule in [`../user-guide/admin-guide.md`](../../user-guide/admin-guide.md)
  and [`../user-guide/end-user.md`](../../user-guide/end-user.md) ("never accept
  a fingerprint that came over Slack"). The flow must keep **exactly one
  irreducible out-of-band fingerprint check** per onboarding. The GUI makes
  that check *easier* but never *automatic*. See [Trust model](#trust-model).

## Architecture: where the work lands

The project is a strict three-layer design (see
[`../../CLAUDE.md`](../../CLAUDE.md)): all business logic lives in
`src/core/`, the Electron main process exposes it over IPC
([`../../src/main/ipc-handlers.js`](../../src/main/ipc-handlers.js)), the
preload bridge re-exports each handler as a `window.api.*` method
([`../../src/preload/index.js`](../../src/preload/index.js)), and the Svelte
5 renderer ([`../../src/renderer/`](../../src/renderer/)) calls those methods
from screens wired into the sidebar navigation.

**No business logic in the renderer.** Every onboarding action is a core
primitive, surfaced once over IPC, and consumed by both the GUI and the thin
CLI wrappers. Concretely, each phase below describes three coordinated parts:

| Layer | Pattern in this codebase |
| ----- | ------------------------ |
| Core primitive | A function/class in `src/core/` (e.g. `transport.js`, a new serializer, `sqlite-storage.js`) |
| IPC + bridge | `ipcMain.handle('onboard:<verb>', ...)` in [`ipc-handlers.js`](../../src/main/ipc-handlers.js); one `window.api.onboard<Verb>()` line in [`index.js`](../../src/preload/index.js) |
| Svelte screen | A `*.svelte` view in [`src/renderer/src/lib/components/`](../../src/renderer/src/lib/components/), registered in the `nav_items` list in [`Sidebar.svelte`](../../src/renderer/src/lib/components/Sidebar.svelte) and the `view` switch in [`App.svelte`](../../src/renderer/src/App.svelte), using runes (`$state`, `$effect`, `$props`) |
| CLI wrapper | A subcommand in `src/cli/commands/onboard.js` calling the **same** core primitive |

The renderer already follows this shape: see
[`IntroductionView.svelte`](../../src/renderer/src/lib/components/IntroductionView.svelte),
which renders identity from `window.api.getIntroduction()` (backed by the
`vault:introduction` handler). The onboarding screens extend that pattern.

## Current state (what exists vs. what is missing)

Grounded in a read of the CLI, `src/core/slack/`, and the GUI surface:

| Capability | Status | Evidence |
| ---------- | ------ | -------- |
| Send/receive **secrets** via Slack | done | `send.js`, `receive.js`, `transport.js:34-143` |
| OAuth login, channel pick, `doctor`, `link`, `status` (CLI) | done | `slack.js` |
| Fingerprint-verified handle binding (CLI) | done | `slack.js link`, `identity.js` |
| GUI vault create / switch / status | done | `vaults:create`, `vaults:switch`, `vault:status` in [`ipc-handlers.js`](../../src/main/ipc-handlers.js) |
| GUI introduction (print-only) | partial | [`IntroductionView.svelte`](../../src/renderer/src/lib/components/IntroductionView.svelte) builds an `add user` command string; it does **not** post to Slack |
| Slack login / doctor / link **over IPC** | missing | no `slack:*` handlers in [`ipc-handlers.js`](../../src/main/ipc-handlers.js) yet |
| **Invite** command / panel (steps 1-4) | missing | no invite anywhere |
| Poll for **user acceptance** (steps 5, 10) | missing | polling exists for secret blobs only (`transport.js:96-143`) |
| Send/receive **users** over the pipe (steps 12-13) | missing | `json-crypt.js` serializes `Secret` only |
| **Project** scoping (steps 1, 11) | missing | no project field on `User` or `Secret` |
| **Typed envelopes** (intro / users / secrets / ack) | missing | transport assumes one implicit "secret blob" type |
| Persisted **onboarding state** | missing | only `slack.last_seen_ts` is tracked |

Conclusion: the transport substrate is solid and the GUI scaffold (vault
lifecycle, IPC bridge, view router) already exists. This plan builds the
orchestration layer, the typed-payload extensions it needs, and the IPC +
Svelte surface that turns it into a wizard.

## Trust model

This is the decision the diagram skips, and it shapes every later phase. The
GUI does **not** relax it.

In the drawn flow, `uVault` posts its public key to Slack (step 7),
`tlVault` adds the user (step 11), then `tlVault` ships every teammate's
public key to `uVault` (steps 12-13). Slack is explicitly the **untrusted
pipe**. If we auto-import either of those key sets, a compromised Slack
account can inject a forged key and we have rebuilt exactly the attack the
fingerprint dance defends against.

**Model: the Team Lead is the trust root, bootstrapped by one mutual
out-of-band check.**

1. **One voice call, two fingerprints.** During invite/introduction, the TL
   and the new user verify each other's five-character fingerprints
   out-of-band (the existing `slack link` ceremony, made mutual). This is the
   *only* human verification step and it cannot be automated away without
   weakening the threat model.
2. **After that, `tlVault` is the introducer (CA).** NaCl Box authenticates
   the sender, so once `uVault` knows the TL's verified public key, every
   `user_list` and `secret_batch` it later receives is provably from the TL.
   `uVault` accepts those teammate keys **on the TL's authority** (transitive
   trust), not on Slack's.
3. **`tlVault` adds the new user only after the TL confirms the user's
   fingerprint** (step 11 becomes an explicit Approve gate, not an auto-add).

### How the GUI enforces the gate (and how it must NOT cheat)

The Approve dialog is where this rule lives in the GUI. It MUST:

- Show the captured five-character fingerprint **big and unmissable** (the
  fingerprint was decrypted and stored locally at receive time, not read live
  off a Slack message).
- Require an explicit **"I verified this fingerprint on a voice call"
  checkbox**, defaulting to unchecked.
- Keep the **Approve button disabled** until the checkbox is ticked (and,
  optionally, until the TL types the fingerprint back, mirroring `slack
  link`).
- **Never auto-trust** a key just because it arrived over Slack. The GUI is
  allowed to *display* and *pre-fill* the fingerprint to remove friction; it
  is **not** allowed to treat Slack delivery as verification.

Net effect: step 11's "add user to vault" is **semi-automated** -- the
machinery is automatic, but it pauses on a single human fingerprint
confirmation that the GUI surfaces as an explicit, hard-to-skip gate. This
keeps the flow consistent with security concern #4 in
[`../slack-exchange/security-concerns.md`](../slack-exchange/security-concerns.md)
and the rule stated in both user guides.

## Design decisions

These carry over from the original plan unchanged; the GUI consumes them.

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| "Project" representation | Reuse the existing `app` dimension: a project is a `FilterSpec` like `myapp:*:*` stored per invitee | Zero schema churn on `Secret`; `FilterSpec` already does glob matching ([`filter.js`](../../src/core/filter.js)) |
| Payload typing | Add a `kind` discriminator to the encrypted JSON payload; absent `kind` => legacy `secret` | Backward compatible with blobs already in flight |
| Message kinds | `introduction`, `user_list`, `secret_batch`, `complete` (ack) | Covers steps 7-16; `secret_batch` reuses today's secret path |
| User transport | New serializer for `User` records, sent as a `user_list` envelope | Parallels [`json-crypt.js`](../../src/core/serializers/) for secrets |
| Onboarding state | New `onboarding` table + `SqliteStorage` CRUD | Survives 24 h Slack retention (see [Risks](#risks)) |
| Token bootstrap | New user completes `slack login` (OAuth) **inside the GUI wizard** before they can be provisioned; the invite spells this out | The vault has no Slack token until the user authenticates |
| Identity | Vaults produce `user@host` qualified identities via `qualified_user()` (see [Dependency](#dependency-qualified-identity)) | GUI- and CLI-created vaults must address the same users |

## Phased build

Each phase is independently testable. Core primitives land first (they are
what tests cover, per [`../../CLAUDE.md`](../../CLAUDE.md)); the IPC bridge
and Svelte screen land on top in the same phase so the feature is usable end
to end as it grows. The CLI subcommands are thin wrappers added alongside.

### Phase 1 -- Typed envelopes (core)

- **Core:** introduce an envelope wrapper around the encrypted JSON payload
  with a `kind` field, defaulting to `secret` when absent. Generalize
  [`transport.js`](../../src/core/slack/transport.js):
  `send_payload(kind, obj, recipient)` and a `poll_inbox` that yields
  `{ kind, payload, sender_user_id, ... }`.
- **Files:** [`src/core/slack/transport.js`](../../src/core/slack/transport.js),
  [`src/core/serializers/`](../../src/core/serializers/) (envelope helper).
  Keep `json-crypt.js` as the `secret` codec.
- **IPC/GUI:** none yet -- pure transport plumbing.
- **Tests:** round-trip each kind through a mock client; a legacy untyped
  blob still decodes as `secret`.

### Phase 2 -- User payload (core)

- **Core:** add a `User` serializer (encrypt/decrypt a list of
  `{ username, email, pubkey }` for a recipient pubkey).
  `transport.send_users(users, to)` and a receive-side import via
  `storage.add_user(...)`, **gated on the sender being the verified TL key**
  (trust model rule 2).
- **Files:** [`src/core/serializers/`](../../src/core/serializers/) (new),
  [`src/core/slack/transport.js`](../../src/core/slack/transport.js),
  [`src/core/models/user.js`](../../src/core/models/user.js) (no schema
  change expected).
- **IPC/GUI:** none yet -- consumed later by the wizard's provisioning step.
- **Tests:** import accepted from a known/verified sender; rejected from an
  unknown sender.

### Phase 3 -- Onboarding state (core)

- **Core:** migration adds an `onboarding` table:

  ```sql
  CREATE TABLE IF NOT EXISTS onboarding (
      email            TEXT PRIMARY KEY,
      username         TEXT,
      slack_handle     TEXT,
      slack_user_id    TEXT,
      project_filter   TEXT,            -- e.g. 'myapp:*:*'
      fingerprint      TEXT,            -- captured from introduction
      state            TEXT NOT NULL,   -- see state machine below
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
  );
  ```

- **States:** `invited -> introduced -> approved -> provisioned -> complete`
  (plus `expired`).
- **Core CRUD:** `onboarding_create`, `onboarding_get`,
  `onboarding_set_state`, `onboarding_list` on `SqliteStorage`.
- **Files:** [`src/core/migrations.js`](../../src/core/migrations.js),
  [`src/core/sqlite-storage.js`](../../src/core/sqlite-storage.js).
- **IPC/GUI:** none yet -- this is the data the TL panel will list.
- **Tests:** state transitions, list/filter, expiry.

### Phase 4 -- Slack session over IPC (GUI bridge)

The GUI cannot drive onboarding until the existing Slack primitives are
reachable from the renderer. Today `login`/`doctor`/`link`/`status` exist
only in the CLI ([`slack.js`](../../src/cli/commands/slack.js)).

- **Core:** already exists -- reuse the Slack session helpers behind the CLI
  commands; no new business logic.
- **IPC:** add `slack:login`, `slack:doctor`, `slack:link`, `slack:status`
  handlers to [`ipc-handlers.js`](../../src/main/ipc-handlers.js). `login`
  runs the loopback-OAuth flow in the main process and resolves once the
  token is stored; the channel picker is surfaced as IPC return data the
  renderer renders.
- **Bridge:** add `slackLogin`, `slackDoctor`, `slackLink`, `slackStatus` to
  [`index.js`](../../src/preload/index.js).
- **GUI:** a small reusable `SlackStatusCard.svelte` (login button, channel
  picker, doctor traffic-light) used by both the TL panel and the wizard.
- **Tests:** core session helpers already covered; add a smoke test that the
  handlers call through to the same primitives the CLI uses.

### Phase 5 -- Team Lead panel (GUI) + invite/watch primitives

The TL experience is a single GUI panel, `OnboardingView.svelte`, added to
the sidebar. It has three regions.

- **Invite form:** email + project (`FilterSpec`) + optional display name.
  Submitting records an `invited` row, posts the invite + download link to
  `#seeqrets`, and shows the TL's own fingerprint to read on the voice call.
- **In-flight list:** the `onboarding` rows with a per-user state badge
  (`invited`/`introduced`/`approved`/`provisioned`/`complete`/`expired`),
  refreshed from the watch loop.
- **Approve action:** opens the Approve dialog (next phase). Disabled until
  the row reaches `introduced`.

Backing this:

- **Core:** `onboard_invite(email, project, name)` and `onboard_watch()`
  (long-poll for `introduction` envelopes; on arrival, decrypt and **store
  the fingerprint into the `onboarding` row immediately** so approval
  survives Slack retention, then move the row to `introduced`).
- **IPC:** `onboard:invite`, `onboard:list`, `onboard:watch`/`onboard:poll`
  in [`ipc-handlers.js`](../../src/main/ipc-handlers.js). The watch loop runs
  in the main process and pushes state to the renderer via an
  `ipcRenderer.on('onboard:update', ...)` subscription, mirroring the
  existing `update:status` pattern in
  [`index.js`](../../src/preload/index.js) / [`Sidebar.svelte`](../../src/renderer/src/lib/components/Sidebar.svelte).
- **Bridge:** `onboardInvite`, `onboardList`, `onOnboardUpdate(cb)`.
- **GUI:** `OnboardingView.svelte` (registered in `nav_items` in
  [`Sidebar.svelte`](../../src/renderer/src/lib/components/Sidebar.svelte)
  and the `view` switch in [`App.svelte`](../../src/renderer/src/App.svelte)).
- **CLI wrappers:** `jseeqret onboard invite --email <e> --project <filter>
  [--name <n>]`, `jseeqret onboard status`, `jseeqret onboard watch` --
  thin calls onto the same `onboard_invite` / `onboard_watch` primitives.
- **Tests (core):** invite persists + posts; watch promotes
  `invited -> introduced` and captures the fingerprint.

### Phase 6 -- New-user first-run wizard (GUI) + join primitive

The new user never types a command. On first launch into an uninitialized
vault, [`App.svelte`](../../src/renderer/src/App.svelte) currently shows a
"Vault not initialized" panel telling the user to use the CLI; this phase
replaces that with a **first-run wizard**, `OnboardingWizard.svelte`, with
clear steps:

1. **Install** (already done -- the wizard is running).
2. **Auto-init:** create the vault with one click via `vaults:create`
   ([`ipc-handlers.js`](../../src/main/ipc-handlers.js)); the user picks a
   directory, nothing else. The vault's identity is `user@host` (see
   [Dependency](#dependency-qualified-identity)).
3. **Slack login (OAuth):** the `SlackStatusCard` from Phase 4; the wizard
   blocks here until a token exists and `#seeqrets` is picked.
4. **Introduce + wait:** post the `introduction` envelope (pubkey +
   fingerprint), show the user **their own fingerprint big** to read on the
   voice call, and display a calm "Waiting to be approved by your team lead"
   state while polling.
5. **Secrets arrive:** import `user_list` then `secret_batch` (gated on the
   TL's verified key, trust rule 2); show a progress line.
6. **Done:** on the `complete` ack, show "You're set up" and drop the user
   into the normal dashboard.

Backing this:

- **Core:** `onboard_join()` -- after Slack login, post the `introduction`
  envelope (step 7), then poll for `user_list` + `secret_batch` and import
  them (steps 13, 15); detect the `complete` ack (step 16, user side).
- **IPC:** `onboard:join`, `onboard:wizard-state` (or reuse
  `onboard:poll`); push provisioning progress to the renderer over the same
  `onboard:update` subscription.
- **Bridge:** `onboardJoin`, `onOnboardUpdate(cb)` (shared with Phase 5).
- **GUI:** `OnboardingWizard.svelte`, shown by
  [`App.svelte`](../../src/renderer/src/App.svelte) when
  `vault_status.initialized` is false (or when no Slack session exists yet).
  Keep [`IntroductionView.svelte`](../../src/renderer/src/lib/components/IntroductionView.svelte)'s
  print-only command path available for the manual flow in the admin guide.
- **CLI wrapper:** `jseeqret onboard join` -- same `onboard_join` primitive.
- **Tests (core):** introduction posts the right envelope; provisioning
  import is idempotent.

### Phase 7 -- Approve + provision (GUI dialog) with the fingerprint gate

This is the security heart of the GUI. The Approve dialog is opened from the
TL panel's in-flight list.

- **GUI dialog (`ApproveDialog.svelte`):**
  1. Shows the captured fingerprint **big** (from the local `onboarding`
     row, not from Slack).
  2. Requires the **"I verified this on a voice call" checkbox** (and
     optionally a fingerprint type-back, mirroring `slack link`).
  3. Keeps **Approve disabled** until verified -- see [Trust model](#trust-model).
- **Core (`onboard_approve(email)`), steps 11-16:**
  1. Re-checks the captured fingerprint against the verification input.
  2. `add user` with the new user's pubkey + assigned `project_filter`.
  3. `send_users(...)` the current teammate list to `uVault` (steps 12-13).
  4. Broadcast the new user's record to existing teammates (a `user_list`
     carrying just the newcomer) so they can send to them -- see resolved
     question 1.
  5. `send_blob`/`secret_batch` the secrets matching `project_filter`
     (steps 14-15).
  6. Posts a `complete` ack and marks the row `complete`; the GUI shows the
     row transition and notifies the TL (step 16).
- **IPC:** `onboard:approve` in
  [`ipc-handlers.js`](../../src/main/ipc-handlers.js); **the verification
  flag is passed from the renderer but the core primitive re-validates** --
  the gate is enforced in core, the GUI checkbox is the UX, not the
  authority.
- **Bridge:** `onboardApprove({ email, verified, fingerprint })`.
- **CLI wrapper:** `jseeqret onboard approve <email>` -- prints the captured
  fingerprint and requires the TL to type it back after the voice call, then
  calls the same `onboard_approve` primitive.
- **Reuse:** [`add.js`](../../src/cli/commands/add.js) /
  `send.js` internals and the existing `users:add` / `secrets:export`
  handlers in [`ipc-handlers.js`](../../src/main/ipc-handlers.js).
- **Tests (core):** wrong/absent verification => refuse (in core, not just
  the UI); correct => user added, scoped secrets sent, state `complete`.

### Phase 8 -- Hardening

- Gate all `onboard` IPC handlers and CLI subcommands behind `slack doctor`
  (fail-closed, like `send`/`receive`). The GUI surfaces a doctor failure as
  a blocking banner in both the TL panel and the wizard.
- Reject introductions from unexpected handles; surface them in the in-flight
  list with a warning badge (and in `onboard status`).
- Invite/intro **expiry**: stale `invited`/`introduced` rows time out to
  `expired` so the TL is not asked to approve a ghost; the GUI greys them
  out.
- **Tests:** doctor-fail blocks onboarding; expiry transition.

### Phase 9 -- Tests + docs

- Unit tests (mock Slack client) for every new core path -- the GUI and CLI
  share these primitives, so core coverage covers both.
- End-to-end against the `ntseeqrets` workspace / `#seeqrets` channel: full
  TL <-> user onboarding through the GUI, including the wrong-fingerprint
  refusal and a retention-window expiry.
- Docs: update [`index.md`](index.md), the
  [admin](../../user-guide/admin-guide.md) /
  [end-user](../../user-guide/end-user.md) guides (add the GUI wizard path
  alongside the CLI path), and `tasks/lessons.md`.

## Dependency: qualified identity (landed)

This flow depends on the `user@host` qualified identity ported from the
Python `seeqret` repo (issue #25). **This dependency is now in place** in
jseeqret:

- [`src/core/vault.js`](../../src/core/vault.js) -- `hostname()` (short,
  lowercased) and `qualified_user()` (returns `{current_user()}@{hostname()}`).
- [`src/core/user-resolve.js`](../../src/core/user-resolve.js) --
  `resolve_user` (exact match, then a unique bare-name fallback, else an
  `AmbiguousUserError`/`UnknownUserError`), `fetch_self` (qualified identity
  first, bare username fallback for legacy vaults), and `resolve_recipients`
  (`self`/`all` expansion). Wired into `init`, `whoami`, `introduction`,
  `export`, `load`, and `slack link`/`send`.

Why it matters for onboarding: **GUI-created vaults must produce the same
identities as CLI-created ones.** The GUI's `vaults:create` handler in
[`ipc-handlers.js`](../../src/main/ipc-handlers.js) now mints the owner
identity with `qualified_user()` (it previously set a bare username with an
inline `` `${username}@${os.hostname()}` `` email), so a user introduced from
the wizard (Phase 6) addresses and resolves identically to one added from the
CLI by the TL (Phase 7). The onboarding `add user` / `introduction` steps can
therefore rely on a single canonical name per user.

## CLI primitives (still here for power users / automation)

The GUI is the default, but every action above remains a CLI command over
the **same core primitive**, for scripting, headless servers, and CI:

```
jseeqret onboard invite --email <e> --project <filter> [--name <n>]
jseeqret onboard status
jseeqret onboard watch
jseeqret onboard join
jseeqret onboard approve <email>
```

These are thin wrappers; they do not contain onboarding logic of their own.
Anything the wizard or TL panel can do, the CLI can do headlessly, and vice
versa.

## Risks

- **Retention vs. approval window.** Channel retention is 24 h
  (admin-guide section 1.4). The `introduction` blob can vanish before the TL
  approves. **Mitigation:** the watch loop (`onboard_watch`, Phase 5)
  decrypts and stores the fingerprint into the local `onboarding` row at
  receive time, so approval -- and the GUI Approve dialog -- never depends on
  the Slack message still existing.
- **No forward secrecy on the initial secret batch.** Same caveat as all
  Slack exchange: rotate at the upstream source if a new hire's machine is
  later compromised.
- **Trust-root assumption.** The whole flow rests on `uVault` having the
  TL's *verified* key. The invite and the wizard must drive the voice call;
  the GUI Approve gate enforces it on the TL side, and the wizard must show
  the new user the TL's fingerprint to confirm. Skipping it silently
  downgrades to trust-on-first-use against Slack.
- **Token bootstrap.** A brand-new vault has no Slack token; the new user
  must complete `slack login` **in the GUI wizard** (Phase 6, step 3) before
  they can be provisioned. The invite text and the wizard both say so.

## References

- The 16-step sequence diagram and the "step you cannot skip" security
  section live in [`index.md`](index.md); the Mermaid source is in
  [`onboarding-steps.mmd`](onboarding-steps.mmd). This plan deliberately does
  **not** duplicate the full diagram -- see those files for the canonical
  sequence.
- Suggested edits to `index.md` (make the fingerprint check explicit, fix the
  numbered list, reconcile the two diagrams, route TL<->User through Slack,
  spell out the token bootstrap, define "project", add failure/timeout paths,
  align terminology) have largely been folded into the current `index.md`;
  keep the two diagrams (`index.md` and `onboarding-steps.mmd`) in sync as
  the GUI flow lands.

## Resolved questions

These were open; now decided:

1. **Broadcast the newcomer's key to existing teammates -- yes.** On approve,
   after adding the new user, `onboard_approve` also sends the new user's
   record (a `user_list` carrying just the newcomer) to the existing
   teammates over the channel, so they can send secrets to the newcomer
   without a manual re-link. Implemented in Phase 7.
2. **One `secret_batch` per project at provisioning -- enough for now.** No
   delta re-provisioning / "re-provision" button in v1; changing a user's
   project assignment after onboarding is out of scope (revisit if it comes
   up in practice).
3. **TL watch loop runs as a background/tray poller** where the platform
   allows it, so invites are noticed while the panel is closed, falling back
   to in-window polling otherwise. The CLI `onboard watch` covers the
   headless case regardless.
