// Sends a public snapshot of lil guy to his world page (lilguy.gokkehub.com).
// Only what the page needs: no chat with Frederik, no Telegram details.

import { readFileSync } from "node:fs";
import { shape } from "./needs.js";
import { findObject } from "./world.js";
import { publicSelf } from "./self.js";
import { moodOf, type State } from "./state.js";

const PRIVATE = /^(Frederik said|Said to Frederik)/i;
const MIN_GAP_MS = 90_000; // keeps us well inside Cloudflare's free daily write limit

export function snapshot(s: State, tickSeconds: number) {
  const m = moodOf(s);
  const thought = [...s.diary].reverse().find(d => d.text.startsWith("Thought: "));
  return {
    v: 1,
    at: new Date().toISOString(),
    tickSeconds,
    place: s.place,
    area: findObject(s, s.place)?.area ?? "home",
    objects: s.objects,
    built: s.built,
    last: s.last,
    uses: uses(s),
    wishes: s.pending.map(p => p.item),
    sleeping: s.sleeping,
    paused: s.paused,
    mood: m,
    shape: shape(m),
    needs: s.needs,
    items: s.items.slice(-30),
    thought: thought ? thought.text.slice("Thought: ".length, 300) : "",
    diary: s.diary.filter(d => !PRIVATE.test(d.text) && !d.text.startsWith("Thought: ")).slice(-15)
      .map(d => ({ at: d.at, text: d.text.slice(0, 240) })),
    highlights: (s.highlights ?? []).slice(-30),
    projects: (s.projects ?? []).slice(-10).map(p => ({
      title: p.title, kind: p.kind, idea: p.idea, status: p.status, steps: p.steps, done: p.pieces.length,
      tokens: { estimate: p.estimate.tokens, approved: p.budget, used: p.used }, dkk: { estimate: p.estimate.dkk, spent: p.spentDkk ?? 0 },
      latest: p.pieces.length ? p.pieces[p.pieces.length - 1].text.slice(0, 400) : "",
      friend: p.friend, at: p.at,
    })),
    secrets: s.secrets ?? {},
    wonder: s.wonder ? { day: s.wonder.day, text: s.wonder.text, answer: s.wonder.answer } : null,
    self: publicSelf(s),
    ticks: s.ticks,
  };
}

/** How many times he has done something with each thing, for the page's info cards. */
function uses(s: State): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.tried)) {
    const m = k.match(/^use:([^:]+):/);
    if (m) out[m[1]] = (out[m[1]] ?? 0) + v;
  }
  return out;
}

let lastSent = 0;
let failing = false;

export async function publish(s: State, url: string | undefined, token: string | undefined, tickSeconds: number) {
  if (!url || !token || Date.now() - lastSent < MIN_GAP_MS) return;
  lastSent = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/state`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(snapshot(s, tickSeconds)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (failing) console.log("World page reachable again.");
    failing = false;
  } catch (e) {
    if (!failing) console.error(`Could not update the world page: ${(e as Error).message}`);
    failing = true;
  }
}

let assetsSent = false;
let assetsNextTry = 0;

/**
 * Send the page files from this copy of the repo to the world page, once after each start.
 * That way `git pull && bash deploy/install.sh` on the server also updates lilguy.gokkehub.com.
 */
export async function publishAssets(url: string | undefined, token: string | undefined) {
  if (assetsSent || !url || !token || Date.now() < assetsNextTry) return;
  assetsNextTry = Date.now() + 3600_000; // on any failure, try again in an hour
  try {
    const dir = new URL("../../world/", import.meta.url);
    const files: Record<string, string> = {};
    for (const name of ["index.html", "app.js", "world.json"]) files[name] = readFileSync(new URL(name, dir), "utf8");
    const res = await fetch(`${url.replace(/\/$/, "")}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(files),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) { console.log("The world page does not take page files yet; will try again in an hour."); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    assetsSent = true;
    console.log("World page files updated.");
  } catch (e) {
    console.error(`Could not update the world page files: ${(e as Error).message}`);
  }
}
