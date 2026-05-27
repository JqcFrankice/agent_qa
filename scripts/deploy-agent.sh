#!/usr/bin/env bash
# deploy-agent — server-side deploy/rollback script.
# Triggered by GH Actions via SSH; pinned by authorized_keys command=.
# Reads target commit from $SSH_ORIGINAL_COMMAND (defaults to origin/main).

set -euo pipefail

REPO_DIR="/opt/server_agent"
ENV_FILE="/etc/server-agent/agent.env"
LOCK_FILE="${REPO_DIR}/.deploy.lock"
HEALTH_RETRIES=10
HEALTH_DELAY_SEC=1

log() { echo "[deploy-agent] $*"; }

# Single-instance lock — bail out fast on concurrent deploy
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  log "another deploy in progress, exiting"
  exit 75
fi

# Load service env so PORT matches what the running service uses
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi
PORT="${PORT:-8080}"

cd "${REPO_DIR}"

RECORD_OLD_SHA="$(git rev-parse HEAD)"
TARGET_REF="${SSH_ORIGINAL_COMMAND:-origin/main}"
log "old=${RECORD_OLD_SHA} target=${TARGET_REF}"

deploy_commit() {
  local ref="$1"
  log "fetching"
  git fetch --quiet origin main
  log "checking out ${ref}"
  git reset --hard "${ref}"
  log "npm ci"
  npm ci --no-audit --no-fund
  log "npm run build"
  npm run build
  log "systemctl restart server-agent"
  sudo /bin/systemctl restart server-agent
}

health_ok() {
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
      return 0
    fi
    sleep "${HEALTH_DELAY_SEC}"
  done
  return 1
}

# === Forward roll ===
deploy_commit "${TARGET_REF}"
if health_ok; then
  log "deploy ok @ $(git rev-parse --short HEAD)"
  exit 0
fi
log "health check failed after deploying ${TARGET_REF}"

# === Rollback ===
log "rolling back to ${RECORD_OLD_SHA}"
deploy_commit "${RECORD_OLD_SHA}"
if health_ok; then
  log "rolled back to ${RECORD_OLD_SHA}; failing CI to alert"
  exit 1
fi

log "rollback also failed; service may be broken"
exit 2
