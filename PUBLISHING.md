# Publishing a Release

This document describes how to publish a signed release of jseeqret.
There are three artifacts: a signed Windows installer (NSIS), an npm
package, and a GitHub release with auto-generated release notes.

## Prerequisites

- **Sectigo EV hardware token** plugged in (SafeNet middleware installed)
- **`GH_TOKEN`** environment variable set to a GitHub personal access token
  with `repo` scope (for `gh` CLI and electron-builder)
- **npm Trusted Publishing (OIDC)** configured for the `jseeqret` package on
  npmjs.org (links this repo + `npm-publish.yml`; no npm token needed)
- **pnpm** installed (`npm i -g pnpm`)
- **Windows SDK** installed (provides `signtool.exe`, used by `sign.js`)

## Step-by-step

### 1. Make sure the working tree is clean

```bash
git status
```

There should be no uncommitted changes.

### 2. Run tests

```bash
pnpm test
```

All tests should pass (some vault-related tests may fail locally if you
have a vault configured — check that failures are environment-specific,
not regressions).

### 3. Bump the version

```bash
dk upversion
```

This updates `package.json` and `dkbuild.yml` to the next patch version.
For minor or major bumps, edit the version manually in both files.

### 4. Commit and tag

```bash
git add package.json dkbuild.yml
git commit -m "v<new_version>"
git tag v<new_version>
```

### 5. Push to GitHub

```bash
git push origin master
git push origin v<new_version>
```

Pushing the tag triggers **`build-release.yml`**, which builds the Electron
app on GitHub Actions, runs the tests, and uploads the **unsigned** installer
as a *workflow artifact* (downloadable from the Actions run for 30 days). It
deliberately does **not** create a GitHub release — CI cannot sign (the
hardware token is not available remotely), so the release is created and
populated manually in the next steps.

### 6. Create the GitHub release

```bash
gh release create v<new_version> --title "v<new_version>" --generate-notes
```

This is the single point at which the GitHub release is created. Because it
uses your `GH_TOKEN` PAT (not CI's `GITHUB_TOKEN`), it fires the
`release: created` event, which triggers:

- **`npm-publish.yml`** — runs tests on Ubuntu, then publishes the npm
  package (`jseeqret` on npmjs.org) via npm Trusted Publishing (OIDC).

### 7. Build and sign the installer locally

First clear `dist/` — electron-builder never cleans it, so installers from
past releases pile up and can get swept onto the release in step 8:

```bash
rm -rf dist        # PowerShell: Remove-Item dist/* -Recurse -Force
pnpm dist:nsis
```

This will:
1. Build the Electron app (`electron-vite build`)
2. Package the NSIS installer (`electron-builder --win nsis`)
3. Sign all `.exe` and `.dll` files via `sign.js` using `signtool.exe`

SafeNet will prompt for the hardware token PIN on the first signing
operation. Subsequent signs in the same session use the cached PIN.

The signed installer is written to:
```
dist/jseeqret-setup-<version>.exe
```

### 8. Upload the signed installer to the GitHub release

Upload the **matched trio** with explicit filenames — the installer, its
blockmap (for differential updates), and `latest.yml`:

```bash
gh release upload v<new_version> "dist/jseeqret-setup-<version>.exe" "dist/jseeqret-setup-<version>.exe.blockmap" dist/latest.yml --clobber
```

> **Never** `gh release upload v<new_version> dist/*.exe`. Because `dist/`
> accumulates every past build, the glob uploads stale installers (e.g.
> 1.0.x, 2.0.0) onto the new release **and** silently skips `latest.yml` —
> which breaks auto-update. Always name the three files explicitly.

`latest.yml` must come from the **same** `pnpm dist:nsis` build as the
uploaded `.exe` — electron-updater verifies the exe's sha512/size against it.
The `--clobber` flag replaces any file already on the release.

### 9. Verify

- **Release assets**: `gh release view v<new_version> --json assets` — confirm
  **exactly three** (the signed `.exe`, its `.exe.blockmap`, and `latest.yml`)
  and no stray installers from older versions
- **npm**: `npm view jseeqret version` — confirm the new version is published
- **Signature**: run `signtool verify /pa /v "dist/jseeqret-setup-<version>.exe"`
  to confirm the installer is properly signed and timestamped

## What each workflow does

| Workflow | Trigger | What it does |
|---|---|---|
| `build-release.yml` | Push tag `v*` | Builds Electron app, runs tests, uploads the unsigned installer as a workflow artifact (no GitHub release) |
| `npm-publish.yml` | GitHub release created (via PAT) | Runs tests, publishes to npmjs.org via Trusted Publishing (OIDC) |

## Notes

- The `dist` script (`pnpm dist`) uses `--publish always` which tries to
  create a draft GitHub release. This conflicts with a release that already
  exists. Use `pnpm dist:nsis` for local builds when the release is already
  created, then upload manually with `gh release upload`.
- `latest.yml` is **required** by `electron-updater`; without it (or with one
  that doesn't match the uploaded `.exe`), every deployed client throws
  "update failed" on launch. Upload it — plus the `.exe.blockmap` — from the
  same build as the `.exe`, every time. Never upload via a `dist/*.exe` glob.
- The hardware token cannot be used in CI. Signed installers must be built
  locally.
