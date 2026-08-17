# Downstream Desktop Releases

This fork follows `pingdotgg/t3code` while retaining Coda-specific commits on `main`. Two workflows
share the work. `Propose Upstream Sync` watches the official repository hourly and opens a pull
request when it has moved. `Release Coda Desktop` builds and publishes the desktop apps every three
hours. Both can also be run manually.

## Safety model

The sync workflow never rebases the live branch in place. It fetches the recorded upstream
checkpoint, merges the Coda commit stack in an isolated worktree, and validates the candidate. It
then pushes the result to the `automation/upstream-sync` branch and opens or refreshes a pull
request that records the new official main, official Nightly, and downstream snapshot version in
`.coda-upstream/upstream.json`. Nothing reaches `main` until that pull request is merged.

If the merge conflicts, no branch update or pull request occurs. The run uploads a collision report
and, when repository Issues are enabled, opens or refreshes the `[automation] Upstream sync
conflict` issue. Resolve that merge on `main`, update the recorded `mainSha` only when the Coda
commit stack is based on that exact official commit, and rerun the workflow.

## Release cadence

`Release Coda Desktop` runs on a three-hour schedule and mirrors how the official `Release`
workflow cuts nightlies: it compares `main` to the commit behind the newest release tag and stops
early when nothing has moved. Any commit that lands on `main` therefore ships, whether it arrived
through an upstream sync or was written here directly.

Use **Actions → Release Coda Desktop → Run workflow** for an immediate build. The `force` input
releases even when `main` has not moved since the last release, which is how to rebuild the same
commit.

## Release identity

Downstream releases use versions such as `0.0.32-nightly.20260803.992.coda.3.44.12`. The prefix
identifies the official Nightly, `3` is the distance from that Nightly to official main, and `44`
is the sync run that recorded that snapshot in `.coda-upstream/upstream.json`. The release workflow
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
- Windows: x64 NSIS installer, updater metadata, and the Linux x64 `node-pty` prebuild needed by the
  packaged WSL backend.

The artifacts are unsigned because this fork does not assume Apple or Microsoft signing
credentials. macOS Gatekeeper and Windows SmartScreen can therefore warn on first launch. In
particular, macOS in-app installation is not reliable until Apple signing and notarization are
configured; users can always download the newer DMG from GitHub Releases.

## GitHub configuration

The workflow needs only the repository `GITHUB_TOKEN` with write access to repository contents and
issues. It intentionally does not publish npm packages, deploy a relay or hosted web app, build
mobile clients, use Blacksmith runners, or require Clerk, Vercel, EAS, Cloudflare, Apple, or Azure
secrets.

The root `.gitmodules` only describes gitlinks already tracked by the repository so GitHub's
checkout action can clean up credentials. All workflow checkouts keep submodule initialization
disabled and exclude `.repos` and local `.claude/worktrees` content.

Use **Actions → Propose Upstream Sync → Run workflow** to check upstream immediately. That
workflow's `force` option refreshes the proposal even when official upstream has not moved.
