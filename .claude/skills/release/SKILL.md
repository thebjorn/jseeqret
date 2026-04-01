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
   - Ensure all tests pass (`npm test`)
   - Read current version from `package.json`

3. **Bump version** in `package.json`:
   - Parse current version (semver X.Y.Z)
   - Calculate new version based on bump type
   - Edit `package.json` to set the new version
   - Also update the global npm install: `npm install -g .`

4. **Commit the version bump**:
   - `git add package.json`
   - `git commit -m "v<new_version>"`

5. **Create and push the git tag**:
   - `git tag v<new_version>`
   - `git push origin master`
   - `git push origin v<new_version>`
   - This triggers the `build-release.yml` workflow (Electron build + draft GitHub Release)

6. **Create GitHub Release** (triggers npm publish workflow):
   - `gh release create v<new_version> --title "v<new_version>" --generate-notes`
   - This triggers `npm-publish.yml` which publishes to npmjs.org

7. **Report summary**: version bumped, tag pushed, release created, links to release and npm package

## Important

- Never skip tests
- Never force-push
- Always confirm the bump type and new version with the user before committing
- The GitHub Actions workflows handle npm publishing and Electron builds automatically
