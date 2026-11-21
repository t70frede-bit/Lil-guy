// Lil guy's world: his house, the empty land outside, and whatever gets built there.
// The map lives in world/world.json, shared with the web page. The AI can only choose
// moves from MOVE_TYPES; anything else is refused by code.

import WORLD from "../world/world.json" with { type: "json" };
import { clamp, type Needs } from "./needs.js";

export interface Action { verb: string; from?: string; to?: string; effect?: Partial<Needs>; line: string }
export interface WorldObject {
  id: string; name: string; area: string; kind: string; state: string; desc: string; actions: Action[];
  /** Set when the object belongs to something that was built after a wish. */
  built?: string;
}
export interface Buildable {
  id: string; name: string; keywords: string[]; meets: string; kind: string; desc: string;
  objects: Omit<WorldObject, "area" | "kind" | "built">[];
}
/** Something Frederik approved, now standing on a plot outside. */
export interface Built { id: string; name: string; kind: string; plot: number; at: string; buildable?: string }

export const AREAS = WORLD.areas as { id: string; name: string; desc: string }[];
const BASE = WORLD.objects as unknown as WorldObject[];
export const BUILDABLES = WORLD.buildables as unknown as Buildable[];
const CUSTOM = WORLD.custom as unknown as { kind: string; desc: string; actions: Action[] };
export const PLOTS = WORLD.plots.length;
/** What the wishmaster's free things (and Frederik's presents) become inside his house. */
interface GiftDef extends Omit<WorldObject, "area" | "built"> { item: string }
export const GIFTS = WORLD.gifts as unknown as GiftDef[];
const CUSTOM_GIFT = WORLD.customGift as unknown as { kind: string; desc: string; state: string; actions: Action[] };

/** The id a present gets in his house, matching the web page. */
export function giftId(item: string): string {
  return GIFTS.find(g => g.item === item)?.id ?? `gift-${words(item).replace(/^(a|an|some|the)\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}`;
}

/** Every place he can be next to: the house, outside, and everything built so far. */
export function objectsOf(s: { built: Built[]; items?: string[] }): WorldObject[] {
  const out = [...BASE];
  for (const item of s.items ?? []) {
    const g = GIFTS.find(x => x.item === item);
    if (g) out.push({ id: g.id, name: g.name, area: "home", kind: g.kind, state: g.state, desc: g.desc, actions: g.actions });
    else out.push({ id: giftId(item), name: item.replace(/^(a|an|some|the)\s+/i, ""), area: "home", kind: CUSTOM_GIFT.kind, state: CUSTOM_GIFT.state, desc: CUSTOM_GIFT.desc, actions: CUSTOM_GIFT.actions });
  }
  for (const b of s.built) {
    const def = BUILDABLES.find(x => x.id === b.buildable);
    if (def) for (const o of def.objects) out.push({ ...o, id: s.built.filter(x => x.buildable === def.id).indexOf(b) > 0 ? `${o.id}-${b.id}` : o.id, area: "outside", kind: def.kind, built: b.id });
    else out.push({ id: b.id, name: b.name, area: "outside", kind: CUSTOM.kind, state: "new", desc: CUSTOM.desc, actions: CUSTOM.actions, built: b.id });
  }
  return out;
}

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' -]/g, " ").trim();

export function findObject(s: { built: Built[]; items?: string[] }, text: string | undefined): WorldObject | undefined {
  if (!text) return undefined;
  const t = words(text);
  const all = objectsOf(s);
  return all.find(o => o.id === t || words(o.name) === t)
    ?? all.find(o => t.includes(words(o.name)) || t.includes(o.id))
    ?? all.find(o => words(o.name).includes(t))
    ?? (/\b(outside|field|grass|garden|yard)\b/.test(t) ? all.find(o => o.id === "field")
      : /\b(home|house|room|inside)\b/.test(t) ? all.find(o => o.id === "rug") : undefined);
}

export function stateOf(s: { objects: Record<string, string> }, o: WorldObject): string {
  return s.objects[o.id] ?? o.state;
}

export function availableActions(s: { objects: Record<string, string> }, o: WorldObject): Action[] {
  const st = stateOf(s, o);
  return o.actions.filter(a => !a.from || a.from === st);
}

export function findAction(s: { objects: Record<string, string> }, o: WorldObject, text: string | undefined): Action | undefined {
  const acts = availableActions(s, o);
  if (!text) return acts.length === 1 ? acts[0] : undefined;
  const t = words(text);
  return acts.find(a => words(a.verb) === t) ?? acts.find(a => t.includes(words(a.verb)) || words(a.verb).includes(t));
}

export function findBuildable(item: string): Buildable | undefined {
  const t = words(item);
  return BUILDABLES.find(b => b.keywords.some(k => new RegExp(`\\b${k}`).test(t)));
}

/** Does this wish sound like a place or thing to build in his world? */
export function isBuildWish(item: string): boolean {
  return !!findBuildable(item) || /\b(place|corner|room|house|hut|shop|studio|park|arena|stage|library|cafe|kitchen|tower|castle|playground|museum|gallery|workshop|club|spot|tent|shed|slide|swing|bridge)\b/.test(words(item));
}

export const MOVE_TYPES = [
  "wait",          // stay put and watch
  "go",            // go next to something (target = thing or "outside" / "home")
  "use",           // do something with a thing (target = thing, action = one of its actions)
  "look_closer",   // examine something where he is (target = thing)
  "try",           // try doing something new (target = short description)
  "rest",          // short rest
  "sleep",         // go to sleep until rested
  "wish",          // ask the wishmaster for something (item + need + reason)
  "message",       // send Frederik a message (text)
  "propose_project", // in the workshop: plan a project (item = name, kind, text = idea, steps, need). Frederik must approve it
  "work_on_project", // in the workshop: work on the next step of the approved project
] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export interface Move {
  type: MoveType;
  target?: string;
  action?: string;
  item?: string;
  need?: string;
  text?: string;
  kind?: string;
  steps?: string[];
}

/** How a move changes his needs before novelty rewards. */
export function moveEffect(type: MoveType, n: Needs): Needs {
  const e = { ...n };
  switch (type) {
    case "go": e.energy -= 0.04; break;
    case "use": e.energy -= 0.03; break;
    case "look_closer": e.energy -= 0.02; break;
    case "try": e.energy -= 0.05; e.fulfilled += 0.03; break;
    case "rest": e.energy += 0.06; e.curiosity += 0.02; break;
    case "message": e.company += 0.05; break;
    case "work_on_project": e.energy -= 0.06; break;
    default: break;
  }
  for (const k of Object.keys(e) as (keyof Needs)[]) e[k] = clamp(e[k]);
  return e;
}

/**
 * Novelty reward: the first time he does something, it feels great.
 * Each repeat of the same thing gives less, so exploring and trying beats repeating.
 */
export function noveltyReward(timesDone: number): number {
  return 0.25 / (1 + timesDone * 1.5);
}
