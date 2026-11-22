# Lil guy's world

The live page at https://lilguy.gokkehub.com. A small Cloudflare Worker (`worker.js`) serves
the page (`index.html`, a three.js room) and keeps his latest state in one KV namespace.

- His server (`src/publish.ts`) POSTs a public snapshot to `/state` after each tick, at most every 90 s.
  It never includes his chat with Frederik.
- The page reads `/state` every 20 s.
- When the server starts, it POSTs `index.html`, `app.js` and `world.json` from its copy of the repo to `/assets`
  (same token). The Worker serves those instead of its bundled copies, so a normal server update also updates
  the page. Only the Worker itself (`worker.js`) still needs a deploy when it changes.
- The home screen app: `/manifest.webmanifest` (in `worker.js`) plus his face icons in `icons/`. The server sends
  the PNGs with the page files (as base64). To change the icon, edit `icons/icon.svg` and render it to
  `apple-touch-icon.png` (180), `icon-192.png` and `icon-512.png`. Keep him inside the middle 80% (maskable safe zone).
- The first token ever used to POST is remembered (as a hash). The installer makes that token
  (`WORLD_TOKEN` in `/opt/lil-guy/.env`). To start over with a new token, delete the `owner` key in the KV namespace.

Deploy: `npx wrangler deploy` from this folder, or the manual "Deploy world page" GitHub Action
(needs the `CLOUDFLARE_API_TOKEN` secret). It only claims the `lilguy.gokkehub.com` custom domain.
The KV namespace is `lil-guy-world` (id in `wrangler.toml`).
