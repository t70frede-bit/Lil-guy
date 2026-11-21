// Sends a public snapshot of lil guy to his world page (lilguy.gokkehub.com).
// Only what the page needs: no chat with Frederik, no Telegram details.

import { mood, shape } from "./needs.js";
import { findObject } from "./world.js";
import type { State } from "./state.js";

const PRIVATE = /^(Frederik said|Said to Frederik)/i;
const MIN_GAP_MS = 90_000; // keeps us well inside Cloudflare's free daily write limit

export function snapshot(s: State, tickSeconds: number) {
  const m = mood(s.needs, s.sleeping);
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
