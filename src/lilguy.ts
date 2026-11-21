// One step of lil guy's life, and how each move is carried out. No network code here,
// so it can be tested without Telegram or an API key.

import { randomUUID } from "node:crypto";
import type { Brain } from "./brain.js";
import { clamp, drift, mood, shape, sleepTick, type NeedName, type Needs } from "./needs.js";
import { note, type PendingWish, type State } from "./state.js";
import { moveEffect, noveltyReward, PLACE_NAMES, type Move, type Place } from "./world.js";
import { applyEffect, judge } from "./wishmaster.js";

export const MAX_MESSAGES_PER_DAY = 12;

export interface Outbox {
  /** Lil guy says something to Frederik. */
  say(text: string): Promise<void>;
  /** The wishmaster asks Frederik to approve a wish. */
  ask(wish: PendingWish, why: string): Promise<void>;
  /** The wishmaster tells Frederik what it decided on its own (granted or declined). */
  inform(text: string): Promise<void>;
}

function canMessage(s: State): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (s.sentToday.day !== day) s.sentToday = { day, count: 0 };
  return s.sentToday.count < MAX_MESSAGES_PER_DAY;
}
function countMessage(s: State) { s.sentToday.count++; }

function reward(s: State, key: string) {
  const times = s.tried[key] ?? 0;
  const r = noveltyReward(times);
  s.tried[key] = times + 1;
  // New things satisfy curiosity; doing the same thing again and again makes him bored.
  s.needs = applyEffect(s.needs, { fulfilled: r, curiosity: -r * 1.2 + (times >= 2 ? 0.04 : 0) });
  return times === 0;
}

export async function step(s: State, brain: Brain, out: Outbox): Promise<void> {
  if (s.paused) return;
  s.ticks++;
  const before = mood(s.needs, s.sleeping);

  if (s.sleeping) {
    s.needs = sleepTick(s.needs);
    if (s.needs.energy >= 0.95) { s.sleeping = false; note(s, "Woke up rested."); }
    return;
  }
  s.needs = drift(s.needs);

  let decision;
  try { decision = await brain.decide(s); }
  catch (e) { note(s, `Could not think clearly (${(e as Error).message}). Carried on.`); return; }

  note(s, `Thought: ${decision.thought}`);
  for (const move of decision.moves.slice(0, 3)) await doMove(s, move as Move & { reason?: string }, out);

  const after = mood(s.needs, s.sleeping);
  if (after !== before) note(s, `Mood changed from ${before} to ${after}; he is now a ${shape(after)}.`);
}

export async function doMove(s: State, move: Move & { reason?: string }, out: Outbox) {
  switch (move.type) {
    case "wait": note(s, "Waited and watched."); break;
    case "rest": s.needs = moveEffect("rest", s.needs); note(s, "Rested for a bit."); break;
    case "sleep": s.sleeping = true; note(s, "Fell asleep."); break;
    case "go": {
      const place = PLACE_NAMES.find(p => move.target?.toLowerCase().includes(p));
      if (!place) { note(s, `Tried to go to "${move.target}", which is not a place he knows.`); break; }
      if (place === s.place) { note(s, `Is already at the ${place}.`); break; }
      s.place = place as Place;
      s.needs = moveEffect("go", s.needs);
      const first = reward(s, `go:${place}`);
      note(s, `${first ? "Went to the " + place + " for the first time!" : "Went to the " + place + "."}`);
      break;
    }
    case "look_closer":
    case "try": {
      const what = (move.target ?? "something").slice(0, 80);
      s.needs = moveEffect(move.type, s.needs);
      const first = reward(s, `${move.type}:${what.toLowerCase()}`);
      note(s, `${move.type === "try" ? "Tried" : "Looked closely at"} ${what}${first ? " (new!)" : ""}.`);
      break;
    }
    case "message": {
      const text = (move.text ?? "").trim().slice(0, 500);
      if (!text) break;
      if (!canMessage(s)) { note(s, "Wanted to message Frederik but has said enough today."); break; }
      countMessage(s);
      s.needs = moveEffect("message", s.needs);
      note(s, `Said to Frederik: ${text}`);
      await out.say(text);
      break;
    }
    case "wish": await wish(s, move, out); break;
  }
}

async function wish(s: State, move: Move & { reason?: string }, out: Outbox) {
  const item = (move.item ?? "").trim().slice(0, 120);
  if (!item) return;
  if (s.pending.some(p => p.item.toLowerCase() === item.toLowerCase())) { note(s, `Still waiting to hear about ${item}.`); return; }
  const w = { item, need: move.need ?? "", reason: (move.reason ?? "").slice(0, 300) };
  const verdict = judge(w, s.needs, s.items);

  if (verdict.kind === "declined") {
    s.needs = applyEffect(s.needs, { feisty: 0.1 });
    note(s, `Wished for ${item}. The wishmaster said no: ${verdict.why}`);
    return;
  }
  if (verdict.kind === "granted") {
    s.needs = applyEffect(s.needs, verdict.thing.effect);
    if (!s.items.includes(verdict.thing.name)) s.items.push(verdict.thing.name);
    note(s, `Wished for ${item}. The wishmaster gave him ${verdict.thing.name}: ${verdict.why}`);
    if (canMessage(s)) { countMessage(s); await out.inform(`Lil guy needed something and got ${verdict.thing.name} for free (${verdict.why})`); }
    return;
  }
  if (!canMessage(s)) { note(s, `Wanted to ask for ${item}, but the wishmaster is saving it for tomorrow.`); return; }
  countMessage(s);
  const pending: PendingWish = { id: randomUUID().slice(0, 8), item, need: w.need, reason: w.reason, at: new Date().toISOString() };
  s.pending.push(pending);
  note(s, `Wished for ${item}. The wishmaster asked Frederik.`);
  await out.ask(pending, verdict.why);
}

/** Frederik pressed Approve or Not now on a wish. */
export function resolveWish(s: State, id: string, approved: boolean): PendingWish | undefined {
  const i = s.pending.findIndex(p => p.id === id);
  if (i < 0) return undefined;
  const [p] = s.pending.splice(i, 1);
  const need = (["energy", "curiosity", "company", "feisty", "fulfilled"] as NeedName[]).find(n => p.need.toLowerCase().includes(n));
  if (approved) {
    const fix: Partial<Needs> = need === "feisty" ? { feisty: -0.4 } : need === "energy" ? { energy: 0.4 } : need === "curiosity" ? { curiosity: -0.4 } : need ? { [need]: 0.5 } : {};
    s.needs = applyEffect(s.needs, fix);
    s.needs = applyEffect(s.needs, { fulfilled: 0.15, company: 0.1 });
    if (!/frederik|say hi|visit|company/i.test(p.item) && !s.items.includes(p.item)) s.items.push(p.item);
    note(s, `Frederik said yes to ${p.item}!`);
  } else {
    s.needs = applyEffect(s.needs, { feisty: 0.25 });
    note(s, `Frederik said not now to ${p.item}.`);
  }
  return p;
}

/** Frederik wrote to him. */
export function heardFromFrederik(s: State) {
  s.needs = { ...s.needs, company: clamp(s.needs.company + 0.25), feisty: clamp(s.needs.feisty - 0.1) };
  if (s.sleeping && s.needs.energy > 0.4) { s.sleeping = false; note(s, "Frederik woke him up."); }
}
