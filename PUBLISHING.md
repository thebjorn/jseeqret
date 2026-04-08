# Publishing a Release

This document describes how to publish a signed release of jseeqret.
There are three artifacts: a signed Windows installer (NSIS), an npm
package, and a GitHub release with auto-generated release notes.

## Prerequisites

- **Sectigo EV hardware token** plugged in (SafeNet middleware installed)
- **`GH_TOKEN`** environment variable set to a GitHub personal access token
  with `repo` scope (for `gh` CLI and electron-builder)
- **`npm_token`** configured as a GitHub repository secret (for CI npm publish)
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

Pushing the tag triggers two CI workflows:

- **`build-release.yml`** — builds the Electron app on GitHub Actions and
  uploads unsigned artifacts. (CI cannot sign because the hardware token
  is not available remotely.)
- Tests run in CI as part of this workflow.

### 6. Create the GitHub release

```bash
gh release create v<new_version> --title "v<new_version>" --generate-notes
```

Creating the release triggers:

- **`npm-publish.yml`** — runs tests on Ubuntu, then publishes the npm
  package (`jseeqret` on npmjs.org) using the `npm_token` secret.

### 7. Build and sign the installer locally

```bash
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

```bash
gh release upload v<new_version> "dist/jseeqret-setup-<version>.exe" dist/latest.yml --clobber
```

The `--clobber` flag replaces any unsigned artifacts that CI may have
uploaded earlier.

### 9. Verify

- **GitHub release**: https://github.com/thebjorn/jseeqret/releases
  — confirm the signed `.exe` and `latest.yml` are listed
- **npm**: `npm view jseeqret version` — confirm the new version is published
- **Signature**: run `signtool verify /pa /v "dist/jseeqret-setup-<version>.exe"`
  to confirm the installer is properly signed and timestamped

## What each workflow does

| Workflow | Trigger | What it does |
|---|---|---|
| `build-release.yml` | Push tag `v*` | Builds Electron app, runs tests, uploads unsigned artifacts |
| `npm-publish.yml` | GitHub release created | Runs tests, publishes to npmjs.org |

## Notes

- The `dist` script (`pnpm dist`) uses `--publish always` which tries to
  create a draft GitHub release. This conflicts with a release that already
  exists. Use `pnpm dist:nsis` for local builds when the release is already
  created, then upload manually with `gh release upload`.
- `latest.yml` is used by `electron-updater` for auto-updates. Always
  upload it alongside the installer.
- The hardware token cannot be used in CI. Signed installers must be built
  locally.
