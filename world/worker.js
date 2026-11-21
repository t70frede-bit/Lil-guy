// Lil guy's world on Cloudflare: serves the page and holds his latest state.
//   GET  /       the world page
//   GET  /state  his latest state as JSON (public, read only)
//   POST /state  his server sends a new state. The first token ever used is remembered
//                (only its hash is stored); after that only that token is accepted.
import PAGE from "./index.html";
import APP from "./app.js";
import WORLD from "./world.json";

const MAX_BYTES = 64 * 1024;
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

    if (pathname === "/" || pathname === "/index.html") {
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" },
      });
    }
    if (pathname === "/app.js") {
      return new Response(APP, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
    if (pathname === "/world.json") {
      return new Response(WORLD, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
    return new Response("Not here. Lil guy lives at /", { status: 404 });
  },
};
