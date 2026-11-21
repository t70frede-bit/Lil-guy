#!/usr/bin/env bash
# Installs lil guy on a fresh Ubuntu server (tested for 24.04 and 26.04). Run as root:
#   bash install.sh
# It asks for the GitHub token (only if the repo is private), the Telegram bot token
# and the Anthropic API key. Keys are typed in hidden and stored only in /opt/lil-guy/.env.
set -euo pipefail

REPO="t70frede-bit/Lil-guy"
DIR=/opt/lil-guy

if [ "$(id -u)" -ne 0 ]; then echo "Please run as root."; exit 1; fi

echo "== 1/5 Installing git and Node.js =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }
if ! node_ok; then apt-get install -y nodejs npm || true; fi
if ! node_ok; then
  apt-get remove -y nodejs npm || true
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node_ok || { echo "Could not install Node.js 22 or newer."; exit 1; }
command -v npm >/dev/null || apt-get install -y npm
echo "Node $(node --version)"

echo "== 2/5 Getting lil guy's code =="
id lilguy >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin lilguy
export GIT_TERMINAL_PROMPT=0
git config --global --add safe.directory "$DIR"
ask_token() { echo "The repo is private. Paste a GitHub token with read access to $REPO (hidden):"; read -rs GH_TOKEN; echo; }
if [ -d "$DIR/.git" ]; then
  if ! git -C "$DIR" pull --ff-only; then
    ask_token
    git -C "$DIR" pull --ff-only "https://x-access-token:${GH_TOKEN}@github.com/$REPO" main
  fi
else
  if git ls-remote "https://github.com/$REPO" >/dev/null 2>&1; then
    git clone "https://github.com/$REPO" "$DIR"
  else
    ask_token
    git clone "https://x-access-token:${GH_TOKEN}@github.com/$REPO" "$DIR"
    git -C "$DIR" remote set-url origin "https://github.com/$REPO"
  fi
fi
cd "$DIR"

echo "== 3/5 Building =="
npm ci
npm run build
npm test

echo "== 4/5 Keys =="
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Paste the Telegram bot token from @BotFather (hidden), then press Enter:"
  read -rs TG; echo
  echo "Paste the Anthropic API key (hidden), then press Enter:"
  read -rs AK; echo
  sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${TG}|; s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${AK}|" .env
fi
chmod 600 .env
mkdir -p data
chown -R lilguy:lilguy "$DIR"

echo "== 5/5 Starting lil guy =="
sed "s|/usr/bin/node|$(command -v node)|" deploy/lilguy.service > /etc/systemd/system/lilguy.service
systemctl daemon-reload
systemctl enable --now lilguy
sleep 3
systemctl --no-pager status lilguy | head -5
echo
echo "Done. Now open Telegram and send /start to your bot."
echo "Watch his diary with: journalctl -u lilguy -f"
