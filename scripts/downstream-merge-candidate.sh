#!/usr/bin/env bash
# Merge official upstream onto Coda in an isolated worktree and emit a candidate bundle.
set -euo pipefail

emit() {
  local key="$1"
  local value="$2"
  printf '%s=%s\n' "$key" "$value"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

require_env() {
  local name
  for name in UPSTREAM_REPOSITORY UPSTREAM_BRANCH OFFICIAL_TAG OFFICIAL_MAIN_SHA \
    OFFICIAL_NIGHTLY_SHA OLD_MAIN_SHA OLD_HEAD RELEASE_VERSION RUNNER_TEMP; do
    if [[ -z "${!name:-}" ]]; then
      echo "$name is required." >&2
      exit 1
    fi
  done
}

candidate_dir() {
  echo "${CANDIDATE_DIR:-$RUNNER_TEMP/coda-candidate}"
}

official_remote_url() {
  echo "${OFFICIAL_REMOTE_URL:-https://github.com/$UPSTREAM_REPOSITORY.git}"
}

ensure_official() {
  local url
  url="$(official_remote_url)"
  if git remote get-url official >/dev/null 2>&1; then
    git remote set-url official "$url"
  else
    git remote add official "$url"
  fi
  git fetch --no-tags official \
    "+refs/heads/$UPSTREAM_BRANCH:refs/coda/official-main" \
    "+refs/tags/$OFFICIAL_TAG:refs/coda/official-nightly"

  test "$(git rev-parse refs/coda/official-main)" = "$OFFICIAL_MAIN_SHA"
  test "$(git rev-parse 'refs/coda/official-nightly^{commit}')" = "$OFFICIAL_NIGHTLY_SHA"
  git merge-base --is-ancestor "$OLD_MAIN_SHA" "$OLD_HEAD"
  git merge-base --is-ancestor "$OLD_MAIN_SHA" "$OFFICIAL_MAIN_SHA"
  git merge-base --is-ancestor "$OFFICIAL_NIGHTLY_SHA" "$OFFICIAL_MAIN_SHA"
}

remove_candidate() {
  local dir="$1"
  git worktree remove --force "$dir" 2>/dev/null || true
  rm -rf "$dir"
}

attempt() {
  require_env
  ensure_official

  git diff --name-only "$OLD_MAIN_SHA" "$OFFICIAL_MAIN_SHA" > "$RUNNER_TEMP/upstream-paths.txt"
  git diff --name-only "$OLD_MAIN_SHA" "$OLD_HEAD" > "$RUNNER_TEMP/customization-paths.txt"

  local dir
  dir="$(candidate_dir)"
  remove_candidate "$dir"
  git worktree add --detach "$dir" "$OLD_HEAD"
  git -C "$dir" config user.name "Coda upstream sync"
  git -C "$dir" config user.email "actions@users.noreply.github.com"

  if [[ "$OLD_MAIN_SHA" != "$OFFICIAL_MAIN_SHA" ]]; then
    if ! git -C "$dir" merge --no-commit --no-ff "$OFFICIAL_MAIN_SHA" \
      2> "$RUNNER_TEMP/merge-error.txt"; then
      git -C "$dir" diff --name-only --diff-filter=U > "$RUNNER_TEMP/unmerged-paths.txt"
      node scripts/downstream-sync.ts report \
        --old-sha "$OLD_MAIN_SHA" \
        --new-tag "$OFFICIAL_TAG" \
        --new-sha "$OFFICIAL_MAIN_SHA" \
        --upstream-paths "$RUNNER_TEMP/upstream-paths.txt" \
        --customization-paths "$RUNNER_TEMP/customization-paths.txt" \
        --unmerged-paths "$RUNNER_TEMP/unmerged-paths.txt" \
        --rebase-error "$RUNNER_TEMP/merge-error.txt" \
        --output "$RUNNER_TEMP/upstream-sync-conflict.md"
      if [[ "${KEEP_CONFLICTED:-}" == "true" ]]; then
        emit conflicted true
        emit candidate_dir "$dir"
        exit 0
      fi
      git -C "$dir" merge --abort || true
      remove_candidate "$dir"
      emit conflicted true
      exit 0
    fi
  fi

  emit conflicted false
  emit candidate_dir "$dir"
}

finish() {
  require_env
  local dir msg candidate_sha
  dir="$(candidate_dir)"
  test -d "$dir"

  if git -C "$dir" diff --name-only --diff-filter=U | grep -q .; then
    echo "Unmerged paths remain:" >&2
    git -C "$dir" diff --name-only --diff-filter=U >&2
    exit 1
  fi
  if git -C "$dir" grep -I -n '^<<<<<<< ' -- . >/dev/null 2>&1; then
    echo "Conflict markers remain:" >&2
    git -C "$dir" grep -I -n '^<<<<<<< ' -- . >&2
    exit 1
  fi

  mkdir -p "$dir/.coda-upstream"
  jq -n \
    --arg repository "$UPSTREAM_REPOSITORY" \
    --arg branch "$UPSTREAM_BRANCH" \
    --arg mainSha "$OFFICIAL_MAIN_SHA" \
    --arg nightlyTag "$OFFICIAL_TAG" \
    --arg nightlySha "$OFFICIAL_NIGHTLY_SHA" \
    --arg version "$RELEASE_VERSION" \
    '{repository: $repository, branch: $branch, mainSha: $mainSha, nightlyTag: $nightlyTag, nightlySha: $nightlySha, version: $version}' \
    > "$dir/.coda-upstream/upstream.json"
  git -C "$dir" add -u
  git -C "$dir" add .coda-upstream/upstream.json

  if [[ "$OLD_MAIN_SHA" != "$OFFICIAL_MAIN_SHA" ]]; then
    msg="chore(sync): merge upstream $OFFICIAL_TAG"
  else
    msg="chore(sync): refresh $RELEASE_VERSION"
  fi

  if git -C "$dir" rev-parse -q --verify MERGE_HEAD >/dev/null \
    || ! git -C "$dir" diff --cached --quiet; then
    git -C "$dir" commit -m "$msg"
  fi

  candidate_sha="$(git -C "$dir" rev-parse HEAD)"
  git update-ref refs/coda/candidate "$candidate_sha"
  git bundle create "$RUNNER_TEMP/candidate.bundle" refs/coda/candidate "^$OLD_HEAD"
  git bundle verify "$RUNNER_TEMP/candidate.bundle"
  emit candidate_sha "$candidate_sha"
  emit conflicted false
}

case "${1:-}" in
  attempt) attempt ;;
  finish) finish ;;
  *)
    echo "Expected command 'attempt' or 'finish'." >&2
    exit 1
    ;;
esac
