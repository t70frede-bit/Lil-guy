// Lil guy's world: his house, the empty land outside, and whatever gets built there.
// The map lives in world/world.json, shared with the web page. The AI can only choose
// moves from MOVE_TYPES; anything else is refused by code.

import WORLD from "../world/world.json" with { type: "json" };
import { clamp, type Needs } from "./needs.js";

export interface Action {
  verb: string; from?: string; to?: string; effect?: Partial<Needs>; line: string;
  /** Set when this action is a secret he found, with the secret's id. */
  secret?: string;
  /** Different things that can happen each time (cloud shapes, shadow animals). */
  lines?: string[];
  /** Looking after something (like his plant): never gets boring, so repeats do not fade. */
  care?: boolean;
}
/**
 * A secret hidden in his world. Looking closer at its thing makes him notice it (the hint);
 * after that he can do its verb, and finding it the first time feels wonderful.
 * Some secrets only show up once another one is found (needs), or when a thing is in a state (when).
 */
export interface Secret {
  id: string; object: string; hint: string; verb: string; line: string; lines?: string[];
  needs?: string; when?: Record<string, string>; effect?: Partial<Needs>;
}
export type SecretState = "noticed" | "found";
type WithSecrets = { objects: Record<string, string>; secrets?: Record<string, SecretState> };
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
export interface Built {
  id: string; name: string; kind: string; plot: number; at: string; buildable?: string;
  /** How he pictured it when he wished for it (colour, shape, a funny detail). The page uses its colour. */
  looks?: string;
  /** His favourite colour when it was built, so it looks like his. */
  colour?: string;
}

export const AREAS = WORLD.areas as { id: string; name: string; desc: string }[];
const BASE = WORLD.objects as unknown as WorldObject[];
export const BUILDABLES = WORLD.buildables as unknown as Buildable[];
const CUSTOM = WORLD.custom as unknown as { kind: string; desc: string; actions: Action[] };
export const PLOTS = WORLD.plots.length;
/** What the wishmaster's free things (and Frederik's presents) become inside his house. */
interface GiftDef extends Omit<WorldObject, "area" | "built"> { item: string }
export const GIFTS = WORLD.gifts as unknown as GiftDef[];
export const SECRETS = ((WORLD as { secrets?: Secret[] }).secrets ?? []) as Secret[];
/** How finding a secret for the first time feels. */
export const SECRET_JOY: Partial<Needs> = { fulfilled: 0.3, curiosity: -0.35, feisty: -0.1 };
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

const conditionsMet = (s: WithSecrets, x: Secret) =>
  (!x.needs || s.secrets?.[x.needs] === "found") && Object.entries(x.when ?? {}).every(([id, st]) => (s.objects[id] ?? BASE.find(b => b.id === id)?.state) === st);

export function availableActions(s: WithSecrets, o: WorldObject): Action[] {
  const st = stateOf(s, o);
  const secret = SECRETS.filter(x => x.object === o.id && s.secrets?.[x.id] && conditionsMet(s, x))
    .map(x => ({ verb: x.verb, line: x.line, effect: x.effect, secret: x.id, lines: x.lines }));
  return [...o.actions.filter(a => !a.from || a.from === st), ...secret];
}

/** The next secret on this thing he could notice by looking closer, if any. */
export function hiddenSecret(s: WithSecrets, objectId: string): Secret | undefined {
  return SECRETS.find(x => x.object === objectId && !s.secrets?.[x.id] && conditionsMet(s, x));
}

/** Secrets he noticed but has not tried yet. */
export function noticedSecrets(s: WithSecrets): Secret[] {
  return SECRETS.filter(x => s.secrets?.[x.id] === "noticed");
}

export function findAction(s: WithSecrets, o: WorldObject, text: string | undefined): Action | undefined {
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
  title?: string;
  idea?: string;
  need?: string;
  text?: string;
  kind?: string;
  steps?: string[];
  looks?: string;
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
 * Novelty reward: the first time he does something, it feels wonderful (0.45).
 * A repeat is worth less the more often he has done it (0.10, 0.05, 0.03...),
 * but it recovers over a day away from it, to a small level that also shrinks with
 * how often he has done it, never below 0.04 so nothing is completely phased out.
 * Even fully recovered, a repeat is worth at most 0.18, far below a first.
 */
export const FIRST_REWARD = 0.45;
export const RECOVERY_HOURS = 24;
export function noveltyReward(timesDone: number, hoursSinceLast = 0): number {
  if (timesDone <= 0) return FIRST_REWARD;
  const worn = 0.1 / timesDone;
  const rested = Math.max(0.04, 0.18 / Math.sqrt(timesDone));
  const back = Math.min(1, Math.max(0, hoursSinceLast) / RECOVERY_HOURS);
  return worn + (Math.max(rested, worn) - worn) * back;
}

/** Doing the same thing again soon makes him restless: extra curiosity, fading as time passes. */
export function repeatBoredom(timesDone: number, hoursSinceLast = 0): number {
  if (timesDone <= 0) return 0;
  return Math.min(0.1, 0.03 * timesDone) * (1 - Math.min(1, Math.max(0, hoursSinceLast) / RECOVERY_HOURS));
}
