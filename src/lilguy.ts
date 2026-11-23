// One step of lil guy's life, and how each move is carried out. No network code here,
// so it can be tested without Telegram or an API key.

import { randomUUID } from "node:crypto";
import type { Brain } from "./brain.js";
import { clamp, drift, shape, sleepTick, type NeedName, type Needs } from "./needs.js";
import { feelProud, highlight, moodOf, note, type PendingWish, type State } from "./state.js";
import { availableActions, findAction, findBuildable, findObject, hiddenSecret, isBuildWish, moveEffect, noveltyReward, PLOTS, repeatBoredom, SECRET_JOY, type Built, type Move } from "./world.js";
import { answerWonder, needsWonder, setWonder } from "./wonder.js";
import { applyEffect, judge } from "./wishmaster.js";
import { activeProject, canAffordNextStep, kr, makeProject, recentlyToldNo, tokensToFinish, waitingProject, type Project } from "./workshop.js";
import { urgent } from "./needs.js";
import { addTheory, applyPick, applyReflection, nameOf, needsReflection, treasure } from "./self.js";
import { objectsOf } from "./world.js";
import { today } from "./wonder.js";
import { moveIn, moveInFinished, SPOT_WORDS, type Friend } from "./friends.js";
import { canAfford, due, MIND_COOLDOWN_MS, newMind } from "./mind.js";

export const MAX_MESSAGES_PER_DAY = 12;

export interface Outbox {
  /** Lil guy says something to Frederik. */
  say(text: string): Promise<void>;
  /** The wishmaster asks Frederik to approve a wish. */
  ask(wish: PendingWish, why: string): Promise<void>;
  /** The wishmaster tells Frederik what it decided on its own (granted or declined). */
  inform(text: string): Promise<void>;
  /** The wishmaster asks Frederik to approve a new project and its token budget. */
  propose(project: Project, why: string): Promise<void>;
  /** The wishmaster asks Frederik for more tokens so a project can be finished. */
  askMore(project: Project, more: { tokens: number; dkk: number }): Promise<void>;
  /** The wishmaster asks Frederik to approve the monthly cost of a friend's own mind. */
  askMind?(friend: Friend, why: string): Promise<void>;
}

function canMessage(s: State): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (s.sentToday.day !== day) s.sentToday = { day, count: 0 };
  return s.sentToday.count < MAX_MESSAGES_PER_DAY;
}
function countMessage(s: State) { s.sentToday.count++; }

function reward(s: State, key: string, care = false) {
  const times = s.tried[key] ?? 0;
  if (care) {
    // Looking after something never gets old: a small, steady good feeling, no restlessness.
    s.tried[key] = times + 1;
    s.needs = applyEffect(s.needs, times === 0 ? { fulfilled: noveltyReward(0), curiosity: -noveltyReward(0) } : { fulfilled: 0.04, company: 0.02 });
    return times === 0;
  }
  s.lastTried ??= {};
  const last = s.lastTried[key];
  // Things he did before this was tracked count as done long ago.
  const hours = last ? (Date.now() - Date.parse(last)) / 3600_000 : 1e6;
  const r = noveltyReward(times, hours);
  s.tried[key] = times + 1;
  s.lastTried[key] = new Date().toISOString();
  // New things fill him up and satisfy curiosity; doing the same thing again soon makes him restless.
  s.needs = applyEffect(s.needs, { fulfilled: r, curiosity: -r + repeatBoredom(times, hours), feisty: times === 0 ? -0.05 : 0 });
  return times === 0;
}

/** Some first tries go a bit wrong. Kept in an object so tests can switch it off. */
export const luck = { mishapChance: 1 / 8, roll: () => Math.random() };

const MISHAPS = [
  "it did not work the first time", "he rolled right past it", "he got a bit tangled up",
  "it was much trickier than it looked", "he tried it the wrong way round", "he bumped his nose",
];

