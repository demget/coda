---
name: sync-upstream
description: Manually sync Coda with the latest official t3code nightly and main, preserve fork customizations, and verify the desktop build. Use only when the maintainer invokes /sync-upstream or explicitly asks for an upstream sync.
---

# Sync upstream

Run this workflow only when the maintainer invokes it. Read the repository instructions and [downstream release guide](../../../docs/operations/downstream-desktop-release.md). Sync source and verify it; commit, push, or publish only when the current request authorizes those actions.

## Pin the update

- Read `.coda-upstream/upstream.json`, the current branch, worktree status, and recent fork commits. Preserve unrelated work. Use an isolated detached worktree if the shared checkout has pending changes; do not create a branch automatically.
- Fetch origin and the recorded official repository/branch with `--no-tags`. Fetch the selected nightly into a private `refs/coda/` ref so official tags cannot confuse the fork's release checks.
- Use `gh api` to read official releases and `node scripts/downstream-sync.ts latest --releases <json-file>` to select the latest published nightly. Pin official main and the nightly to commit SHAs. Verify the recorded upstream checkpoint and nightly are ancestors of the pinned main. Compare the nightly against that SHA, not a moving branch name.
- Resolve metadata with `node scripts/downstream-sync.ts resolve --state .coda-upstream/upstream.json --releases <json-file> --main <json-file> --compare <json-file> --run-number <sequence>`. Use the previous snapshot's final numeric component plus one for the sequence. If `has_update` is false, report that upstream is current.

## Apply and resolve

Main stays linear. Apply the change from the recorded `mainSha` to the pinned official main as one uncommitted cherry-pick: create a temporary commit object with `git commit-tree <official-main-tree> -p <recorded-main-sha> -m <sync-subject>`, then `git cherry-pick --no-commit <temporary-sha>` in the isolated checkout. This uses the recorded upstream tree as the three-way base even after earlier syncs were squashed. The temporary commit object does not become part of main's history.

Inspect both sides of every conflict. Carry Coda customizations forward into upstream's current structure: branding/assets and `.coda` state paths, Kimi support, voice input, file-path highlighting, macOS updater signing/recovery, and the downstream release workflow. Keep upstream package scopes and third-party names intact. Preserve official URLs that serve official services; the desktop updater repository must remain `demget/coda`. Follow moved functionality instead of resurrecting deleted upstream modules. Do not bulk choose ours/theirs or replace names across the repository.

Write the resolved checkpoint to `.coda-upstream/upstream.json` only with the source changes it describes. Stage specific resolved paths. Check for unmerged entries and conflict markers. Review the resulting diff against both Coda HEAD and pinned upstream; successful textual resolution alone is insufficient. Leave product decisions that cannot be inferred from the fork for the maintainer.

## Verify and finish

Install with `vp i` if the lockfile changed. Run focused tests for the resolved behavior, affected package typechecks, and the release checks in `.github/workflows/downstream-desktop-release.yml`. Build the desktop artifact when a build is requested. Check renamed packages, new runtime dependencies, platform tooling, and version stamping against the downstream workflow. Do not run repo-wide checks or launch a browser unless requested.

If committing is authorized, use a Conventional Commit such as `chore(sync): update to upstream <nightly-tag>`. Commit the resolved snapshot with one parent, then bring that commit into the original branch if an isolated checkout was used. Fetch and rebase onto origin before an authorized push; never force-push. When publishing is authorized, follow the `Release Coda Desktop` run on that exact commit through validation and packaging, and report the release URL or the concrete failure. Remove only temporary worktrees created by this invocation after their work is safely integrated.

For large imports, use `git -c diff.renames=false commit` and inspect the hook output: Vite+ 0.3.0 can treat rename-limit warnings as filenames and report restaging errors even when Git creates the commit. Keep vendored `.repos` files outside the staged formatter.
