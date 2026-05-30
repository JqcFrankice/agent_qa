#!/usr/bin/env bash
# bootstrap-server — one-shot server initializer.
# Run as root on the Aliyun ECS the FIRST time. Idempotent on re-runs.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/JqcFrankice/agent_qa.git}"
REPO_DIR="/opt/server_agent"
AGENT_USER="agent"
ENV_DIR="/etc/server-agent"
ENV_FILE="${ENV_DIR}/agent.env"
DB_DIR="/var/lib/server-agent/db"
BACKUP_DIR="${DB_DIR}/backups"
DEPLOY_BIN="/usr/local/bin/deploy-agent"
UNIT_FILE="/etc/systemd/system/server-agent.service"
CADDY_FILE="/etc/caddy/Caddyfile"
SUDOERS_FILE="/etc/sudoers.d/server-agent"

log() { echo "[bootstrap] $*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi

if ! id -u "${AGENT_USER}" >/dev/null 2>&1; then
  log "creating user ${AGENT_USER}"
  useradd -m -s /bin/bash "${AGENT_USER}"
fi
install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0700 "/home/${AGENT_USER}/.ssh"
touch "/home/${AGENT_USER}/.ssh/authorized_keys"
chown "${AGENT_USER}:${AGENT_USER}" "/home/${AGENT_USER}/.ssh/authorized_keys"
chmod 0600 "/home/${AGENT_USER}/.ssh/authorized_keys"

log "installing apt packages"
apt-get update
apt-get install -y caddy sqlite3

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  log "cloning ${REPO_URL} into ${REPO_DIR}"
  install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0755 "${REPO_DIR}"
  sudo -u "${AGENT_USER}" git clone "${REPO_URL}" "${REPO_DIR}"
else
  log "repo already present at ${REPO_DIR}; fetching latest main"
  sudo -u "${AGENT_USER}" git -C "${REPO_DIR}" fetch origin main
  sudo -u "${AGENT_USER}" git -C "${REPO_DIR}" reset --hard origin/main
fi

log "preparing database directories"
install -d -o "${AGENT_USER}" -g "${AGENT_USER}" -m 0750 "${DB_DIR}" "${BACKUP_DIR}"

log "installing ${DEPLOY_BIN}"
install -o root -g root -m 0755 "${REPO_DIR}/scripts/deploy-agent.sh" "${DEPLOY_BIN}"

log "installing ${UNIT_FILE}"
install -o root -g root -m 0644 "${REPO_DIR}/deploy/server-agent.service" "${UNIT_FILE}"
systemctl daemon-reload
systemd-analyze verify "${UNIT_FILE}"

log "installing ${CADDY_FILE}"
install -o root -g root -m 0644 "${REPO_DIR}/deploy/Caddyfile" "${CADDY_FILE}"
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

log "installing ${SUDOERS_FILE}"
cat >"${SUDOERS_FILE}" <<'SUDO'
agent ALL=(root) NOPASSWD: /bin/systemctl restart server-agent, /bin/systemctl status server-agent, /bin/systemctl reload caddy
SUDO
chmod 0440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}"

log "preparing ${ENV_DIR}"
install -d -o root -g "${AGENT_USER}" -m 0750 "${ENV_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  install -o root -g "${AGENT_USER}" -m 0640 "${REPO_DIR}/deploy/agent.env.example" "${ENV_FILE}"
  SESSION_SECRET="$(openssl rand -base64 32)"
  sed -i "s#^SESSION_COOKIE_SECRET=.*#SESSION_COOKIE_SECRET=${SESSION_SECRET}#" "${ENV_FILE}"
  log "wrote default ${ENV_FILE} with generated SESSION_COOKIE_SECRET"
else
  log "${ENV_FILE} already exists, leaving alone"
fi

log "installing database backup timer"
cat >/etc/systemd/system/server-agent-db-backup.service <<'UNIT'
[Unit]
Description=Backup server-agent SQLite database

[Service]
Type=oneshot
User=agent
Group=agent
ExecStart=/usr/bin/sqlite3 /var/lib/server-agent/db/main.sqlite ".backup '/var/lib/server-agent/db/backups/main-$(date +%%Y%%m%%d-%%H%%M%%S).sqlite'"
UNIT
cat >/etc/systemd/system/server-agent-db-backup.timer <<'UNIT'
[Unit]
Description=Daily server-agent SQLite backup

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now server-agent-db-backup.timer

log "running initial npm ci + migrate + build as ${AGENT_USER}"
# migrate gets agent.env (DB_PATH etc.) injected in a subshell so NODE_ENV does
# not leak into npm ci / build (which need devDependencies for tsc).
sudo -u "${AGENT_USER}" bash -c "cd '${REPO_DIR}' && npm ci --no-audit --no-fund && ( set -a; . '${ENV_FILE}'; set +a; npm run db:migrate --workspace=@server-agent/server ) && npm run build --workspaces --if-present"

log "enabling and starting server-agent.service"
systemctl enable --now server-agent.service
sleep 2
systemctl --no-pager status server-agent.service || true

cat <<'POST'

============================================================
bootstrap complete. MANUAL FOLLOW-UP STILL REQUIRED:

  1. Aliyun console → ECS → security group → allow inbound TCP 80 and 443, remove public 8080.
  2. Append your GitHub Actions deploy public key to:
        /home/agent/.ssh/authorized_keys
     prefixed with:
        command="/usr/local/bin/deploy-agent",no-pty,no-port-forwarding,no-X11-forwarding
  3. /etc/server-agent/agent.env 已生成 SESSION_COOKIE_SECRET（无需额外密钥）。
  4. Verify from outside:
        curl -I http://aicoolyun.vip
        curl https://aicoolyun.vip/api/health
============================================================
POST
