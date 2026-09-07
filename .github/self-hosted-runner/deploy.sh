#!/usr/bin/env bash
# Copy the runner definition to launchpad~atlas and start it.
set -euo pipefail

HOST="${HOST:-launchpad~atlas}"
DEST="${DEST:-/opt/coda-grok-runner}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Create $ROOT/.env from .env.example (ACCESS_TOKEN is required)." >&2
  exit 1
fi

ssh "$HOST" "mkdir -p '$DEST'"
rsync -az --delete --exclude .env "$ROOT/" "$HOST:$DEST/"
rsync -az "$ROOT/.env" "$HOST:$DEST/.env"
ssh "$HOST" "chmod 600 '$DEST/.env' && cd '$DEST' && docker compose up -d --build"

cat <<'EOF'
Runner is up. Sign Grok in once with the SuperGrok subscription (not an API key):

  ssh launchpad~atlas 'docker compose -f /opt/coda-grok-runner/docker-compose.yml exec runner grok login --device-auth'

Complete the device-code URL, then confirm:

  ssh launchpad~atlas 'docker compose -f /opt/coda-grok-runner/docker-compose.yml exec runner grok --version'
EOF