export async function step(s: State, brain: Brain, out: Outbox): Promise<void> {
  if (s.paused) return;
  s.ticks++;

  // Friends he finished designing before they could move in: they move in now.
  for (const f of moveInFinished(s)) welcome(s, f);

  // The very first time after this update: he decides some things about himself.
  if (!s.self && !s.sleeping) await pickSelf(s, brain, out);

  const before = moodOf(s);
  if (s.sleeping) {
    if (needsReflection(s)) await reflect(s, brain, out);
    s.needs = sleepTick(s.needs);
    if (s.items.includes("a warm blanket")) s.needs = applyEffect(s.needs, { energy: 0.02 }); // sleeps better tucked in
    if (s.needs.energy >= 0.95) { s.sleeping = false; note(s, "Woke up rested."); morning(s); }
    return;
  }
  s.needs = drift(s.needs);

  let decision;
  try { decision = await brain.decide(s); }
  catch (e) { note(s, `Could not think clearly (${(e as Error).message}). Carried on.`); return; }

  note(s, `Thought: ${decision.thought}`);
  if (decision.wonder && needsWonder(s)) setWonder(s, decision.wonder);
  for (const move of decision.moves.slice(0, 3)) await doMove(s, move as Move & { reason?: string }, out, brain);
  if (decision.wonder_answer) {
    const open = s.wonder && !s.wonder.answer;
    answerWonder(s, decision.wonder_answer);
    if (open && s.wonder?.answer) feelProud(s);
  }
  if (decision.theory) addTheory(s, decision.theory.about, decision.theory.belief);
  if (decision.name_it) nameThing(s, decision.name_it.thing, decision.name_it.name);
  await friendsThink(s, brain, out);

  const after = moodOf(s);
  if (after !== before) {
    note(s, `Mood changed from ${before} to ${after}; he is now a ${shape(after)}.`);
    const line = MOOD_LINES[after] ?? (before === "feisty" || before === "lonely" ? "Cheered up and became a round ball again." : undefined);
    if (line) highlight(s, "mood", line);
  }
}

const MOOD_LINES: Record<string, string> = {
  feisty: "Got feisty and turned into a spiky ball.",
  lonely: "Felt lonely and turned into a cube.",
  proud: "Felt very proud and did a happy wiggle.",
};

async function pickSelf(s: State, brain: Brain, out: Outbox) {
  let pick;
  try { pick = await brain.pickSelf(s); }
  catch (e) { note(s, `Tried to decide some things about himself, but could not think clearly (${(e as Error).message}).`); return; }
  applyPick(s, pick, objectsOf(s).map(o => ({ id: o.id, name: o.name })));
  // Telling Frederik what he chose is showing him something, so it is allowed.
  if (pick.announce && canMessage(s)) { countMessage(s); await out.say(pick.announce.slice(0, 600)); }
}

async function reflect(s: State, brain: Brain, out: Outbox) {
  let r;
  try { r = await brain.reflect(s); }
  catch (e) {
    note(s, `Dreamed, but could not remember what about (${(e as Error).message}).`);
    if (s.self) s.self.reflectedDay = today(); // try again tomorrow night, not every tick
    return;
  }
  const goal = applyReflection(s, r);
  // A big decision is worth showing Frederik, and it is never a request to hang out.
  if (goal && s.self) await out.say(`I thought about it for a lot of nights, and I decided my goal in life. ${goal}.${s.self.goalWhy ? ` ${s.self.goalWhy}` : ""}`.slice(0, 700));
}

/** His morning ritual, once a day when he wakes up. */
export function morning(s: State) {
  const day = today();
  s.rituals ??= {};
  if (s.rituals.morning === day) return;
  s.rituals.morning = day;
  s.objects.plant = "a bit thirsty"; // plants get thirsty overnight
  const plant = nameOf(s, "plant", "the little plant");
  s.needs = applyEffect(s.needs, { company: 0.05, fulfilled: 0.03 });
  const line = `Morning: stretched as far as he could, peeked out of the window, and said good morning to ${plant}.`;
  note(s, line);
  highlight(s, "ritual", line);
}

