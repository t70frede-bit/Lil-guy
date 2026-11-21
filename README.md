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

## Put him on a server (Hetzner, Ubuntu 24.04 or 26.04)

**Easiest, no terminal:** when creating the server in Hetzner Cloud, open "Cloud config" and paste [deploy/hetzner-cloud-config.yaml](deploy/hetzner-cloud-config.yaml), with your Telegram token and Anthropic key filled in there. The server installs and starts lil guy at first boot (about 5 minutes); then send `/start` to your bot. The install log is at `/var/log/lilguy-install.log`.

**Or by hand over SSH:**


1. Create the server in Hetzner Cloud (Ubuntu 26.04, the cheapest size is plenty). Hetzner emails you the root password.
2. Connect from your own computer's terminal, so you can paste: `ssh root@YOUR_SERVER_IP` (Windows: PowerShell; Mac: Terminal). Type the emailed password; Hetzner then asks you to choose a new one.
3. Run the installer. If the repo is public:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/t70frede-bit/Lil-guy/main/deploy/install.sh -o install.sh && bash install.sh
   ```

   If the repo is private, make a fine-grained GitHub token with read-only Contents access to this repo first, then:

   ```bash
   read -rs T && curl -fsSL -H "Authorization: Bearer $T" https://raw.githubusercontent.com/t70frede-bit/Lil-guy/main/deploy/install.sh -o install.sh && bash install.sh
   ```

   (paste the token after the first line; it is hidden). The installer asks for the token again to download the code.
4. The installer installs Node.js, builds and tests lil guy, asks for your Telegram bot token and Anthropic key (hidden, stored only in `/opt/lil-guy/.env`), and starts him as a service.
5. Send `/start` to your bot on Telegram.

Useful later: `journalctl -u lilguy -f` (watch his diary), `systemctl restart lilguy`, and `bash /opt/lil-guy/deploy/install.sh` again to update to the newest code.

## Costs

With Claude Haiku 5.5 and a thought every 3 minutes, expect roughly 5 to 15 USD a month. Set a monthly spend limit in the Anthropic Console.
