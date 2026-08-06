#!/usr/bin/env bash
# Provision an Oracle Cloud VM to run the API.
# Works on Ubuntu/Debian and Oracle Linux/RHEL, x86_64 and ARM.
#
#   curl -fsSL https://raw.githubusercontent.com/FOFANA459-2023/RevelleBeauty-Backend/main/deploy/setup-vm.sh | bash
#
# Idempotent: safe to re-run.

set -euo pipefail

REPO="https://github.com/FOFANA459-2023/RevelleBeauty-Backend.git"
APP_DIR="$HOME/revelle-api"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
warn() { printf '\n\033[1;31m!!  %s\033[0m\n' "$1"; }

# ── Swap: the 1 GB Always Free shape (E2.1.Micro) cannot complete the Docker
# build without it — npm and tsc get OOM-killed. Harmless on larger shapes.
TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
log "Detected ${TOTAL_MB}MB RAM"
if [ "$TOTAL_MB" -lt 2048 ] && [ ! -f /swapfile ]; then
  log "Small instance — creating a 2GB swap file so the build does not OOM"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# ── Docker ───────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sudo sh
  elif command -v dnf >/dev/null 2>&1; then
    # Oracle Linux / RHEL: the convenience script does not support OL, so use
    # the CentOS repo, which is ABI-compatible.
    sudo dnf -y install dnf-plugins-core
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo systemctl enable --now docker
  else
    warn "Unsupported distro — install Docker manually, then re-run this script."
    exit 1
  fi
  sudo usermod -aG docker "$USER"
  NEW_GROUP=1
fi

# ── Repo ─────────────────────────────────────────────────────────────
log "Fetching the application"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  command -v git >/dev/null 2>&1 || {
    (command -v apt-get >/dev/null && sudo apt-get update -qq && sudo apt-get install -y git) ||
      sudo dnf -y install git
  }
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

# ── Environment ──────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/deploy/.env" ]; then
  cp "$APP_DIR/deploy/.env.example" "$APP_DIR/deploy/.env"
  chmod 600 "$APP_DIR/deploy/.env"
  log "Created deploy/.env — fill in the secrets, then start the app:"
  cat <<EOF

  nano $APP_DIR/deploy/.env
  cd $APP_DIR/deploy && docker compose up -d --build

EOF
  [ "${NEW_GROUP:-0}" = "1" ] && warn "Log out and back in first (docker group), or use sudo."
  exit 0
fi

log "Starting the API"
cd "$APP_DIR/deploy"
docker compose up -d --build
docker compose ps

cat <<'EOF'

Useful commands:
  docker compose logs -f api                  # follow logs
  docker compose restart api                  # after editing .env
  git -C ~/revelle-api pull && docker compose up -d --build   # deploy update
  curl -s localhost:4000/api/health           # health check

EOF