/** His bedtime ritual, once a day when he goes to sleep. */
export function bedtime(s: State) {
  const day = today();
  s.rituals ??= {};
  if (s.rituals.bedtime === day) return;
  s.rituals.bedtime = day;
  const things = ["plant", "ball", "lamp"].map(id => nameOf(s, id, id === "plant" ? "the little plant" : id === "ball" ? "the toy ball" : "the lamp"));
  s.needs = applyEffect(s.needs, { company: 0.04 });
  const line = `Bedtime: said goodnight to ${things.slice(0, -1).join(", ")} and ${things[things.length - 1]}, then pulled the sock up to his chin.`;
  note(s, line);
  highlight(s, "ritual", line);
}

/** He gives one of his things his own name. */
export function nameThing(s: State, thing: string, name: string) {
  const o = findObject(s, thing);
  const n = name.replace(/\s+/g, " ").trim().slice(0, 30);
  if (!s.self || !o || !n || s.self.names[o.id] === n) return;
  s.self.names[o.id] = n;
  note(s, `Decided to call the ${o.name} "${n}".`);
  highlight(s, "self", `Gave the ${o.name} a name: ${n}.`);
}

export async function doMove(s: State, move: Move & { reason?: string }, out: Outbox, brain?: Brain) {
  switch (move.type) {
    case "wait": note(s, "Waited and watched."); break;
    case "rest": s.needs = moveEffect("rest", s.needs); note(s, "Rested for a bit."); break;
    case "sleep": s.sleeping = true; s.place = "bed"; bedtime(s); note(s, "Crawled into the sock bed and fell asleep."); break;
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
      const key = `use:${obj.id}:${action.verb}`;
      // Some first tries go a bit wrong. Nothing changes, and getting it right next time feels extra good.
      if (!s.tried[key] && !action.secret && !action.care && s.oops !== key && luck.roll() < luck.mishapChance) {
        s.oops = key;
        s.needs = applyEffect(s.needs, { feisty: 0.05, energy: -0.02 });
        const why = MISHAPS[Math.floor(luck.roll() * MISHAPS.length) % MISHAPS.length];
        s.last = { object: obj.id, verb: "oops", line: `Tried to ${action.verb}, but ${why}.`, at: new Date().toISOString() };
        note(s, `Tried to ${action.verb} (the ${obj.name}), but oops: ${why}. He will try again.`);
        highlight(s, "oops", `Tried to ${action.verb}, but ${why}. Oops.`);
        break;
      }
      const secondTry = s.oops === key;
      if (secondTry) { s.oops = undefined; s.needs = applyEffect(s.needs, { fulfilled: 0.12, feisty: -0.1 }); feelProud(s); }
      if (action.to) s.objects[obj.id] = action.to;
      s.needs = moveEffect("use", s.needs);
      if (action.effect) s.needs = applyEffect(s.needs, action.effect);
      const firstWithIt = !Object.keys(s.tried).some(k => k.startsWith(`use:${obj.id}:`));
      const first = reward(s, key, action.care);
      // The first time is the main line; after that, things like clouds look different each time.
      const line = action.lines?.length && !first ? action.lines[Math.floor(Math.random() * action.lines.length)] : action.lines?.length ? action.lines[0] : action.line;
      s.last = { object: obj.id, verb: action.verb, line, at: new Date().toISOString() };
      if (action.secret && s.secrets[action.secret] !== "found") {
        s.secrets[action.secret] = "found";
        s.needs = applyEffect(s.needs, SECRET_JOY);
        feelProud(s);
        note(s, `${line} He found a secret!`);
        highlight(s, "secret", `Found a secret: ${line}`);
        break;
      }
      note(s, `${line}${first ? " (new!)" : ""}${secondTry ? " Got it on the second try!" : ""}`);
      if (firstWithIt) highlight(s, "first", `First time: ${line}`);
      break;
    }
    case "look_closer": {
      // Looking closely at a real thing is how he notices its secrets.
      const obj = findObject(s, move.target);
      const here = findObject(s, s.place);
      if (obj && (obj.id === s.place || obj.area === here?.area)) {
        const secret = hiddenSecret(s, obj.id);
        if (secret) {
          s.place = obj.id;
          s.needs = moveEffect("look_closer", s.needs);
          s.secrets[secret.id] = "noticed";
          reward(s, `look_closer:${obj.id}:${secret.id}`);
          note(s, `Looked closely at the ${obj.name} and noticed something: ${secret.hint}`);
          break;
        }
      }
    }
    // falls through
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
      if (asksFrederikToChoose(text)) { note(s, "Almost asked Frederik to choose for him, then decided to pick himself."); break; }
      if (asksForCompany(text)) { note(s, "Almost asked Frederik to hang out, then remembered to only write when he has something to show or ask."); break; }
      if (!canMessage(s)) { note(s, "Wanted to message Frederik but has said enough today."); break; }
      countMessage(s);
      s.needs = moveEffect("message", s.needs);
      note(s, `Said to Frederik: ${text}`);
      highlight(s, "chat", "Sent Frederik a message.");
      await out.say(text);
      break;
    }
    case "wish": await wish(s, move, out); break;
    case "propose_project": await propose(s, move, brain, out); break;
    case "work_on_project": await work(s, brain, out); break;
    case "give_friend_mind": {
      const f = s.friends?.find(x => findObject(s, move.target)?.id === x.id);
      if (!f) { note(s, `Wanted to give "${move.target}" a mind of their own, but that is not one of his friends.`); break; }
      const like = (move.text ?? move.idea ?? move.reason ?? "").trim();
      if (!like) { note(s, `Thought about giving ${f.name} a mind of their own, but has not worked out what it would be like yet.`); break; }
      if (f.mind && f.mind.status !== "said no") { note(s, `${f.name} already ${f.mind.status === "waiting" ? "is waiting to hear about" : "has"} a mind of their own.`); break; }
      if (f.mind && Date.now() - Date.parse(f.mind.decidedAt ?? f.mind.askedAt) < MIND_COOLDOWN_MS) { note(s, `Wanted to ask again about a mind for ${f.name}, but Frederik said not now only a little while ago.`); break; }
      if (s.friends?.some(x => x.mind?.status === "waiting")) { note(s, "Wanted to give a friend a mind, but is still waiting to hear about the last one."); break; }
      await askForMind(s, f, like, brain?.model ?? "", out);
      break;
    }
  }
}

