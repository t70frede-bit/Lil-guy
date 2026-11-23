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
//   POST /private   his server sends his private history (chats with Frederik, emails) and the hash of
//                   Frederik's secret key. Same token as /state.
//   GET  /private   the page asks for it with Frederik's key (x-key header); anyone else gets 403.
//
// His email (lilguy@gokkehub.com), through Cloudflare Email Routing:
//   email()          a new email for him: it waits here for his server, which shows Frederik on Telegram.
//                    If FORWARD_TO is set, a copy is also forwarded there (optional).
//   GET  /mail       his server picks up waiting emails (raw), plus who his computer may send to.
//   POST /mail/done  his server got them: { ids }, they are deleted here.
//   POST /mail/send  his server sends an email from his address: { to, subject, text }.
//   All three need the same token as /state. Settings (set on the Worker, not in the repo):
//   MAIL_ADDRESS (his address), FORWARD_TO (optional: an inbox to forward copies to, must be verified),
//   MAIL_ALLOWED_TO (comma list of addresses he may write to; empty = anyone the EMAIL binding allows).
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

const MAX_MAIL_BYTES = 200 * 1024;
const MAX_PRIVATE_BYTES = 512 * 1024;
const MAX_WAITING_MAIL = 50;
const MAX_SENT_PER_DAY = 5;

async function isOwner(req, env) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const owner = await env.LILGUY.get("owner");
  return !!owner && token.length >= 32 && owner === await sha256(token);
}
const allowedTo = env => (env.MAIL_ALLOWED_TO ?? "").split(",").map(a => a.trim().toLowerCase()).filter(Boolean);
const mailAddress = env => (env.MAIL_ADDRESS ?? "lilguy@gokkehub.com").toLowerCase();

async function handleMail(req, env, pathname) {
  if (!env.MAIL_ADDRESS) return json('{"error":"no mail here yet"}', 404);
  if (!await isOwner(req, env)) return json('{"error":"wrong token"}', 403);
  if (pathname === "/mail" && req.method === "GET") {
    const list = await env.LILGUY.list({ prefix: "mail:", limit: 10 });
    const messages = [];
    for (const k of list.keys) {
      const v = await env.LILGUY.get(k.name);
      if (!v) continue;
      try { messages.push({ id: k.name, ...JSON.parse(v) }); } catch { await env.LILGUY.delete(k.name); }
    }
    return json(JSON.stringify({ address: mailAddress(env), canSendTo: env.EMAIL ? allowedTo(env) : [], messages }));
  }
  if (pathname === "/mail/done" && req.method === "POST") {
    let ids;
    try { ids = (await req.json()).ids; } catch { return json('{"error":"bad json"}', 400); }
    if (!Array.isArray(ids)) return json('{"error":"ids needed"}', 400);
    for (const id of ids.slice(0, 50)) if (typeof id === "string" && id.startsWith("mail:")) await env.LILGUY.delete(id);
    return json('{"ok":true}');
  }
  if (pathname === "/mail/send" && req.method === "POST") {
    if (!env.EMAIL) return json('{"error":"sending is not set up"}', 503);
    let m;
    try { m = await req.json(); } catch { return json('{"error":"bad json"}', 400); }
    const to = String(m?.to ?? "").trim().toLowerCase();
    const subject = String(m?.subject ?? "").replace(/[\r\n]+/g, " ").slice(0, 120);
    const text = String(m?.text ?? "").slice(0, 2000);
    if (!/^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(to) || !text) return json('{"error":"bad email"}', 400);
    const allowed = allowedTo(env);
    if (allowed.length && !allowed.includes(to)) return json('{"error":"his computer cannot send to that address"}', 403);
    const day = new Date().toISOString().slice(0, 10);
    const count = Number(await env.LILGUY.get(`sent:${day}`) ?? 0);
    if (count >= MAX_SENT_PER_DAY) return json('{"error":"enough emails today"}', 429);
    await env.LILGUY.put(`sent:${day}`, String(count + 1), { expirationTtl: 3 * 86400 });
    try {
      await env.EMAIL.send({ from: { email: mailAddress(env), name: "Lil guy" }, to, subject: subject || "Hello from lil guy", text });
    } catch (e) {
      return json(JSON.stringify({ error: String(e?.message ?? e).slice(0, 200) }), 502);
    }
    return json('{"ok":true}');
  }
  return json('{"error":"method not allowed"}', 405);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  // A new email for lil guy. Frederik always gets a copy; his server picks up the other one.
  async email(message, env) {
    if (!env.MAIL_ADDRESS || message.to.toLowerCase() !== mailAddress(env)) { message.setReject("Unknown address"); return; }
    let raw = "";
    if (message.rawSize <= MAX_MAIL_BYTES) raw = await new Response(message.raw).text();
    else raw = `Subject: ${(message.headers.get("subject") ?? "").slice(0, 200)}\r\nFrom: ${message.from}\r\n\r\n(This email was too big for his little computer.)`;
    if (env.FORWARD_TO) { try { await message.forward(env.FORWARD_TO); } catch (e) { console.log("forward failed", String(e)); } }
    const waiting = await env.LILGUY.list({ prefix: "mail:", limit: MAX_WAITING_MAIL });
    if (waiting.keys.length >= MAX_WAITING_MAIL) return; // his server is not picking up; Frederik still has his copy
    const id = `mail:${Date.now().toString().padStart(15, "0")}:${crypto.randomUUID().slice(0, 8)}`;
    await env.LILGUY.put(id, JSON.stringify({ from: message.from, raw, at: new Date().toISOString() }), { expirationTtl: 30 * 86400 });
  },

  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    if (pathname === "/mail" || pathname.startsWith("/mail/")) return handleMail(req, env, pathname);

    if (pathname === "/private") {
      if (req.method === "POST") {
        if (!await isOwner(req, env)) return json('{"error":"wrong token"}', 403);
        const body = await req.text();
        if (body.length > MAX_PRIVATE_BYTES) return json('{"error":"too big"}', 413);
        try { const p = JSON.parse(body); if (!/^[0-9a-f]{64}$/.test(p?.keyHash) || !Array.isArray(p.log)) throw 0; }
        catch { return json('{"error":"bad private history"}', 400); }
        await env.LILGUY.put("private", body);
        return json('{"ok":true}');
      }
      if (req.method === "GET") {
        const key = req.headers.get("x-key") ?? "";
        const stored = await env.LILGUY.get("private");
        if (!stored || key.length < 20) return json('{"error":"no"}', 403);
        let p; try { p = JSON.parse(stored); } catch { return json('{"error":"no"}', 403); }
        if (await sha256(key) !== p.keyHash) return json('{"error":"no"}', 403);
        return json(JSON.stringify({ log: p.log }));
      }
      return json('{"error":"method not allowed"}', 405);
    }

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
