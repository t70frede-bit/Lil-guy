# Lil guy

A very small creature who lives on a server, gets bored, lonely and feisty on his own, and talks to Frederik on Telegram. A wishmaster sits between them and decides what he can have.

## How he works

- **Needs** (energy, curiosity, company, feistiness, fulfilment) drift every tick in plain code. No AI.
- **Mood and shape** follow his needs: a ball when content or curious, a spiky ball when feisty, a cube when lonely, a droopy ball when sleepy.
- **Brain**: every few minutes Claude picks 1 to 3 moves from a fixed menu (go somewhere, look closer, try something, rest, sleep, wish, message Frederik). Anything outside the menu is ignored.
- **Rewards**: doing something for the first time feels great; repeating the same thing makes him bored, so he keeps exploring.
- **Wishmaster** (`src/wishmaster.ts`):
  - a wish with no real need behind it is declined,
  - a free thing that meets a real need is granted on the spot,
  - anything that needs Frederik (company, real objects, money) is sent to Telegram with **Approve** and **Not now** buttons.
- **Limits**: at most 12 messages to Frederik a day; `/pause` stops him instantly.

Character sheet: `src/character.ts`. Places and moves: `src/world.ts`.

## Telegram commands

`/start` (first time only, makes you the owner), `/status`, `/diary`, `/pause`, `/resume`. Any other text is a message to lil guy, and he answers.

## Run it locally

```bash
npm install
npm test                 # rules and wishmaster tests, no keys needed
DRY_RUN=1 TICK_SECONDS=5 npm run dev   # runs with simple rules, prints to the console
```

Add `TELEGRAM_BOT_TOKEN` to talk to him on Telegram, and `ANTHROPIC_API_KEY` (with `DRY_RUN=0`) to give him a real brain.

## Put him on a server (Hetzner, Ubuntu 24.04)

```bash
# on the server, as root
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs git
useradd --system --create-home lilguy
git clone https://github.com/t70frede-bit/lil-guy /opt/lil-guy && cd /opt/lil-guy
npm ci && npm run build
cp .env.example .env && nano .env      # paste the keys here, on the server only
chmod 600 .env && chown -R lilguy:lilguy /opt/lil-guy
cp deploy/lilguy.service /etc/systemd/system/ && systemctl enable --now lilguy
journalctl -u lilguy -f                # watch his diary
```

Then send `/start` to your bot on Telegram.

## Costs

With Claude Haiku 5.5 and a thought every 3 minutes, expect roughly 5 to 15 USD a month. Set a monthly spend limit in the Anthropic Console.
