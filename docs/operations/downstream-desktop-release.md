# Downstream Desktop Releases

This fork follows `pingdotgg/t3code` while retaining Coda-specific commits on `main`. The
`Sync Upstream and Release Desktop` workflow checks the official repository every three hours and
can also be run manually.

## Safety model

The workflow never rebases the live branch in place. It fetches the recorded upstream checkpoint,
rebases the Coda commit stack in an isolated worktree, validates the candidate, and builds both
desktop platforms before publishing anything. It then:

1. creates a GitHub prerelease containing macOS arm64 and Windows x64 assets;
2. advances `main` with an exact `--force-with-lease` guard;
3. records the new official main, official Nightly, and downstream release version in
   `.coda-upstream/upstream.json`.

If the rebase conflicts, no build, release, or branch update occurs. The run uploads a collision
report and, when repository Issues are enabled, opens or refreshes the
`[automation] Upstream sync conflict` issue. Resolve that rebase on `main`, update the recorded
`mainSha` only when the Coda commit stack is based on that exact official commit, and rerun the
workflow.

## Release identity

Downstream releases use versions such as
`0.0.32-nightly.20260803.992.coda.3.44`. The prefix identifies the official Nightly, `3` is the
distance from that Nightly to official main, and `44` is this workflow's run number. The desktop
updater is configured for `demget/coda`, so both update metadata and release-note links stay on the
fork.

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

Use **Actions → Sync Upstream and Release Desktop → Run workflow** for an immediate run. The manual
`force` option produces a new snapshot even if official upstream has not moved.
