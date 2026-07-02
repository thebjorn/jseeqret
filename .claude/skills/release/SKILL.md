---
name: release
description: Tag, publish, and release jseeqret (bump version, git tag, push, create GitHub release)
---

Release jseeqret with bump type: $ARGUMENTS (patch, minor, or major; defaults to patch)

## Steps

1. **Determine bump type** from arguments (patch/minor/major, default: patch)

2. **Pre-flight checks**:
   - Ensure working tree is clean (`git status --porcelain` must be empty)
   - Ensure on `master` branch
   - Ensure all tests pass (`pnpm test`)
   - Read current version from `package.json`

3. **Bump version** in `package.json` and `dkbuild.yml`:
   - Parse current version (semver X.Y.Z)
   - Calculate new version based on bump type
   - Edit `package.json` to set the new version
   - Edit `dkbuild.yml` — set `package.version` to the same new version
     (keep it in lock-step with `package.json`; it drifts otherwise)
   - Also update the global npm install: `npm install -g .`

4. **Commit the version bump**:
   - `git add package.json dkbuild.yml`
   - `git commit -m "v<new_version>"`

5. **Create and push the git tag**:
   - `git tag v<new_version>`
   - `git push origin master`
   - `git push origin v<new_version>`
   - Pushing the tag triggers `build-release.yml`, which builds + tests and
     uploads the **unsigned** installer as a *workflow artifact*. It does NOT
     create a GitHub release (CI cannot sign).

6. **Create the GitHub release** (triggers npm publish):
   - `gh release create v<new_version> --title "v<new_version>" --generate-notes`
   - Uses your `GH_TOKEN` PAT (not CI's token), firing `release: created` →
     `npm-publish.yml` publishes `jseeqret` to npmjs.org.

7. **Build, sign, and upload the installer + updater metadata** (MANUAL — needs
   the Sectigo EV hardware token; cannot be done in CI):
   - **Clean `dist/` first** — electron-builder never cleans it, so stale
     installers from past releases accumulate:
     `rm -rf dist` (PowerShell: `Remove-Item dist/* -Recurse -Force`)
   - `pnpm dist:nsis` — builds + signs; emits a matched set in `dist/`:
     `jseeqret-setup-<new_version>.exe`, `.exe.blockmap`, and `latest.yml`
   - Upload the **matched trio with explicit filenames**:
     `gh release upload v<new_version> dist/jseeqret-setup-<new_version>.exe dist/jseeqret-setup-<new_version>.exe.blockmap dist/latest.yml --clobber`

8. **Verify**:
   - `gh release view v<new_version> --json assets` → **exactly three** assets
     (`.exe`, `.exe.blockmap`, `latest.yml`) and no stray older installers
   - `npm view jseeqret version` → the new version
   - GUI auto-update succeeds from the prior version

9. **Report summary**: version bumped, tag pushed, release created + assets
   uploaded, links to release and npm package

## Important

- Never skip tests
- Never force-push
- Always confirm the bump type and new version with the user before committing
- **The release is NOT complete until the signed `.exe` + `.exe.blockmap` +
  `latest.yml` are uploaded as a matched set from the SAME `pnpm dist:nsis`
  build.** `latest.yml` is required by electron-updater (it verifies the exe's
  sha512/size); a missing or mismatched one makes every deployed client throw
  "update failed" on launch.
- **NEVER `gh release upload <tag> dist/*.exe`.** Because `dist/` accumulates
  every past build, the glob uploads stale installers onto the new release and
  skips `latest.yml`. Always name the three files explicitly (step 7).
- The GitHub Actions workflows handle npm publishing and the (unsigned) CI
  build automatically; the signed installer + updater metadata are manual.
