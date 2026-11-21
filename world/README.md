# Lil guy's world

The live page at https://lilguy.gokkehub.com. A small Cloudflare Worker (`worker.js`) serves
the page (`index.html`, a three.js room) and keeps his latest state in one KV namespace.

- His server (`src/publish.ts`) POSTs a public snapshot to `/state` after each tick, at most every 90 s.
  It never includes his chat with Frederik.
- The page reads `/state` every 20 s.
- The first token ever used to POST is remembered (as a hash). The installer makes that token
  (`WORLD_TOKEN` in `/opt/lil-guy/.env`). To start over with a new token, delete the `owner` key in the KV namespace.

Deploy: `npx wrangler deploy` from this folder. It only claims the `lilguy.gokkehub.com` custom domain.
