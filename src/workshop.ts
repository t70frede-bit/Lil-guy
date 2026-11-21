// Lil guy's workshop: where he plans and works on his own projects, like designing a new friend.
// The rule: every project comes with a token estimate and a price in DKK, and nothing starts
// until Frederik presses Approve on Telegram. Once approved, the project can never use more
// tokens than Frederik said yes to. If it runs out, it stops and asks for more.

import { randomUUID } from "node:crypto";
import type { NeedName } from "./needs.js";

export const PROJECT_KINDS = ["friend", "game", "story", "invention", "drawing", "other"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export interface FriendDesign {
  name: string; looks: string; shape: string; colour: string; personality: string; likes: string;
}
export interface ProjectPiece { at: string; step: string; text: string; tokens: number }
export type ProjectStatus = "waiting" | "working" | "needs more tokens" | "done" | "said no" | "stopped";

export interface Project {
  id: string;
  title: string;
  kind: ProjectKind;
  idea: string;
  need: string;
  steps: string[];
  /** What he thinks it will cost, worked out by code before Frederik is asked. */
  estimate: { tokens: number; dkk: number };
  /** The most tokens it may use. Starts at 0 and is only raised by Frederik pressing Approve. */
  budget: number;
  used: number;
  /** What it has really cost so far, from the token counts the API sends back. */
  spentDkk?: number;
  /** Extra tokens the wishmaster asked Frederik for, when it ran out. */
  askedMore?: number;
  status: ProjectStatus;
  pieces: ProjectPiece[];
  friend?: FriendDesign;
  at: string;
  messageId?: number;
}

/** USD per million tokens, input and output. Unknown models get Opus prices, so we never under-estimate. */
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.10, 0.50],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
export const USD_TO_DKK = Number(process.env.USD_TO_DKK ?? 6.9);

export function priceOf(model: string): [number, number] {
  return PRICES[model] ?? [Number(process.env.PRICE_IN_PER_M ?? 4), Number(process.env.PRICE_OUT_PER_M ?? 20)];
}

/** Upper limit on what he writes per work session, so each step has a known worst-case cost. */
export const MAX_OUTPUT_PER_STEP = 900;
/** Rough size of what he reads per work session: who he is, the project, and a little of what came before. */
const INPUT_BASE = 1800;
const INPUT_PER_EARLIER_PIECE = 350;

/** The worst-case tokens for one work session at step i (0-based). */
export function stepTokens(i: number) {
  const input = INPUT_BASE + Math.min(i, 4) * INPUT_PER_EARLIER_PIECE;
  return { input, output: MAX_OUTPUT_PER_STEP };
}

/** Code, not AI, works out the estimate, so he cannot talk it down. A 20% margin is added on top. */
export function estimate(steps: number, model: string, from = 0): { tokens: number; dkk: number } {
  const [pin, pout] = priceOf(model);
  let input = 0, output = 0;
  for (let i = from; i < from + steps; i++) { const t = stepTokens(i); input += t.input; output += t.output; }
  input = Math.ceil(input * 1.2); output = Math.ceil(output * 1.2);
  const dkk = ((input * pin + output * pout) / 1e6) * USD_TO_DKK;
  return { tokens: input + output, dkk: Math.ceil(dkk * 100) / 100 };
}

export function costDkk(tokens: number, model: string): number {
  // Priced as if every token were output, the expensive kind, to stay on the safe side.
  return (tokens * priceOf(model)[1] / 1e6) * USD_TO_DKK;
}

export function kr(dkk: number): string {
  if (dkk < 0.01) return "less than 1 øre";
  return `${dkk.toFixed(2).replace(".", ",")} kr`;
}

const NEED_NAMES: NeedName[] = ["energy", "curiosity", "company", "feisty", "fulfilled"];

export interface Proposal { title?: string; kind?: string; idea?: string; need?: string; steps?: string[] }

/** Turn his proposal into a project waiting for Frederik. Returns why not, if it is not a real proposal. */
export function makeProject(p: Proposal, model: string): Project | string {
  const title = (p.title ?? "").trim().slice(0, 80);
  const idea = (p.idea ?? "").trim().slice(0, 500);
  if (!title || !idea) return "A project needs a name and an idea.";
  const kind = (PROJECT_KINDS as readonly string[]).includes(p.kind ?? "") ? p.kind as ProjectKind : /friend|buddy|pal/i.test(title + idea) ? "friend" : "other";
  const steps = (p.steps ?? []).map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 8);
  if (steps.length < 2) return "A project needs a plan of at least two steps.";
  const need = NEED_NAMES.find(n => (p.need ?? "").toLowerCase().includes(n)) ?? "";
  return {
    id: randomUUID().slice(0, 8), title, kind, idea, need, steps,
    estimate: estimate(steps.length, model), budget: 0, used: 0, status: "waiting", pieces: [], at: new Date().toISOString(),
  };
}

export function activeProject(projects: Project[]): Project | undefined {
  return projects.find(p => p.status === "working");
}
export function waitingProject(projects: Project[]): Project | undefined {
  return projects.find(p => p.status === "waiting" || p.status === "needs more tokens");
}

/** Can the next step run without going over what Frederik approved? */
export function canAffordNextStep(p: Project): boolean {
  const t = stepTokens(p.pieces.length);
  return p.used + t.input + t.output <= p.budget;
}

/** Tokens to finish the remaining steps, for asking Frederik for more. */
export function tokensToFinish(p: Project, model: string): { tokens: number; dkk: number } {
  return estimate(Math.max(1, p.steps.length - p.pieces.length), model, p.pieces.length);
}
