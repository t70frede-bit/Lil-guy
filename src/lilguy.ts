// One step of lil guy's life, and how each move is carried out. No network code here,
// so it can be tested without Telegram or an API key.

import { randomUUID } from "node:crypto";
import type { Brain } from "./brain.js";
import { clamp, drift, mood, shape, sleepTick, type NeedName, type Needs } from "./needs.js";
import { highlight, note, type PendingWish, type State } from "./state.js";
import { availableActions, findAction, findBuildable, findObject, isBuildWish, moveEffect, noveltyReward, PLOTS, type Built, type Move } from "./world.js";
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
  if (after !== before) {
    note(s, `Mood changed from ${before} to ${after}; he is now a ${shape(after)}.`);
    const line = MOOD_LINES[after] ?? (before === "feisty" || before === "lonely" ? "Cheered up and became a round ball again." : undefined);
    if (line) highlight(s, "mood", line);
  }
}

const MOOD_LINES: Record<string, string> = {
  feisty: "Got feisty and turned into a spiky ball.",
  lonely: "Felt lonely and turned into a cube.",
};

export async function doMove(s: State, move: Move & { reason?: string }, out: Outbox) {
  switch (move.type) {
    case "wait": note(s, "Waited and watched."); break;
    case "rest": s.needs = moveEffect("rest", s.needs); note(s, "Rested for a bit."); break;
    case "sleep": s.sleeping = true; s.place = "bed"; note(s, "Crawled into the sock bed and fell asleep."); break;
    case "go": {
      const obj = findObject(s, move.target);
      if (!obj) { note(s, `Tried to go to "${move.target}", which is not somewhere he knows.`); break; }
      if (obj.id === s.place) { note(s, `Is already at the ${obj.name}.`); break; }
      const wasOutside = findObject(s, s.place)?.area === "outside";
      s.place = obj.id;
      s.needs = moveEffect("go", s.needs);
      const first = reward(s, `go:${obj.id}`);
      const door = obj.area === "outside" && !wasOutside ? "Went outside to " : obj.area === "home" && wasOutside ? "Came back inside to " : "Went to ";
      note(s, `${door}the ${obj.name}${first ? " for the first time!" : "."}`);
      if (first) highlight(s, "first", obj.area === "outside" && !s.highlights.some(h => /outside/i.test(h.text)) ? `Went outside for the very first time, to the ${obj.name}!` : `Went to the ${obj.name} for the first time.`);
      break;
    }
    case "use": {
      const obj = findObject(s, move.target);
      if (!obj) { note(s, `Wanted to use "${move.target}", but there is no such thing here.`); break; }
      const action = findAction(s, obj, move.action);
      if (!action) {
        const can = availableActions(s, obj).map(a => a.verb).join(", ");
        note(s, `Wanted to ${move.action ?? "do something with"} the ${obj.name}, but could only ${can || "look at it"}.`);
        break;
      }
      if (s.place !== obj.id) { s.place = obj.id; reward(s, `go:${obj.id}`); }
      if (action.to) s.objects[obj.id] = action.to;
      s.needs = moveEffect("use", s.needs);
      if (action.effect) s.needs = applyEffect(s.needs, action.effect);
      const firstWithIt = !Object.keys(s.tried).some(k => k.startsWith(`use:${obj.id}:`));
      const first = reward(s, `use:${obj.id}:${action.verb}`);
      s.last = { object: obj.id, verb: action.verb, line: action.line, at: new Date().toISOString() };
      note(s, `${action.line}${first ? " (new!)" : ""}`);
      if (firstWithIt) highlight(s, "first", `First time: ${action.line}`);
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
      highlight(s, "chat", "Sent Frederik a message.");
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
    highlight(s, "gift", `Wished for ${item} and the wishmaster gave him ${verdict.thing.name}.`);
    if (canMessage(s)) { countMessage(s); await out.inform(`Lil guy needed something and got ${verdict.thing.name} for free (${verdict.why})`); }
    return;
  }
  if (!canMessage(s)) { note(s, `Wanted to ask for ${item}, but the wishmaster is saving it for tomorrow.`); return; }
  countMessage(s);
  const pending: PendingWish = { id: randomUUID().slice(0, 8), item, need: w.need, reason: w.reason, at: new Date().toISOString() };
  s.pending.push(pending);
  note(s, `Wished for ${item}. The wishmaster asked Frederik.`);
  highlight(s, "wish", w.reason ? `Wished for ${item}: "${w.reason.slice(0, 140)}"` : `Wished for ${item}.`);
  await out.ask(pending, isBuildWish(item) ? `${verdict.why} If you say yes, it gets built in his world.` : verdict.why);
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
    const built = isBuildWish(p.item) ? build(s, p.item) : undefined;
    if (built) { note(s, `Frederik said yes! A ${built.name} was built outside.`); highlight(s, "built", `Frederik said yes, and ${/^[aeiou]/i.test(built.name) ? "an" : "a"} ${built.name} was built outside!`); }
    else {
      if (!/frederik|say hi|visit|company/i.test(p.item) && !s.items.includes(p.item)) s.items.push(p.item);
      note(s, `Frederik said yes to ${p.item}!`);
      highlight(s, "yes", `Frederik said yes to ${p.item}!`);
    }
  } else {
    s.needs = applyEffect(s.needs, { feisty: 0.25 });
    note(s, `Frederik said not now to ${p.item}.`);
    highlight(s, "no", `Frederik said not now to ${p.item}.`);
  }
  return p;
}

/** Put an approved place on the next free plot outside. */
export function build(s: State, item: string): Built | undefined {
  const def = findBuildable(item);
  if (def && s.built.some(b => b.buildable === def.id)) return undefined; // already has one
  const name = (def?.name ?? item.replace(/^(a|an|some|the|my|his)\s+/i, "")).slice(0, 60);
  const id = def?.id ?? `custom-${randomUUID().slice(0, 6)}`;
  const b: Built = { id, name, kind: def?.kind ?? "custom", plot: s.built.length % Math.max(PLOTS, 1), at: new Date().toISOString(), ...(def ? { buildable: def.id } : {}) };
  s.built.push(b);
  return b;
}

/** Frederik wrote to him. */
export function heardFromFrederik(s: State) {
  s.needs = { ...s.needs, company: clamp(s.needs.company + 0.25), feisty: clamp(s.needs.feisty - 0.1) };
  highlight(s, "chat", "Frederik came by to talk.");
  if (s.sleeping && s.needs.energy > 0.4) { s.sleeping = false; note(s, "Frederik woke him up."); }
}
