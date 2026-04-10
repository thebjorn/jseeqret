# Linux & macOS Hardening Options

On Windows, `harden_vault_windows` (src/core/fileutils.js:62) applies
`icacls /inheritance:r`, `attrib +I`, and `cipher /e` at init, which gives
the vault directory a well-understood at-rest threat model (roughly:
"DPAPI-protected, single-user workstation"). Linux and macOS currently
have no equivalent step.

This document surveys the platform-native facilities that could fill that
gap, and proposes a realistic minimum and strong bar for a cross-platform
`harden_vault` implementation.

None of the alternatives below is a perfect one-to-one of Windows'
EFS + icacls + DPAPI stack, but each platform has a roughly analogous
layer for filesystem permissions, at-rest encryption, and OS-assisted key
wrapping.

## Linux

### Filesystem permissions (the `icacls` analogue)

- `chmod 700 <vault>` + `chmod 600` on key files. Cheap, universal, and
  the standard baseline.
- `chattr +i` (immutable) or `+a` (append-only) for files that should not
  be rewritten after init -- blunt, requires root to set/unset, but very
  effective against accidental overwrite.
- ACLs via `setfacl` for finer-grained control if other users legitimately
  exist on the box.

### Per-directory encryption (the EFS analogue)

- **fscrypt** (native in ext4, f2fs, ubifs). The closest structural match
  to EFS: per-directory encryption keys derived from a user passphrase or
  the login keyring, transparent to the application.
  `fscrypt setup` + `fscrypt encrypt <vault>`. The key is unlocked at
  login via PAM and locked at logout.
- **eCryptfs** (older, per-home stacked FS; still what Ubuntu's
  encrypted-home used).
- **gocryptfs** / **CryFS** / **EncFS** -- FUSE-based, userland, no root
  needed. gocryptfs is the most mature; CryFS additionally hides file
  sizes and directory structure.
- **LUKS** -- full-disk/full-partition. Overkill for a single vault
  directory but the right answer on a laptop; it is what most distros
  ship by default now and corresponds to Windows BitLocker, not EFS.

### Key wrapping (the DPAPI analogue)

- **Kernel keyring** (`keyctl`, `add_key`, `request_key`): session-,
  user-, or persistent-keyrings that hold key material in kernel memory,
  not on disk. Best analogue to DPAPI for in-memory unwrap.
- **libsecret / Secret Service API** (GNOME Keyring, KWallet): user-
  session secret store, unlocked at login. Good for wrapping
  `seeqret.key` with a login-bound master.
- **PAM integration** to auto-unlock at login.
- **TPM2** via `tpm2-tools` / `systemd-cryptenroll` / Clevis: hardware-
  backed sealing of a wrapping key to PCR state. Strongest option; ties
  decryption to the physical machine and boot state.

## macOS

### Filesystem permissions

- `chmod 700` + `chflags uchg` (user-immutable) as the `chattr` equivalent.
- POSIX ACLs via `chmod +a` if needed.

### Per-file / per-volume encryption

- **FileVault 2** -- full-volume, AES-XTS, keyed off the login password
  and a recovery key. Ships on, is the default on every modern Mac. This
  is not a per-directory analogue to EFS, but on a single-user Mac it
  covers the same threat model (stolen disk / offline attacker) *by
  default*, and jseeqret gets it for free as long as FileVault is
  enabled. The practical Mac story is "trust FileVault + restrictive
  POSIX permissions".
- **APFS encrypted volumes / sparsebundles** -- create a dedicated
  encrypted volume (or an encrypted sparse disk image via
  `hdiutil create -encryption AES-256`) and put the vault inside it.
  This is the closest per-directory analogue: an encrypted container
  with its own password, unlocked on mount.

### Key wrapping (the DPAPI analogue)

- **Keychain Services** -- the canonical macOS secret store. Wrap
  `seeqret.key` with a Keychain-held key; the Keychain itself is unlocked
  by the login password and, on Apple silicon, protected by the Secure
  Enclave.
- **Data Protection Keychain** (iOS-style, also available on macOS with
  Apple silicon) -- stronger class-based protection, with keys held in
  the Secure Enclave and access policies like "requires user presence"
  or biometrics.
- **Secure Enclave-backed keys** via the Security framework
  (`SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`) --
  hardware-bound wrapping keys that never leave the SEP. This is
  stronger than DPAPI on Windows without a TPM, and comparable to TPM-
  sealed keys on Linux.

## Cross-Platform Mapping

| Step                  | Windows                 | Linux                                                | macOS                                                    |
| --------------------- | ----------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Restrict perms        | `icacls /inheritance:r` | `chmod 700` + `chmod 600` on keys                    | `chmod 700` + `chmod 600` on keys                        |
| Exclude from indexer  | `attrib +I`             | n/a (or `.hidden` for GNOME tracker)                 | `mdutil -i off <path>` / `.noindex`                      |
| Encrypt at rest       | `cipher /e`             | fscrypt (if available), else document LUKS/gocryptfs | Rely on FileVault, or create an APFS encrypted volume    |
| Wrap the wrapping key | implicit via EFS+DPAPI  | libsecret or kernel keyring                          | Keychain / Secure Enclave                                |

## Recommended Bars for jseeqret

### Minimum bar

On both platforms: **`chmod 700` on the vault directory plus `chmod 600`
on key files, and a doctor-style check that the containing volume is
encrypted** (FileVault on macOS, LUKS or fscrypt on Linux) -- warn
loudly, but do not refuse to open, if it is not.

This gets within spitting distance of the Windows baseline without
taking on the complexity of actively managing fscrypt policies or
Keychain items from jseeqret itself. It is also implementable in a few
dozen lines of `fileutils.js`.

### Strong bar

**Wrap `seeqret.key` with a platform secret store** -- Keychain on
macOS, libsecret or kernel keyring on Linux, DPAPI on Windows. This is
the same work item as the long-discussed passphrase-wrap mitigation, but
with the "passphrase" provided by the OS at login time, so the user sees
zero additional prompts.

This is probably the single highest-leverage cross-platform hardening
item, and it also closes the "user-level process compromise" gap that
EFS alone does not address on Windows: a malicious process running as
the same user can read the plaintext key file on disk today, but cannot
(as easily) impersonate a Keychain/libsecret/DPAPI unwrap request,
especially when the OS enforces per-app ACLs on the secret store.

### Nice-to-have

- `jseeqret doctor` command that re-verifies permissions and
  encryption state on every `open` and warns on drift (a vault moved to
  a FAT USB stick loses EFS + ACLs silently; same applies to `cp -r`
  without `--preserve` on Linux).
- TPM2 / Secure Enclave binding as an opt-in for high-assurance
  deployments -- ties decryption to the physical machine and defeats
  offline attacks even if the user's login password is known.
- Platform-specific immutability flags (`chattr +i`, `chflags uchg`) on
  the three key files after init, re-cleared only by an explicit
  `jseeqret rotate-keys` command, to defend against accidental or
  malicious overwrite.

## Related Documents

- [Vault Architecture Roadmap - Security Concerns](feature-plans/vault-architecture-roadmap/security-concerns.md) --
  concern #1 ("Plaintext key files on disk") is the primary driver for
  this work; that document now cross-references this one.
- `src/core/fileutils.js` -- current Windows-only `harden_vault_windows`
  implementation.
