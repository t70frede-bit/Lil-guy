// Lil guy's world on Cloudflare: serves the page and holds his latest state.
//   GET  /       the world page
//   GET  /state  his latest state as JSON (public, read only)
//   POST /state  his server sends a new state. The first token ever used is remembered
//                (only its hash is stored); after that only that token is accepted.
//   POST /assets his server sends the page files (index.html, app.js, world.json) from its copy
//                of the repo, so a normal server update also updates this page. Same token as /state,
//                and only once that token is known. Until then the copies bundled here are served.
//                It also sends his home screen icons (world/icons/*.png) as base64.
//   GET  /manifest.webmanifest  the home screen app: name, colours and his face as the icon
//   GET  /apple-touch-icon.png, /icon-192.png, /icon-512.png  the icons, from the last /assets push
import PAGE from "./index.html";
import APP from "./app.js";
import WORLD from "./world.json";

const MAX_BYTES = 64 * 1024;
const MAX_ASSET_BYTES = 512 * 1024;
const BUNDLED = { "index.html": PAGE, "app.js": APP, "world.json": WORLD };
const TYPES = { "index.html": "text/html", "app.js": "text/javascript", "world.json": "application/json" };
const ICONS = ["apple-touch-icon.png", "icon-192.png", "icon-512.png"];
const MANIFEST = JSON.stringify({
  name: "Lil guy's world", short_name: "Lil guy", id: "/", start_url: "/", scope: "/",
  display: "standalone", background_color: "#ead7c3", theme_color: "#ead7c3",
  description: "A small creature with needs, moods and a lot of questions, live.",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

// Page files pushed by his server, cached in memory for a minute to save KV reads.
let assets = null, assetsAt = 0;
async function asset(env, name) {
  if (!assets || Date.now() - assetsAt > 60_000) {
    try { assets = JSON.parse((await env.LILGUY.get("assets")) ?? "{}"); } catch { assets = {}; }
    assetsAt = Date.now();
  }
  return typeof assets[name] === "string" ? assets[name] : BUNDLED[name];
}
async function icon(env, name) {
  await asset(env, "index.html"); // refreshes the cache
  const b64 = assets.icons?.[name];
  if (typeof b64 !== "string") return null;
  try { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch { return null; }
}
const json = (body, status = 200) => new Response(body, {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    if (pathname === "/state") {
      if (req.method === "GET" || req.method === "HEAD") {
        return json((await env.LILGUY.get("state")) ?? "null");
      }
      if (req.method === "POST") {
        const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (token.length < 32) return json('{"error":"missing token"}', 401);
        const hash = await sha256(token);
        const owner = await env.LILGUY.get("owner");
        if (owner && owner !== hash) return json('{"error":"wrong token"}', 403);
        const body = await req.text();
        if (body.length > MAX_BYTES) return json('{"error":"too big"}', 413);
        try { const s = JSON.parse(body); if (!s || typeof s !== "object" || !s.needs) throw 0; }
        catch { return json('{"error":"not a lil guy state"}', 400); }
        if (!owner) await env.LILGUY.put("owner", hash);
        await env.LILGUY.put("state", body);
        return json('{"ok":true}');
      }
      return json('{"error":"method not allowed"}', 405);
    }

    if (pathname === "/assets" && req.method === "POST") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const owner = await env.LILGUY.get("owner");
      if (!owner || token.length < 32 || owner !== await sha256(token)) return json('{"error":"wrong token"}', 403);
      const body = await req.text();
      if (body.length > MAX_ASSET_BYTES) return json('{"error":"too big"}', 413);
      let files;
      try { files = JSON.parse(body); } catch { return json('{"error":"bad json"}', 400); }
      const keep = {};
      for (const name of Object.keys(TYPES)) if (typeof files?.[name] === "string" && files[name].length > 0) keep[name] = files[name];
      const icons = {};
      for (const name of ICONS) if (typeof files?.icons?.[name] === "string" && /^[A-Za-z0-9+/=]+$/.test(files.icons[name])) icons[name] = files.icons[name];
      if (Object.keys(icons).length) keep.icons = icons;
      if (keep["world.json"]) { try { JSON.parse(keep["world.json"]); } catch { return json('{"error":"bad world.json"}', 400); } }
      await env.LILGUY.put("assets", JSON.stringify(keep));
      assets = keep; assetsAt = Date.now();
      return json(JSON.stringify({ ok: true, files: Object.keys(keep) }));
    }

    if (pathname === "/manifest.webmanifest") {
      return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    const iconName = pathname === "/apple-touch-icon-precomposed.png" ? "apple-touch-icon.png" : pathname.slice(1);
    if (ICONS.includes(iconName)) {
      const bytes = await icon(env, iconName);
      if (bytes) return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
      return new Response("No icon yet", { status: 404 });
    }

    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    if (TYPES[name]) {
      return new Response(await asset(env, name), {
        headers: { "content-type": TYPES[name] + "; charset=utf-8", "cache-control": "public, max-age=60" },
      });
    }
    return new Response("Not here. Lil guy lives at /", { status: 404 });
  },
};
