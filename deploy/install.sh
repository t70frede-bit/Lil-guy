#!/usr/bin/env bash
# Installs lil guy on a fresh Ubuntu server (tested for 24.04 and 26.04). Run as root:
#   bash install.sh
# It asks for the GitHub token (only if the repo is private), the Telegram bot token
# and the Anthropic API key. Keys are typed in hidden and stored only in /opt/lil-guy/.env.
# For unattended installs (cloud-init), set GH_TOKEN, TELEGRAM_BOT_TOKEN and
# ANTHROPIC_API_KEY in the environment instead and nothing is asked.
set -euo pipefail
export HOME="${HOME:-/root}"

REPO="t70frede-bit/Lil-guy"
DIR="${LILGUY_DIR:-/opt/lil-guy}"
LOG=/var/log/lilguy-install.log

if [ "$(id -u)" -ne 0 ]; then echo "Please run as root."; exit 1; fi

# --- Progress reports on Telegram once the bot token is known ---
STEP="starting"
tg_token() { [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && { echo "$TELEGRAM_BOT_TOKEN"; return; }; [ -f "$DIR/.env" ] && grep -E '^TELEGRAM_BOT_TOKEN=' "$DIR/.env" | cut -d= -f2-; }
report() {
  echo "[$(date -u +%H:%M:%S)] $1"
  local t; t="$(tg_token || true)"; [ -z "$t" ] && return 0
  # Send to whoever has written to the bot (Frederik's /start). Does not consume the bot's messages.
  local ids; ids="$(curl -s "https://api.telegram.org/bot$t/getUpdates" | grep -oE '"chat":\{"id":-?[0-9]+' | grep -oE -- '-?[0-9]+$' | sort -u || true)"
  for id in $ids; do curl -s -o /dev/null "https://api.telegram.org/bot$t/sendMessage" --data-urlencode "chat_id=$id" --data-urlencode "text=Installer: $1" || true; done
}
on_error() {
  local tail_lines=""; [ -f "$LOG" ] && tail_lines="$(tail -n 12 "$LOG" | grep -v -e "${TELEGRAM_BOT_TOKEN:-@@}" -e "${ANTHROPIC_API_KEY:-@@}" -e "${GH_TOKEN:-@@}" || true)"
  report "FAILED during: $STEP. Last lines:
$tail_lines"
}
trap on_error ERR
APT="apt-get -o DPkg::Lock::Timeout=600"

STEP="installing git and Node.js"; report "Step 1/5: $STEP"
export DEBIAN_FRONTEND=noninteractive
$APT update -y
$APT install -y git curl ca-certificates
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }
if ! node_ok; then $APT install -y nodejs npm || true; fi
if ! node_ok; then
  $APT remove -y nodejs npm || true
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  $APT install -y nodejs
fi
node_ok || { echo "Could not install Node.js 22 or newer."; exit 1; }
command -v npm >/dev/null || $APT install -y npm
echo "Node $(node --version)"

STEP="getting lil guy's code"; report "Step 2/5: $STEP (Node $(node --version))"
id lilguy >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin lilguy
export GIT_TERMINAL_PROMPT=0
git config --global --add safe.directory "$DIR"
ask_token() { [ -n "${GH_TOKEN:-}" ] && return 0; echo "The repo is private. Paste a GitHub token with read access to $REPO (hidden):"; read -rs GH_TOKEN; echo; }
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

STEP="building and testing"; report "Step 3/5: $STEP"
npm ci
npm run build
npm test

STEP="saving the keys"; report "Step 4/5: $STEP"
[ -f .env ] || cp .env.example .env
clean() { printf '%s' "$1" | tr -d '[:space:]"'"'"; }
env_val() { sed -n "s/^$1=//p" .env | head -n 1; }
TG="$(clean "${TELEGRAM_BOT_TOKEN:-}")"; [ -n "$TG" ] || TG="$(clean "$(env_val TELEGRAM_BOT_TOKEN)")"
AK="$(clean "${ANTHROPIC_API_KEY:-}")"; [ -n "$AK" ] || AK="$(clean "$(env_val ANTHROPIC_API_KEY)")"
if [ -z "$TG" ]; then
  [ -t 0 ] || { echo "No Telegram bot token was given."; false; }
  echo "Paste the Telegram bot token from @BotFather (hidden), then press Enter:"; read -rs TG; echo; TG="$(clean "$TG")"
fi
if [ -z "$AK" ]; then
  [ -t 0 ] || { echo "No Anthropic API key was given."; false; }
  echo "Paste the Anthropic API key (hidden), then press Enter:"; read -rs AK; echo; AK="$(clean "$AK")"
fi
case "$TG" in *:*) ;; *) echo "That Telegram token looks wrong (it should contain a colon, like 123456:ABC...)."; false ;; esac
case "$AK" in sk-ant-*) ;; *) echo "That Anthropic key looks wrong (it should start with sk-ant-)."; false ;; esac
sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${TG}|; s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${AK}|" .env
TELEGRAM_BOT_TOKEN="$TG"
# Token for his world page (lilguy.gokkehub.com). Made once here, never shown.
grep -q '^WORLD_URL=' .env || echo 'WORLD_URL=https://lilguy.gokkehub.com' >> .env
if [ -z "$(env_val WORLD_TOKEN)" ]; then
  WT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  if grep -q '^WORLD_TOKEN=' .env; then sed -i "s|^WORLD_TOKEN=.*|WORLD_TOKEN=${WT}|" .env; else echo "WORLD_TOKEN=${WT}" >> .env; fi
fi
chmod 600 .env
mkdir -p data
chown -R lilguy:lilguy "$DIR"

STEP="starting lil guy"; report "Step 5/5: $STEP"
sed "s|/usr/bin/node|$(command -v node)|" deploy/lilguy.service > /etc/systemd/system/lilguy.service
systemctl daemon-reload
systemctl enable lilguy
systemctl restart lilguy
sleep 5
if systemctl is-active --quiet lilguy; then
  report "Done. Lil guy is running. Send /start to the bot if you have not yet."
else
  STEP="lil guy did not stay running"; on_error; exit 1
fi
echo "Watch his diary with: journalctl -u lilguy -f"
