---
description: Cut a versioned GitHub release (DMG + app.asar)
argument-hint: <version> e.g. 1.2.0
---

Cut release `v$1` for noty-mac. Follow the steps below in order; stop and ask
the user only if a precondition fails or the diff/notes need their judgment.

## Current state

- Working tree: !`git status --short`
- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Last tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "(none)"`
- Commits since last tag:
!`git log $(git describe --tags --abbrev=0 2>/dev/null)..HEAD --format='%h %s' 2>/dev/null | head -40`
- package.json version: !`node -p "require('./package.json').version"`

## Preconditions (abort if any fails)

1. `$1` matches `^\d+\.\d+\.\d+$`.
2. On `main` branch.
3. `package.json` version is strictly less than `$1` (use semver comparison).
4. Working tree is clean, OR the only changes are intentional release-prep
   edits the user has already mentioned this turn. If unsure, ask.

## Bump, commit, push

1. Edit `package.json` to set `"version": "$1"`.
2. Commit. Type prefix follows the dominant commit type since last tag —
   `feat:` if any feat commits, else `fix:` if any fix, else `chore:`.
   Subject: `<type>: release v$1`. Body optional.
3. `git push origin main`.

## Build

```
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
npm run extract-asar
```

Verify both artifacts exist with sane sizes (DMG > 50 MB, asar > 1 MB):
- `release/Noty-$1-arm64.dmg`
- `release/app.asar`

If `npm run dist` complains about ambiguous code-signing identity, the env
var above must be set — signing is ad-hoc by design (no Apple Developer ID
notarization).

## Tag and publish

1. `git tag v$1 && git push origin v$1`.

2. Draft release notes from the commit list above. Group by conventional type
   (feat / fix / chore / docs). Lead with user-visible highlights, not
   implementation detail.

3. **Hot-update warning** (only when applicable): if any commit since the last
   tag touched `electron-builder.json`, `Info.plist`, the `mac` config, or
   native dependencies, include an **Upgrade notes** block warning that
   in-app hot-update only swaps `app.asar` and won't deliver these changes;
   existing users must reinstall the DMG.

4. Publish:

```
gh release create v$1 \
  release/Noty-$1-arm64.dmg \
  release/app.asar \
  --title "v$1" \
  --notes "<drafted notes>"
```

The DMG upload is large; run in background or accept a long timeout.

## Verify

- `gh release view v$1 --json url,assets --jq '{url, assets: [.assets[] | {name, size}]}'`
- Confirm both `Noty-$1-arm64.dmg` and `app.asar` are listed with non-zero sizes.
- Print the release URL.

## Known gotchas

- The hot-update endpoint reads `package.json#repository.url` from the
  *installed* asar to find the GitHub repo. If a user is on a build older
  than v1.2.0, that field points at `qiaoanran/noty-mac` (now 404) and
  in-app "check for updates" silently returns no_releases. They have to
  download the DMG manually once. Mention in release notes if you expect
  affected users.
- First click-to-jump after a fresh install triggers a macOS Automation
  permission prompt ("Noty wants to control 'kitty'"). User must approve.
