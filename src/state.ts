// Everything lil guy is, saved as one JSON file so he survives restarts.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { freshNeeds, type Needs } from "./needs.js";
import type { Built, SecretState } from "./world.js";
import type { Project } from "./workshop.js";
import type { Mailbox } from "./computer.js";
import type { Mail } from "./email.js";
import type { Self } from "./self.js";
import type { Friend } from "./friends.js";
import { mood, type Mood } from "./needs.js";

export interface DiaryEntry { at: string; text: string }
/** A moment worth remembering, for the Highlights on his page. */
export type HighlightKind = "first" | "wish" | "yes" | "no" | "built" | "mood" | "chat" | "gift" | "project" | "secret" | "wonder" | "theory" | "self" | "goal" | "ritual" | "oops" | "friend";
export interface Highlight { at: string; kind: HighlightKind; text: string }
export interface PendingWish { id: string; item: string; need: string; reason: string; at: string; messageId?: number; looks?: string }

/** His "I wonder" for the day: something he picked to find out or try. */
export interface Wonder {
  /** The day in Denmark it is for, YYYY-MM-DD. */
  day: string;
  text: string;
  at: string;
  /** How many different things he had done when he picked it; answering needs something new. */
  triedAtStart: number;
  /** What he found out, once he did. */
  answer?: string;
  answeredAt?: string;
}

export interface State {
  needs: Needs;
  /** The id of the thing he is next to (bed, rug, doorstep, a built place...). */
  place: string;
  /** Object states that differ from the map, e.g. { lamp: "on" }. */
  objects: Record<string, string>;
  /** Places built outside after Frederik said yes to a wish. */
  built: Built[];
  /** The last thing he did with an object, for the web page's animation. */
  last?: { object: string; verb: string; line: string; at: string };
  /** What waits on his little computer: things to tell Frederik, and Frederik's unread messages. */
  computer?: Mailbox;
  /** His own email address and inbox (lilguy@gokkehub.com). */
  mail?: Mail;
  sleeping: boolean;
  paused: boolean;
  items: string[];
  /** How many times he has done each thing, for the novelty reward. */
  tried: Record<string, number>;
  /** When he last did each thing, so a repeat's reward can recover over time. */
  lastTried: Record<string, string>;
  diary: DiaryEntry[];
  /** The moments worth remembering, newest last. */
  highlights: Highlight[];
  pending: PendingWish[];
  /** Secrets in his world he has noticed or found, by id. */
  secrets: Record<string, SecretState>;
  /** Today's "I wonder" goal. */
  wonder?: Wonder;
  /** Friends he designed, who now live in his world. */
  friends?: Friend[];
  /** His own projects from the workshop, each with a token budget Frederik approved. */
  projects: Project[];
  ownerChatId?: number;
  telegramOffset: number;
  /** Messages he sent Frederik today, for the daily limit. */
  sentToday: { day: string; count: number };
  /** Recent conversation with Frederik, newest last. */
  chat: { from: "frederik" | "lil guy"; text: string }[];
  ticks: number;
  /** Who he is: what he picked about himself, his theories, his goal in life. Missing until he has picked. */
  self?: Self;
  /** He feels proud until this time (after a secret, a finished project, a second try that worked...). */
  proudUntil?: string;
  /** The thing he just got wrong, so getting it right next time feels extra good. */
  oops?: string;
  /** The Danish day of his last morning and bedtime rituals. */
  rituals?: { morning?: string; bedtime?: string };
}

/** How long a proud moment lasts. */
export const PROUD_MS = 20 * 60_000;

export function feelProud(s: State, now = Date.now()) {
  s.proudUntil = new Date(now + PROUD_MS).toISOString();
}

/** His mood right now, including being proud of something he just did. */
export function moodOf(s: State, now = Date.now()): Mood {
  return mood(s.needs, s.sleeping, !!s.proudUntil && Date.parse(s.proudUntil) > now);
}

export function freshState(): State {
  return {
    needs: freshNeeds(), place: "bed", objects: {}, built: [], sleeping: false, paused: false, items: [], tried: {}, lastTried: {}, secrets: {},
    diary: [], highlights: [], pending: [], projects: [], telegramOffset: 0, sentToday: { day: "", count: 0 }, chat: [], ticks: 0,
  };
}

export function load(path: string): State {
  let s: State;
  try { s = { ...freshState(), ...JSON.parse(readFileSync(path, "utf8")) }; }
  catch { return freshState(); }
  backfillHighlights(s);
  return s;
}

export function save(path: string, s: State) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, path);
}

export function note(s: State, text: string) {
  s.diary.push({ at: new Date().toISOString(), text });
  if (s.diary.length > 300) s.diary.splice(0, s.diary.length - 300);
  console.log(`[diary] ${text}`);
}

const SAME_KIND_GAP_MS: Partial<Record<HighlightKind, number>> = { chat: 3 * 3600_000, mood: 2 * 3600_000, oops: 2 * 3600_000 };

/** Keep a moment for the Highlights. Chats and mood swings are kept at most every few hours. */
export function highlight(s: State, kind: HighlightKind, text: string) {
  s.highlights ??= [];
  const gap = SAME_KIND_GAP_MS[kind];
  const lastSame = [...s.highlights].reverse().find(h => h.kind === kind);
  if (gap && lastSame && Date.now() - Date.parse(lastSame.at) < gap) return;
  s.highlights.push({ at: new Date().toISOString(), kind, text: text.slice(0, 200) });
  if (s.highlights.length > 100) s.highlights.splice(0, s.highlights.length - 100);
}

/** For a lil guy who lived before highlights existed: pick them out of his diary once. */
export function backfillHighlights(s: State) {
  if (s.highlights?.length || !s.diary.length) return;
  s.highlights = [];
  for (const d of s.diary) {
    const t = d.text;
    let h: Highlight | undefined;
    if (/^Frederik said yes! A (.+) was built outside\./.test(t)) h = { at: d.at, kind: "built", text: t.replace(/^Frederik said yes! /, "") };
    else if (/^Frederik said yes to /.test(t)) h = { at: d.at, kind: "yes", text: t };
    else if (/^Frederik said not now to /.test(t)) h = { at: d.at, kind: "no", text: t };
    else if (/^Wished for .+ The wishmaster gave him /.test(t)) h = { at: d.at, kind: "gift", text: t.replace(/^Wished for .+?\. The wishmaster gave him ([^:]+):.*/, "Got $1 from the wishmaster.") };
    else if (/^Wished for .+ The wishmaster asked Frederik\./.test(t)) h = { at: d.at, kind: "wish", text: t.replace(/ The wishmaster asked Frederik\./, "") };
    else if (/for the first time!$|\(new!\)$/.test(t) && !/^(Tried|Looked closely)/.test(t)) h = { at: d.at, kind: "first", text: /\(new!\)$/.test(t) ? `First time: ${t.replace(/ \(new!\)$/, "")}` : t };
    if (h) s.highlights.push(h);
  }
  if (s.highlights.length > 100) s.highlights.splice(0, s.highlights.length - 100);
}

export function remember(s: State, from: "frederik" | "lil guy", text: string) {
  s.chat.push({ from, text });
  if (s.chat.length > 20) s.chat.splice(0, s.chat.length - 20);
}
