// A friend's own mind. Lil guy decides whether a friend he designs has one, and what it is like.
// A mind thinks now and then by itself (while lil guy is awake), and can say things to him.
// Thinking costs tokens, so like every project it comes with a code-made estimate and only runs
// once Frederik approves the cost: a monthly token allowance that is a hard cap.

import { priceOf, USD_TO_DKK } from "./workshop.js";

export interface FriendMind {
  /** What their mind is like, in lil guy's words. */
  like: string;
  /** waiting: Frederik has not answered yet. on: thinking. resting: used up this month. said no: Frederik said not now. */
  status: "waiting" | "on" | "resting" | "said no";
  estimate: { tokens: number; dkk: number };
  /** Tokens per month Frederik approved. 0 until he says yes. */
  monthly: number;
  /** The month (YYYY-MM) `used` counts for. */
  month: string;
  used: number;
  spentDkk: number;
  askedAt: string;
  decidedAt?: string;
  lastAt?: string;
  /** Their latest private thought, for the page. */
  thought?: string;
  /** The last thing they said to lil guy. */
  said?: { at: string; text: string };
  messageId?: number;
}

/** How often a mind thinks while lil guy is awake. */
export const MIND_EVERY_MIN = 20;
/** Worst case per thought: what it reads and the most it may write. */
export const MIND_INPUT = 1500;
export const MIND_OUTPUT = 250;
/** Lil guy is awake about this many hours a day; minds rest while he sleeps. */
const AWAKE_HOURS = 16;
/** After a "not now", lil guy waits this long before asking for the same friend again. */
export const MIND_COOLDOWN_MS = 3 * 24 * 3600_000;

export const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

/** Code, not AI, works out what a mind costs per month, with a 20% margin. */
export function mindEstimate(model: string): { tokens: number; dkk: number } {
  const thoughts = Math.ceil(AWAKE_HOURS * 60 / MIND_EVERY_MIN) * 30;
  const input = Math.ceil(thoughts * MIND_INPUT * 1.2), output = Math.ceil(thoughts * MIND_OUTPUT * 1.2);
  const [pin, pout] = priceOf(model);
  const dkk = ((input * pin + output * pout) / 1e6) * USD_TO_DKK;
  return { tokens: input + output, dkk: Math.ceil(dkk * 100) / 100 };
}

export function newMind(like: string, model: string, now = Date.now()): FriendMind {
  return { like: like.replace(/\s+/g, " ").trim().slice(0, 300), status: "waiting", estimate: mindEstimate(model), monthly: 0, month: monthKey(now), used: 0, spentDkk: 0, askedAt: new Date(now).toISOString() };
}

/** A new month: the allowance is fresh again. */
export function rollMonth(m: FriendMind, now = Date.now()) {
  const k = monthKey(now);
  if (m.month === k) return;
  m.month = k; m.used = 0;
  if (m.status === "resting") m.status = "on";
}

/** Is it time for this mind to think? */
export function due(m: FriendMind | undefined, now = Date.now()): boolean {
  if (!m) return false;
  rollMonth(m, now);
  if (m.status !== "on") return false;
  return !m.lastAt || now - Date.parse(m.lastAt) >= MIND_EVERY_MIN * 60_000;
}

/** Can one more thought run without going over what Frederik approved this month? */
export function canAfford(m: FriendMind): boolean {
  return m.used + MIND_INPUT + MIND_OUTPUT <= m.monthly;
}
