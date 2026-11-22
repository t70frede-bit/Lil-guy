#!/usr/bin/env bash
# Runs every few minutes from lilguy-update.timer. When main on GitHub has new commits,
# it runs install.sh, so merged changes go live without anyone pasting a command.
# Keys are already in /opt/lil-guy/.env, so nothing is asked.
set -euo pipefail
export HOME="${HOME:-/root}" GIT_TERMINAL_PROMPT=0
DIR="${LILGUY_DIR:-/opt/lil-guy}"
cd "$DIR"
git fetch -q origin main
NEW="$(git rev-parse origin/main)"
[ "$(git rev-parse HEAD)" = "$NEW" ] && exit 0
# If this exact version already failed to install, wait for a newer one instead of retrying
# (and messaging Frederik) every 5 minutes.
FAILED=/var/lib/lilguy-update-failed
[ -f "$FAILED" ] && [ "$(cat "$FAILED")" = "$NEW" ] && exit 0
echo "New code on main (${NEW:0:7}), updating."
if LILGUY_AUTO=1 bash "$DIR/deploy/install.sh" < /dev/null; then rm -f "$FAILED"; else echo "$NEW" > "$FAILED"; exit 1; fi
