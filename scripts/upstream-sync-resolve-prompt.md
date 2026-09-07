Resolve the in-progress git merge in this worktree. Official t3code is being merged onto Coda. Do not commit, push, rebase, or call `gh`.

Rules:

- Keep Coda customizations: branding and assets, `.coda-upstream/`, `scripts/downstream-sync.ts`, `scripts/downstream-sync.test.ts`, `scripts/downstream-merge-candidate.sh`, `scripts/downstream-merge-candidate.test.ts`, `scripts/upstream-sync-resolve-prompt.md`, `.github/workflows/downstream-*.yml`, `.github/self-hosted-runner/`, and `docs/operations/downstream-desktop-release.md`.
- Keep upstream behavior when Coda only adapted code that has now moved.
- Prefer a merge that preserves both sides over deleting either. Stop if a conflict is a product decision rather than a textual one.
- After each file is resolved, `git add` it. Leave the merge uncommitted.
- Do not add files that are not part of the merge. Do not amend history.

When every unmerged path is staged and no `<<<<<<<` markers remain, print a one-line summary of what you kept from each side and stop.
