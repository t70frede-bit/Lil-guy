// The wishmaster sits between lil guy and Frederik.
// He may wish for anything he wants.
// Rule 1: free, easy things that meet the need are granted on the spot.
// Rule 2: anything that needs Frederik (company, money, real objects, decisions) is sent to him.

import { clamp, urgent, type NeedName, type Needs } from "./needs.js";

export interface FreeThing {
  name: string;
  meets: NeedName;
  effect: Partial<Needs>;
}

/** Things the wishmaster can hand out for free inside his world. */
export const FREE_THINGS: FreeThing[] = [
  { name: "a pebble", meets: "curiosity", effect: { curiosity: -0.35, fulfilled: 0.1 } },
  { name: "a shiny button", meets: "curiosity", effect: { curiosity: -0.35, fulfilled: 0.1 } },
  { name: "a piece of string", meets: "curiosity", effect: { curiosity: -0.3, fulfilled: 0.1 } },
  { name: "a leaf", meets: "curiosity", effect: { curiosity: -0.3, fulfilled: 0.1 } },
  { name: "a bottle cap", meets: "curiosity", effect: { curiosity: -0.35, fulfilled: 0.1 } },
  { name: "a warm blanket", meets: "energy", effect: { energy: 0.25 } },
  { name: "a cushion to punch", meets: "feisty", effect: { feisty: -0.4 } },
  { name: "a little job to do", meets: "fulfilled", effect: { fulfilled: 0.3, curiosity: -0.1 } },
];

export interface Wish { item: string; need: string; reason: string }

export type Verdict =
  | { kind: "declined"; why: string }
  | { kind: "granted"; thing: FreeThing; why: string }
  | { kind: "ask_frederik"; why: string };

const NEED_NAMES: NeedName[] = ["energy", "curiosity", "company", "feisty", "fulfilled"];

function normalise(s: string) { return s.toLowerCase().replace(/^(a|an|some|the)\s+/, "").trim(); }

export function judge(wish: Wish, needs: Needs, owned: string[]): Verdict {
  // He may wish for anything; the need is only used to explain the wish and pick a free thing.
  const need = NEED_NAMES.find(n => wish.need.toLowerCase().includes(n));
  const inNeed = urgent(needs);
  const wanted = normalise(wish.item);
  const matches = FREE_THINGS.filter(t => normalise(t.name) === wanted || wanted.includes(normalise(t.name)));
  const free = matches.find(t => t.meets === need) ?? matches[0];
  if (free) {
    if (owned.includes(free.name) && free.meets === "curiosity") {
      return { kind: "declined", why: `He already has ${free.name}. Something he has already seen will not help his curiosity.` };
    }
    return { kind: "granted", thing: free, why: `${free.name} is free${need && inNeed[need] ? `, and his ${need} is ${inNeed[need]}` : ""}.` };
  }
  const feeling = need ? ` He says it is for ${need} (${Math.round(needs[need] * 100)}%${inNeed[need] ? `, ${inNeed[need]}` : ""}).` : "";
  return { kind: "ask_frederik", why: `This needs you.${feeling}` };
}

export function applyEffect(needs: Needs, effect: Partial<Needs>): Needs {
  const out = { ...needs };
  for (const [k, v] of Object.entries(effect) as [NeedName, number][]) out[k] = clamp(out[k] + v);
  return out;
}

/** When nothing free matches, suggest one free thing that would meet the need, so he can ask for it. */
export function freeOptionsFor(need: NeedName): string[] {
  return FREE_THINGS.filter(t => t.meets === need).map(t => t.name);
}