async function wish(s: State, move: Move & { reason?: string }, out: Outbox) {
  const item = (move.item ?? "").trim().slice(0, 120);
  if (!item) return;
  if (s.pending.some(p => p.item.toLowerCase() === item.toLowerCase())) { note(s, `Still waiting to hear about ${item}.`); return; }
  const w = { item, need: move.need ?? "", reason: (move.reason ?? "").slice(0, 300) };
  const verdict = judge(w, s.needs, s.items);

  if (verdict.kind === "declined") {
    if (!verdict.gentle) s.needs = applyEffect(s.needs, { feisty: 0.1 });
    note(s, `Wished for ${item}. The wishmaster said no: ${verdict.why}`);
    return;
  }
  if (verdict.kind === "granted") {
    s.needs = applyEffect(s.needs, verdict.thing.effect);
    if (!s.items.includes(verdict.thing.name)) s.items.push(verdict.thing.name);
    note(s, `Wished for ${item}. The wishmaster gave him ${verdict.thing.name}: ${verdict.why}`);
    highlight(s, "gift", `Wished for ${item} and the wishmaster gave him ${verdict.thing.name}.`);
    // Free gifts are just news, so they do not use up his own messages for the day.
    if (canMessage(s)) { await out.inform(`Lil guy needed something and got ${verdict.thing.name} for free (${verdict.why})`); }
    return;
  }
  if (!canMessage(s)) { note(s, `Wanted to ask for ${item}, but the wishmaster is saving it for tomorrow.`); return; }
  countMessage(s);
  const looks = (move.looks ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  const pending: PendingWish = { id: randomUUID().slice(0, 8), item, need: w.need, reason: w.reason, at: new Date().toISOString(), ...(looks ? { looks } : {}) };
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
    const built = isBuildWish(p.item) ? build(s, p.item, p.looks) : undefined;
    if (built) { treasure(s, `The day my ${built.name} was built.`); note(s, `Frederik said yes! A ${built.name} was built outside.`); highlight(s, "built", `Frederik said yes, and ${/^[aeiou]/i.test(built.name) ? "an" : "a"} ${built.name} was built outside!`); }
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
export function build(s: State, item: string, looks?: string): Built | undefined {
  const def = findBuildable(item);
  if (def && s.built.some(b => b.buildable === def.id)) return undefined; // already has one
  const name = (def?.name ?? item.replace(/^(a|an|some|the|my|his)\s+/i, "")).slice(0, 60);
  const id = def?.id ?? `custom-${randomUUID().slice(0, 6)}`;
  const b: Built = { id, name, kind: def?.kind ?? "custom", plot: s.built.length % Math.max(PLOTS, 1), at: new Date().toISOString(), ...(def ? { buildable: def.id } : {}),
    ...(looks ? { looks } : {}), ...(s.self?.colour ? { colour: s.self.colour } : {}) };
  s.built.push(b);
  return b;
}

/** Frederik wrote to him. */
export function heardFromFrederik(s: State) {
  s.needs = { ...s.needs, company: clamp(s.needs.company + 0.25), feisty: clamp(s.needs.feisty - 0.1) };
  highlight(s, "chat", "Frederik came by to talk.");
  if (s.sleeping && s.needs.energy > 0.4) { s.sleeping = false; note(s, "Frederik woke him up."); }
}

// ---------- The workshop ----------

export function hasWorkshop(s: State) { return s.built.some(b => b.buildable === "workshop"); }

/** Frederik decided to give him a workshop. Put it up once, on the next free plot. */
export function ensureWorkshop(s: State): boolean {
  if (hasWorkshop(s)) return false;
  const b = build(s, "workshop");
  if (!b) return false;
  note(s, "Frederik built him a workshop outside! Now he can work on his own projects there.");
  highlight(s, "built", "Frederik built him a workshop, a place for his own projects!");
  return true;
}

function goToWorkbench(s: State) {
  if (s.place !== "workbench") { s.place = "workbench"; reward(s, "go:workbench"); }
}

async function propose(s: State, move: Move & { reason?: string }, brain: Brain | undefined, out: Outbox) {
  if (!hasWorkshop(s)) { note(s, "Wanted to start a project, but has nowhere to work on it yet."); return; }
  if (activeProject(s.projects)) { note(s, "Thought of a new project, but wants to finish the one he is working on first."); return; }
  if (waitingProject(s.projects)) { note(s, "Thought of a new project, but is still waiting to hear about the last one."); return; }
  if (recentlyToldNo(s.projects)) { note(s, "Thought of a new project, but Frederik said not now a little while ago. He will wait a bit."); return; }
  // Accept the fields wherever he put them, so a good idea is not lost over a form.
  const p = makeProject({ title: move.title ?? move.item ?? move.target, kind: move.kind, idea: move.idea ?? move.text ?? move.reason, need: move.need, steps: move.steps }, brain?.model ?? "");
  if (typeof p === "string") { note(s, `Tried to plan a project, but the wishmaster sent it back: ${p} (A plan needs a title, an idea, 2 to 8 steps and a need.)`); return; }
  goToWorkbench(s);
  // Frederik decides on every project himself (he sees the cost), so the wishmaster no longer turns
  // plans down for not coming from a pressing need. A friend is for company if he did not say.
  if (!p.need && p.kind === "friend") p.need = "company";
  const pressing = urgent(s.needs);
  // Project proposals do not use up his daily messages: they are already limited to one at a time,
  // with a pause after a "not now", and they are the main thing Frederik wants to hear about.
  s.projects.push(p);
  s.objects.planboard = "a plan is pinned up";
  note(s, `Planned a project: "${p.title}". The wishmaster asked Frederik (about ${p.estimate.tokens} tokens, ${kr(p.estimate.dkk)}).`);
  highlight(s, "project", `Planned a project: "${p.title}". Waiting for Frederik to say yes.`);
  const feeling = pressing[p.need as keyof typeof pressing];
  await out.propose(p, feeling ? `${p.need} is ${feeling}.` : p.need ? `It is his own idea, for his ${p.need}.` : "It is his own idea.");
}

async function work(s: State, brain: Brain | undefined, out: Outbox) {
  const p = activeProject(s.projects);
  if (!p) { note(s, waitingProject(s.projects) ? "Wanted to work on his project, but Frederik has not said yes yet." : "Wanted to work on a project, but has none going."); return; }
  if (!brain) return;
  goToWorkbench(s);
  if (!canAffordNextStep(p)) { await outOfTokens(s, p, brain, out); return; }
  const step = p.steps[p.pieces.length];
  const last = p.pieces.length === p.steps.length - 1;
  let res;
  try { res = await brain.work(s, p, step, last, p.budget - p.used); }
  catch (e) { note(s, `Could not concentrate on "${p.title}" (${(e as Error).message}).`); return; }
  if (res === "over budget") { await outOfTokens(s, p, brain, out); return; }
  p.used += res.tokens;
  p.spentDkk = (p.spentDkk ?? 0) + res.dkk;
  if (res.failed) { note(s, `Tried to work on "${p.title}", but it did not come out right. He will try that step again.`); return; }
  p.pieces.push({ at: new Date().toISOString(), step, text: res.text.slice(0, 2000), tokens: res.tokens });
  if (res.friend) p.friend = res.friend;
  s.needs = moveEffect("work_on_project", s.needs);
  s.needs = applyEffect(s.needs, { fulfilled: 0.12, curiosity: -0.08, ...(p.kind === "friend" ? { company: 0.08 } : {}) });
  s.objects.workbench = "messy";
  s.last = { object: "workbench", verb: "work on a project", line: `Worked on "${p.title}": ${step}`, at: new Date().toISOString() };
  note(s, `Worked on "${p.title}": ${step} (${p.pieces.length} of ${p.steps.length} done, ${p.used} of ${p.budget} tokens used).`);
  if (p.pieces.length >= p.steps.length) {
    p.status = "done";
    s.objects.planboard = "a finished project is pinned up";
    s.needs = applyEffect(s.needs, { fulfilled: 0.3 });
    note(s, `Finished his project "${p.title}"!`);
    feelProud(s);
    treasure(s, p.friend ? `The day I finished designing ${p.friend.name}.` : `The day I finished "${p.title}".`);
    highlight(s, "project", p.friend ? `Finished designing a new friend: ${p.friend.name}!` : `Finished his project "${p.title}"!`);
    // A finished friend design is not just a drawing: the friend moves in, where he pictured them.
    const moved = p.kind === "friend" || p.friend ? moveIn(s, p) : undefined;
    if (moved) welcome(s, moved.friend, !moved.isNew);
    await out.inform(finishedMessage(p, brain.model, moved?.friend)); // always: a finished project is what Frederik paid for
    // He designed them with a mind of their own: that runs on tokens, so Frederik approves its cost first.
    if (moved && p.friend?.mind?.trim() && (!moved.friend.mind || moved.friend.mind.status === "said no")) await askForMind(s, moved.friend, p.friend.mind, brain.model, out);
  }
}

async function outOfTokens(s: State, p: Project, brain: Brain, out: Outbox) {
  p.status = "needs more tokens";
  // Ask for enough: the estimate, or what his steps have really cost so far, whichever is more.
  const more = tokensToFinish(p, brain.model);
  const biggest = Math.max(0, ...p.pieces.map(x => x.tokens));
  const left = Math.max(1, p.steps.length - p.pieces.length);
  if (biggest * 1.2 * left > more.tokens) {
    const tokens = Math.ceil(biggest * 1.2 * left);
    more.dkk = Math.ceil(more.dkk * tokens / more.tokens * 100) / 100;
    more.tokens = tokens;
  }
  p.askedMore = more.tokens;
  note(s, `Ran out of tokens for "${p.title}" and put his tools down. The wishmaster will ask Frederik.`);
  await out.askMore(p, more);
}

/** A friend moves into his world (or a friend he redesigned gets their new look). */
export function welcome(s: State, f: Friend, redesigned = false) {
  if (redesigned) {
    note(s, `${f.name} got the new look he designed, and still lives ${SPOT_WORDS[f.spot]}.`);
    highlight(s, "friend", `${f.name} got a new look, just as he pictured it.`);
    return;
  }
  s.needs = applyEffect(s.needs, { company: 0.3, fulfilled: 0.1 });
  feelProud(s);
  treasure(s, `The day ${f.name} moved in.`);
  note(s, `${f.name} moved in! ${f.name} lives ${SPOT_WORDS[f.spot]} now.`);
  highlight(s, "friend", `${f.name} moved in and lives ${SPOT_WORDS[f.spot]} now!`);
}

export function finishedMessage(p: Project, model: string, moved?: Friend): string {
  const f = p.friend;
  return [
    `Lil guy finished his project "${p.title}". It used ${p.used} of the ${p.budget} tokens you approved.`,
    f ? `His new friend design: ${f.name}. Looks: ${f.looks}. Shape: ${f.shape}. Colour: ${f.colour}. Personality: ${f.personality}. Likes: ${f.likes}.` : "",
    moved ? `${moved.name} has moved into his world and lives ${SPOT_WORDS[moved.spot]}. You can see ${moved.name} on his page.` : "",
    `The last part he made: ${p.pieces[p.pieces.length - 1]?.text.slice(0, 700) ?? ""}`,
    `It cost about ${kr(p.spentDkk ?? 0)} (estimate was ${kr(p.estimate.dkk)}, model ${model}).`,
  ].filter(Boolean).join("\n\n");
}

/** Frederik pressed Approve or Not now on a project. */
export function resolveProject(s: State, id: string, approved: boolean): Project | undefined {
  const p = s.projects.find(x => x.id === id && x.status === "waiting");
  if (!p) return undefined;
  p.decidedAt = new Date().toISOString();
  if (approved) {
    p.status = "working";
    p.budget = p.estimate.tokens;
    s.needs = applyEffect(s.needs, { fulfilled: 0.15, company: 0.1 });
    note(s, `Frederik said yes to his project "${p.title}"! He may use up to ${p.budget} tokens.`);
    highlight(s, "yes", `Frederik said yes to his project "${p.title}"!`);
  } else {
    p.status = "said no";
    s.objects.planboard = "empty";
    s.needs = applyEffect(s.needs, { feisty: 0.2 });
    note(s, `Frederik said not now to his project "${p.title}".`);
    highlight(s, "no", `Frederik said not now to his project "${p.title}".`);
  }
  return p;
}

/** Frederik pressed Give more or Stop on a project that ran out of tokens. */
export function resolveMore(s: State, id: string, approved: boolean): Project | undefined {
  const p = s.projects.find(x => x.id === id && x.status === "needs more tokens");
  if (!p) return undefined;
  const extra = p.askedMore ?? 0;
  if (approved) {
    p.budget = Math.max(p.budget, p.used) + extra;
    p.askedMore = undefined;
    p.status = "working";
    note(s, `Frederik gave "${p.title}" ${extra} more tokens.`);
  } else {
    p.status = "stopped";
    s.objects.planboard = "empty";
    note(s, `Frederik stopped the project "${p.title}". It got ${p.pieces.length} of ${p.steps.length} steps done.`);
    highlight(s, "project", `Stopped the project "${p.title}" after ${p.pieces.length} of ${p.steps.length} steps.`);
  }
  return p;
}

/**
 * Creative choices are his own. A message that hands a choice to Frederik ("what should my friend
 * be called?", "can you pick?") is not sent; the prompt tells him to decide and say what he chose.
 */
export function asksFrederikToChoose(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.includes("?")) return false;
  return /\b(what|which) (should|do you think) (it|he|she|they|my friend|the friend|i)\b/.test(t)
    || /\bwhat (name|colou?r|shape|kind)\b/.test(t)
    || /\b(should i (call|name)|what should i (call|name|make|build|design))\b/.test(t)
    || /\b(can|could|would|will) you (pick|choose|decide|name)\b/.test(t)
    || /\b(you (pick|choose|decide)|help me (choose|pick|decide))\b/.test(t)
    || /\bwhat do you want (it|my friend|the friend) to\b/.test(t)
    || /\bwhich (name|one|colou?r|kind)\b.*\b(you|best|better)\b/.test(t);
}

/** Messages that only ask Frederik for company. He should write to show something or ask a real question. */
export function asksForCompany(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(hang ?out|play) with me\b/.test(t) || /\bcan we (hang ?out|play|talk)\b/.test(t)
    || /\b(i miss you|keep me company|come (over|by|visit)|visit me|spend time with me|are you there|i('| a)m (so |very )?lonely|i feel (so |very )?lonely)\b/.test(t)
    || /\bwant(s)? to hang ?out\b/.test(t);
}

// ---------- Friends with a mind of their own ----------

/** Lil guy decided a friend has a mind of their own. It only starts thinking once Frederik approves the cost. */
export async function askForMind(s: State, f: Friend, like: string, model: string, out: Outbox) {
  f.mind = newMind(like, model);
  note(s, `Decided that ${f.name} has a mind of their own: ${f.mind.like} The wishmaster asked Frederik about the cost.`);
  highlight(s, "friend", `Decided that ${f.name} has a mind of their own.`);
  await out.askMind?.(f, `He designed ${f.name} that way himself.`);
}

/** Frederik pressed Approve or Not now on a friend's mind. */
export function resolveMind(s: State, friendId: string, approved: boolean): Friend | undefined {
  const f = s.friends?.find(x => x.id === friendId && x.mind?.status === "waiting");
  if (!f?.mind) return undefined;
  const m = f.mind;
  m.decidedAt = new Date().toISOString();
  if (approved) {
    m.status = "on"; m.monthly = m.estimate.tokens; m.used = 0; m.month = m.decidedAt.slice(0, 7);
    s.needs = applyEffect(s.needs, { company: 0.2, fulfilled: 0.1 });
    note(s, `Frederik said yes: ${f.name} has a mind of their own now!`);
    highlight(s, "friend", `${f.name} woke up with a mind of their own!`);
  } else {
    m.status = "said no";
    note(s, `Frederik said not now to a mind for ${f.name}.`);
    highlight(s, "no", `Frederik said not now to a mind for ${f.name}.`);
  }
  return f;
}

/** Friends with a mind think now and then by themselves, within the tokens Frederik approved for the month. */
export async function friendsThink(s: State, brain: Brain, out: Outbox) {
  if (s.sleeping || !brain.friendThink) return;
  for (const f of s.friends ?? []) {
    const m = f.mind;
    if (!m || !due(m)) continue;
    m.lastAt = new Date().toISOString();
    const rest = async () => {
      m.status = "resting";
      note(s, `${f.name}'s mind used all of this month's thinking and is resting until next month.`);
      await out.inform(`${f.name}'s own mind used the ${m.monthly.toLocaleString("da-DK")} tokens you approved for this month (about ${kr(m.spentDkk)} so far in total). It rests until next month and then starts again by itself.`);
    };
    if (!canAfford(m)) { await rest(); continue; }
    let res;
    try { res = await brain.friendThink(s, f, m.monthly - m.used); }
    catch (e) { note(s, `${f.name} seemed lost in thought (${(e as Error).message}).`); continue; }
    if (res === "over budget") { await rest(); continue; }
    m.used += res.tokens;
    m.spentDkk += res.dkk;
    if (res.thought) m.thought = res.thought.slice(0, 200);
    const say = res.say?.trim().slice(0, 200);
    if (say) {
      m.said = { at: new Date().toISOString(), text: say };
      const near = findObject(s, s.place)?.area === findObject(s, f.id)?.area;
      if (near) s.needs = applyEffect(s.needs, { company: 0.05 });
      note(s, `${f.name} said${near ? "" : " (from far away)"}: "${say}"`);
    }
  }
}

