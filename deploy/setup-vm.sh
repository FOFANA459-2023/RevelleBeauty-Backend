#!/usr/bin/env bash
# Provision a fresh Oracle Cloud VM (Ubuntu, ARM or x86) to run the API.
#
#   curl -fsSL https://raw.githubusercontent.com/FOFANA459-2023/RevelleBeauty-Backend/main/deploy/setup-vm.sh | bash
#
# Idempotent: safe to re-run.

set -euo pipefail

REPO="https://github.com/FOFANA459-2023/RevelleBeauty-Backend.git"
APP_DIR="$HOME/revelle-api"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }

log "Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "NOTE: log out and back in for group membership to apply,"
  echo "      or prefix the compose commands below with sudo."
fi

log "Cloning / updating the repo"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

log "Preparing environment file"
if [ ! -f "$APP_DIR/deploy/.env" ]; then
  cp "$APP_DIR/deploy/.env.example" "$APP_DIR/deploy/.env"
  chmod 600 "$APP_DIR/deploy/.env"
  echo "Created deploy/.env — fill in the secrets, then run:"
  echo "  cd $APP_DIR/deploy && docker compose up -d --build"
  exit 0
fi

log "Starting"
cd "$APP_DIR/deploy"
docker compose up -d --build
docker compose ps

cat <<'EOF'

Done. Useful commands:
  docker compose logs -f api        # follow API logs
  docker compose restart api        # restart after an env change
  git pull && docker compose up -d --build   # deploy a new version

EOF
