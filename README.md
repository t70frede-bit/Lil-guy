# Lil guy

A very small creature who lives on a server, gets bored, lonely and feisty on his own, and talks to Frederik on Telegram. A wishmaster sits between them and decides what he can have.

## How he works

- **Needs** (energy, curiosity, company, feistiness, fulfilment) drift every tick in plain code. No AI.
- **Mood and shape** follow his needs: a ball when content or curious, a spiky ball when feisty, a cube when lonely, a droopy ball when sleepy.
- **Brain**: every few minutes Claude picks 1 to 3 moves from a fixed menu (go somewhere, look closer, try something, rest, sleep, wish, message Frederik). Anything outside the menu is ignored.
- **Rewards**: doing something for the first time feels wonderful. A repeat is worth less the more often he has done it, recovers a little over a day away from it, and never beats a first.
- **Secrets**: his world hides little secrets (world/world.json, `secrets`). Looking closer at a thing makes him notice one; finding it is the best feeling there is. Some lead to others, like a treasure map.
- **I wonder**: each morning (Danish time) he picks one thing to find out or try that day. It only counts as found out once he has actually done something new.
- **Wishmaster** (`src/wishmaster.ts`):
  - he may wish for anything he wants,
  - a free thing is granted on the spot,
  - anything that needs Frederik (company, real objects, money) is sent to Telegram with **Approve** and **Not now** buttons.
- **Workshop** (`src/workshop.ts`): a building outside where he works on his own projects, like designing a new friend, making up a game or writing a story.
  - He proposes a project with a small plan (2 to 8 steps). Code, not AI, works out the token estimate (with a 20% margin) and the price in DKK.
  - The wishmaster sends it to Telegram with **Approve** and **Not now**. Nothing starts before Frederik says yes, and a project must come from a real need.
  - An approved project can never use more tokens than approved. If it runs out, it stops and asks for more (**Give more** / **Stop it**).
  - One project at a time. A finished friend design moves into his world straight away (src/friends.ts): its kind, colours and little extras come from his own words, and it lives where he said (the windowsill, by the big stone...). He can visit, listen to and sit with his friends. Lil guy decides whether a friend has a mind of their own (src/mind.ts): if so, the wishmaster asks Frederik to approve a monthly token allowance (code-made estimate, hard cap); the friend then thinks every 20 minutes while he is awake and now and then says something to him.
- **Email** (`src/email.ts`): his own address, lilguy@gokkehub.com, on his little computer.
  - Cloudflare Email Routing hands his mail to the world page's Worker, and his server picks it up. Frederik sees every email in full on Telegram (links included, for confirm links); forwarding to an inbox is optional.
  - Emails are letters to read, never orders: links, addresses and long numbers are blanked, and account mail (codes, log-ins, money services) is never shown to him at all. Nothing from email goes on his public page.
  - He can write at most 3 emails a day, only to addresses his computer allows (on Cloudflare's free plan, addresses Frederik verified) or to people who wrote him a real letter. Frederik sees every email he sends.
  - He never signs up for anything himself. A wish to join something goes to Frederik, who signs up with lil guy's address.
- **His computer's history** (private): his chats with Frederik and the emails he sends and gets are kept on his computer. A **Computer** button on his page shows them, but only on a device that opened Frederik's private link (`/computer` on Telegram; `/newlink` makes a new one). Only the key's hash leaves the server; account mail stays hidden there too.
- **Limits**: at most 12 messages to Frederik a day; `/pause` stops him instantly.

Character sheet: `src/character.ts`. Places and moves: `src/world.ts`.

## Telegram commands

`/start` (first time only, makes you the owner), `/status`, `/diary`, `/projects`, `/me` (who he is, his theories and his goal in life), `/computer` (your private link to his chats and emails), `/newlink`, `/pause`, `/resume`. Any other text is a message to lil guy, and he answers.

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

With Claude Haiku 5.5 and a thought every 3 minutes, expect roughly 5 to 15 USD a month. Set a monthly spend limit in the Anthropic Console. Workshop projects are tiny on top of that: with Haiku 5.5 a 4-step project is estimated at about 15,000 tokens, roughly 0,03 kr.
