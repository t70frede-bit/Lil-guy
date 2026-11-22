// Who lil guy is, in his own words: the things he picked about himself, his theories about the
// world, what he treasures, and the lines he writes about himself while he sleeps.
// Plain code keeps track of it; the AI only fills it in (once at the start, then a little each night).

import { highlight, note, type State } from "./state.js";
import { applyEffect } from "./wishmaster.js";
import { today } from "./wonder.js";

/** One of his beliefs about what something is or is for. Often wrong, always his. */
export interface Theory { about: string; belief: string; at: string; was?: string }
export interface Moment { at: string; text: string }

export interface Self {
  colour: string;
  favourite: string;
  catchphrase: string;
  fear: string;
  /** How he likes to make things, e.g. "everything I make is round and has a face". */
  style: string;
  /** His own names for the things in his world, by object id. */
  names: Record<string, string>;
  /** His goal in life. Empty until he has thought about it for some nights and decided. */
  goal: string;
  goalWhy?: string;
  goalSetAt?: string;
  /** What he thought about his goal each night before deciding, newest last. */
  goalThoughts: Moment[];
  /** Small steps he took toward his goal. */
  goalSteps: Moment[];
  theories: Theory[];
  /** Lines he wrote about himself while sleeping, newest last. */
  lines: string[];
  treasured: Moment[];
  /** 0 = very scared of his fear, 1 = brave about it. */
  brave: number;
  pickedAt: string;
  /** The Danish day of his last night-time thinking. */
  reflectedDay?: string;
}

/** What he picks about himself the very first time. */
export interface SelfPick {
  colour: string; favourite: string; catchphrase: string; fear: string; style: string;
  names: { thing: string; name: string }[];
  /** First ideas for a goal in life. He does not decide yet: he thinks about it over several nights. */
  goal_ideas: string;
  /** What he tells Frederik about what he picked, in his own voice. */
  announce: string;
}

/** What he thinks about while asleep. */
export interface Reflection {
  /** 0 to 3 new lines about himself. */
  about_me?: string[];
  /** The moment from today he wants to keep. */
  treasure?: string;
  /** Beliefs he changed today. */
  theories?: { about: string; belief: string }[];
  /** His thinking tonight about his goal in life (while he has not decided yet). */
  goal_thoughts?: string;
  /** Only when he has really decided: his goal in life, and why. */
  goal?: string;
  goal_why?: string;
  /** A step he took toward his goal today, if any. */
  goal_step?: string;
  /** Did he get a little braver about his fear today? */
  braver?: boolean;
}

/** He thinks about his goal in life for at least this many nights before he may decide. */
export const GOAL_MIN_NIGHTS = 3;
const MAX_THEORIES = 10, MAX_LINES = 14, MAX_TREASURED = 12, MAX_GOAL_NOTES = 10;

