// One step of lil guy's life, and how each move is carried out. No network code here,
// so it can be tested without Telegram or an API key.

import { randomUUID } from "node:crypto";
import type { Brain } from "./brain.js";
import { clamp, drift, mood, shape, sleepTick, type NeedName, type Needs } from "./needs.js";
import { highlight, note, type PendingWish, type State } from "./state.js";
import { availableActions, findAction, findBuildable, findObject, hiddenSecret, isBuildWish, moveEffect, noveltyReward, PLOTS, repeatBoredom, SECRET_JOY, type Built, type Move } from "./world.js";
import { answerWonder, needsWonder, setWonder } from "./wonder.js";
import { applyEffect, judge } from "./wishmaster.js";
import { activeProject, canAffordNextStep, kr, makeProject, recentlyToldNo, tokensToFinish, waitingProject, type Project } from "./workshop.js";
import { urgent } from "./needs.js";

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
  // New things fill him up and satisfy curiosity; doing the same thing again makes him restless.
  s.needs = applyEffect(s.needs, { fulfilled: r, curiosity: -r + repeatBoredom(times), feisty: times === 0 ? -0.05 : 0 });
  return times === 0;
}

export async function step(s: State, brain: Brain, out: Outbox): Promise<void> {
  if (s.paused) return;
  s.ticks++;
  const before = mood(s.needs, s.sleeping);

  if (s.sleeping) {
    s.needs = sleepTick(s.needs);
    if (s.items.includes("a warm blanket")) s.needs = applyEffect(s.needs, { energy: 0.02 }); // sleeps better tucked in
    if (s.needs.energy >= 0.95) { s.sleeping = false; note(s, "Woke up rested."); }
    return;
  }
  s.needs = drift(s.needs);

  let decision;
  try { decision = await brain.decide(s); }
  catch (e) { note(s, `Could not think clearly (${(e as Error).message}). Carried on.`); return; }

  note(s, `Thought: ${decision.thought}`);
  if (decision.wonder && needsWonder(s)) setWonder(s, decision.wonder);
  for (const move of decision.moves.slice(0, 3)) await doMove(s, move as Move & { reason?: string }, out, brain);
  if (decision.wonder_answer) answerWonder(s, decision.wonder_answer);

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

export async function doMove(s: State, move: Move & { reason?: string }, out: Outbox, brain?: Brain) {
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
      // The first time is the main line; after that, things like clouds look different each time.
      const line = action.lines?.length && !first ? action.lines[Math.floor(Math.random() * action.lines.length)] : action.lines?.length ? action.lines[0] : action.line;
      s.last = { object: obj.id, verb: action.verb, line, at: new Date().toISOString() };
      if (action.secret && s.secrets[action.secret] !== "found") {
        s.secrets[action.secret] = "found";
        s.needs = applyEffect(s.needs, SECRET_JOY);
        note(s, `${line} He found a secret!`);
        highlight(s, "secret", `Found a secret: ${line}`);
        break;
      }
      note(s, `${line}${first ? " (new!)" : ""}`);
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
    highlight(s, "project", p.friend ? `Finished designing a new friend: ${p.friend.name}!` : `Finished his project "${p.title}"!`);
    await out.inform(finishedMessage(p, brain.model)); // always: a finished project is what Frederik paid for
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

export function finishedMessage(p: Project, model: string): string {
  const f = p.friend;
  return [
    `Lil guy finished his project "${p.title}". It used ${p.used} of the ${p.budget} tokens you approved.`,
    f ? `His new friend design: ${f.name}. Looks: ${f.looks}. Shape: ${f.shape}. Colour: ${f.colour}. Personality: ${f.personality}. Likes: ${f.likes}.` : "",
    f ? "The friend does not move in by itself. If lil guy wants that, he will have to wish for it." : "",
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
