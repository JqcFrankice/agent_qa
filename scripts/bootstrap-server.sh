#!/usr/bin/env bash
# bootstrap-server — one-shot server initializer.
# Run as root on the Aliyun ECS the FIRST time. Idempotent on re-runs.
#
# What it does:
#   1. creates `agent` user + ~/.ssh dir
#   2. clones the repo into /opt/server_agent (or fetches if already there)
#   3. installs deploy-agent, systemd unit, sudoers fragment, env example
#   4. initial npm ci + build so the service can start cold
#   5. enables systemd unit
#
# What it does NOT do (manual steps, see README):
#   - opening Aliyun security group port
#   - placing the deploy public key into /home/agent/.ssh/authorized_keys
#   - filling /etc/server-agent/agent.env with real values

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/JqcFrankice/agent_qa.git}"
REPO_DIR="/opt/server_agent"
AGENT_USER="agent"
ENV_DIR="/etc/server-agent"
ENV_FILE="${ENV_DIR}/agent.env"
DEPLOY_BIN="/usr/local/bin/deploy-agent"
UNIT_FILE="/etc/systemd/system/server-agent.service"
SUDOERS_FILE="/etc/sudoers.d/server-agent"

log() { echo "[bootstrap] $*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi

# 1. agent user
if ! id -u "${AGENT_USER}" >/dev/null 2>&1; then
  log "creating user ${AGENT_USER}"
  useradd -m -s /bin/bash "${AGENT_USER}"
fi
install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0700 "/home/${AGENT_USER}/.ssh"
touch "/home/${AGENT_USER}/.ssh/authorized_keys"
chown "${AGENT_USER}:${AGENT_USER}" "/home/${AGENT_USER}/.ssh/authorized_keys"
chmod 0600 "/home/${AGENT_USER}/.ssh/authorized_keys"

# 2. clone or fetch repo
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  log "cloning ${REPO_URL} into ${REPO_DIR}"
  install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0755 "${REPO_DIR}"
  sudo -u "${AGENT_USER}" git clone "${REPO_URL}" "${REPO_DIR}"
else
  log "repo already present at ${REPO_DIR}; fetching latest main"
  sudo -u "${AGENT_USER}" git -C "${REPO_DIR}" fetch origin main
  sudo -u "${AGENT_USER}" git -C "${REPO_DIR}" reset --hard origin/main
fi

# 3a. deploy-agent
log "installing ${DEPLOY_BIN}"
install -o root -g root -m 0755 "${REPO_DIR}/scripts/deploy-agent.sh" "${DEPLOY_BIN}"

# 3b. systemd unit
log "installing ${UNIT_FILE}"
install -o root -g root -m 0644 "${REPO_DIR}/deploy/server-agent.service" "${UNIT_FILE}"
systemctl daemon-reload
systemd-analyze verify "${UNIT_FILE}"

# 3c. sudoers fragment
log "installing ${SUDOERS_FILE}"
cat >"${SUDOERS_FILE}" <<'SUDO'
agent ALL=(root) NOPASSWD: /bin/systemctl restart server-agent, /bin/systemctl status server-agent
SUDO
chmod 0440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}"

# 3d. env dir + example
log "preparing ${ENV_DIR}"
install -d -o root -g "${AGENT_USER}" -m 0750 "${ENV_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  install -o root -g "${AGENT_USER}" -m 0640 "${REPO_DIR}/deploy/agent.env.example" "${ENV_FILE}"
  log "wrote default ${ENV_FILE} — REVIEW AND EDIT IF NEEDED"
else
  log "${ENV_FILE} already exists, leaving alone"
fi

# 4. initial build as agent
log "running initial npm ci + build as ${AGENT_USER}"
sudo -u "${AGENT_USER}" bash -c "cd '${REPO_DIR}' && npm ci --no-audit --no-fund && npm run build"

# 5. enable + start
log "enabling and starting server-agent.service"
systemctl enable --now server-agent.service
sleep 2
systemctl --no-pager status server-agent.service || true

cat <<'POST'

============================================================
bootstrap complete. MANUAL FOLLOW-UP STILL REQUIRED:

  1. Aliyun console → ECS → security group → allow inbound TCP 8080
  2. Append your GitHub Actions deploy public key to:
        /home/agent/.ssh/authorized_keys
     prefixed with:
        command="/usr/local/bin/deploy-agent",no-pty,no-port-forwarding,no-X11-forwarding
  3. Verify from outside:
        curl http://<server-public-ip>:8080/health
============================================================
POST