const clean = (t: unknown, n: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const keep = <T>(list: T[], max: number) => { if (list.length > max) list.splice(0, list.length - max); };

/** His name for a thing, or its plain name. */
export function nameOf(s: State, id: string, plain: string): string {
  return s.self?.names[id] ?? plain;
}

/** Turn his first pick into his self. Names only stick to things that exist. */
export function applyPick(s: State, p: SelfPick, things: { id: string; name: string }[]): Self {
  const names: Record<string, string> = {};
  for (const n of p.names ?? []) {
    const t = clean(n.thing, 60).toLowerCase();
    const o = things.find(x => x.id === t || x.name.toLowerCase() === t) ?? things.find(x => t.includes(x.name.toLowerCase()) || t.includes(x.id));
    const name = clean(n.name, 30);
    if (o && name && !names[o.id]) names[o.id] = name;
  }
  const now = new Date().toISOString();
  s.self = {
    colour: clean(p.colour, 30) || "sunny yellow",
    favourite: clean(p.favourite, 80),
    catchphrase: clean(p.catchphrase, 60),
    fear: clean(p.fear, 100),
    style: clean(p.style, 200),
    names,
    goal: "",
    goalThoughts: p.goal_ideas ? [{ at: now, text: `First ideas: ${clean(p.goal_ideas, 300)}` }] : [],
    goalSteps: [],
    theories: [], lines: [], treasured: [], brave: 0, pickedAt: now,
  };
  note(s, `Decided some things about himself. Favourite colour: ${s.self.colour}. Catchphrase: "${s.self.catchphrase}".`);
  highlight(s, "self", `Decided who he is: favourite colour ${s.self.colour}, and his catchphrase is "${s.self.catchphrase}".`);
  return s.self;
}

/** A new belief, or a changed mind about an old one. */
export function addTheory(s: State, about: string, belief: string): Theory | undefined {
  if (!s.self) return undefined;
  const a = clean(about, 60), b = clean(belief, 200);
  if (!a || !b) return undefined;
  const old = s.self.theories.find(t => t.about.toLowerCase() === a.toLowerCase());
  if (old) {
    if (old.belief.toLowerCase() === b.toLowerCase()) return old;
    old.was = old.belief; old.belief = b; old.at = new Date().toISOString();
    s.needs = applyEffect(s.needs, { fulfilled: 0.08 });
    note(s, `Changed his mind about ${a}: he used to think "${old.was}", now he thinks "${b}".`);
    highlight(s, "theory", `Changed his mind about ${a}. Now he thinks: ${b}`);
    return old;
  }
  const t: Theory = { about: a, belief: b, at: new Date().toISOString() };
  s.self.theories.push(t);
  keep(s.self.theories, MAX_THEORIES);
  note(s, `New theory about ${a}: ${b}`);
  highlight(s, "theory", `New theory about ${a}: ${b}`);
  return t;
}

export function treasure(s: State, text: string) {
  if (!s.self) return;
  const t = clean(text, 200);
  if (!t || s.self.treasured.some(m => m.text === t)) return;
  s.self.treasured.push({ at: new Date().toISOString(), text: t });
  keep(s.self.treasured, MAX_TREASURED);
}

/** How many nights he has spent thinking about his goal. */
export function goalNights(self: Self): number {
  return self.goalThoughts.filter(t => !t.text.startsWith("First ideas")).length;
}

export function needsReflection(s: State, now = new Date()): boolean {
  return !!s.self && s.sleeping && s.self.reflectedDay !== today(now);
}

/** Fold a night of thinking into his self. Returns his goal if he decided on it tonight. */
export function applyReflection(s: State, r: Reflection, now = new Date()): string | undefined {
  const self = s.self;
  if (!self) return undefined;
  self.reflectedDay = today(now);
  for (const l of (r.about_me ?? []).slice(0, 3)) { const t = clean(l, 200); if (t) self.lines.push(t); }
  keep(self.lines, MAX_LINES);
  if (r.treasure) treasure(s, r.treasure);
  for (const t of (r.theories ?? []).slice(0, 3)) addTheory(s, t.about, t.belief);
  if (r.braver && self.fear) self.brave = Math.min(1, self.brave + 0.15);

  let decided: string | undefined;
  if (!self.goal) {
    if (r.goal_thoughts) { self.goalThoughts.push({ at: now.toISOString(), text: clean(r.goal_thoughts, 600) }); keep(self.goalThoughts, MAX_GOAL_NOTES); }
    // He has to think it over for a few nights first: no snap decisions about his whole life.
    if (r.goal && goalNights(self) >= GOAL_MIN_NIGHTS) {
      self.goal = clean(r.goal, 160);
      self.goalWhy = clean(r.goal_why, 400);
      self.goalSetAt = now.toISOString();
      s.needs = applyEffect(s.needs, { fulfilled: 0.4 });
      note(s, `After ${goalNights(self)} nights of thinking, he decided his goal in life: ${self.goal}`);
      highlight(s, "goal", `Decided his goal in life: ${self.goal}`);
      treasure(s, `The night I decided my goal in life: ${self.goal}`);
      decided = self.goal;
    }
  } else if (r.goal_step) {
    // A step toward his goal counts like a first: it feels great.
    self.goalSteps.push({ at: now.toISOString(), text: clean(r.goal_step, 200) });
    keep(self.goalSteps, MAX_GOAL_NOTES);
    s.needs = applyEffect(s.needs, { fulfilled: 0.3 });
    highlight(s, "goal", `A step toward his goal: ${clean(r.goal_step, 160)}`);
  }
  const lines = (r.about_me ?? []).length;
  note(s, `Thought about himself while sleeping${lines ? ` and wrote ${lines} new line${lines > 1 ? "s" : ""} about who he is` : ""}.`);
  return decided;
}

/** Who he is, for his prompts. */
export function selfText(s: State): string {
  const me = s.self;
  if (!me) return "";
  const names = Object.entries(me.names).map(([id, n]) => `${id} = "${n}"`).join(", ");
  const fear = me.fear ? `You are a bit scared of ${me.fear}${me.brave >= 0.7 ? ", but you have become quite brave about it" : me.brave >= 0.3 ? ", but you are getting braver" : ""}.` : "";
  return [
    `Things you decided about yourself: your favourite colour is ${me.colour}. You love ${me.favourite}. Your catchphrase is "${me.catchphrase}" (say it now and then, not every time). ${fear} When you make things: ${me.style}.`,
    names ? `Your own names for your things: ${names}. Use them.` : "",
    me.goal ? `Your goal in life: ${me.goal}.${me.goalWhy ? ` Why: ${me.goalWhy}` : ""} Little steps toward it feel wonderful.${me.goalSteps.length ? ` Steps so far: ${me.goalSteps.slice(-3).map(x => x.text).join("; ")}.` : ""}`
      : `You have not decided your goal in life yet. You are thinking about it carefully, a little every night. Notice what you love doing during the day; it will help you decide.`,
    me.theories.length ? `Your theories about your world (you may be wrong, and it is fine to change your mind when you learn more): ${me.theories.map(t => `${t.about}: ${t.belief}`).join("; ")}.` : "",
    me.lines.length ? `What you have learned about yourself:\n${me.lines.slice(-8).map(l => `- ${l}`).join("\n")}` : "",
    me.treasured.length ? `Moments you treasure (bring one up now and then when it fits): ${me.treasured.slice(-5).map(m => m.text).join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}

/** The public part of his self, for his world page. Nothing from his chats with Frederik. */
export function publicSelf(s: State) {
  const me = s.self;
  if (!me) return null;
  return {
    colour: me.colour, favourite: me.favourite, catchphrase: me.catchphrase, style: me.style, names: me.names,
    goal: me.goal, thinkingNights: me.goal ? undefined : goalNights(me),
    theories: me.theories.map(t => ({ about: t.about, belief: t.belief, was: t.was })),
    lines: me.lines.slice(-6),
  };
}
