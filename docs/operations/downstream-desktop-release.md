# Downstream Desktop Releases

This fork follows `pingdotgg/t3code` while retaining Coda-specific changes on `main`. Upstream
updates are initiated locally with `/sync-upstream` in Claude Code or `$sync-upstream` in Codex.
The shared [agent command](../../.agents/skills/sync-upstream/SKILL.md) pins upstream, resolves
conflicts, and verifies the result. `Release Coda Desktop` builds and publishes changes pushed to
`main`, and can also be run manually.

## Manual sync

Invoke the command from this repository and specify whether to prepare the update or commit and
push it. Source updates use the recorded checkpoint in `.coda-upstream/upstream.json` as the base
and land as one linear commit. Keep that checkpoint with the corresponding source changes; future
syncs use it to distinguish upstream changes from Coda customizations.

Review and validate conflict resolutions before pushing. A sync does not need a proposal PR,
self-hosted runner, or provider subscription. Desktop packaging runs on GitHub-hosted runners.

## Release cadence

`Release Coda Desktop` runs when `main` is pushed, on a three-hour schedule, and by hand. It
mirrors how the official `Release` workflow cuts nightlies: it compares `main` to the commit
behind the newest release tag and stops early when nothing has moved. Any commit that lands on
`main` therefore ships, whether it arrived through an upstream sync or was written here directly.

Use **Actions → Release Coda Desktop → Run workflow** for an immediate build. The `force` input
releases even when `main` has not moved since the last release, which is how to rebuild the same
commit.

## Release identity

Downstream releases use versions such as `0.0.32-nightly.20260803.992.coda.3.44.12`. The prefix
identifies the official Nightly, `3` is the distance from that Nightly to official main, and `44`
is the local sync sequence that recorded that snapshot in `.coda-upstream/upstream.json`. The release workflow
appends its own run number, `12`, because the snapshot only moves when a sync lands and so cannot
tell two releases apart when the changes are ours. Semver precedence orders those trailing numbers,
so every build outranks the one before it and the updater offers it. The desktop updater is
configured for `demget/coda`, so both update metadata and release-note links stay on the fork.

The bundled web client and server retain the exact official Nightly version while Electron uses the
longer downstream version for desktop updates. This keeps the bundled client and its
desktop-managed server aligned without claiming that a downstream `coda@<version>` exists on npm.
Coda-only server behavior is included in the desktop-managed server. This workflow does not publish
or support a separately installed Coda CLI; adding that distribution requires a package name and
registry owned by this fork.

## Platforms and signing

- macOS: Apple Silicon (`arm64`) DMG and updater ZIP.
- Windows: x64 NSIS installer, updater metadata, and a self-contained Linux x64 runtime for the
  packaged WSL backend.

macOS builds use an ad-hoc signature for updater compatibility and are not Apple-notarized.
Install the DMG manually once; subsequent nightly releases can update in-app. Windows builds are
unsigned. Gatekeeper and SmartScreen can warn on first launch.

## GitHub configuration

The desktop release workflow uses the repository `GITHUB_TOKEN`, with contents write access only
in its publish job. It does not publish npm packages, deploy a relay or hosted web app, or build
mobile clients. It does not require provider credentials or a self-hosted runner.

Workflow checkouts exclude `.repos` and local `.claude/worktrees` content and leave submodule
initialization disabled. Those directories are not release inputs.
