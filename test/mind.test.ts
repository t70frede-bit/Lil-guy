import { test } from "node:test";
import assert from "node:assert/strict";
import { RuleBrain, type MindResult } from "../src/brain.js";
import { doMove, ensureWorkshop, friendsThink, resolveMind, resolveProject, type Outbox, luck } from "../src/lilguy.js";
import { freshState, type State } from "../src/state.js";
import { moveInFinished } from "../src/friends.js";
import { MIND_EVERY_MIN, mindEstimate } from "../src/mind.js";
import type { Project } from "../src/workshop.js";

luck.mishapChance = 0;

function outbox(log: string[] = []): Outbox {
  return { async say() {}, async ask() {}, async inform(t) { log.push(`inform:${t}`); }, async propose() {}, async askMore() {}, async askMind(f) { log.push(`mind:${f.name}:${f.mind!.estimate.tokens}`); } };
}
const pip: Project = { id: "p2", title: "Make my bird friend Pip real", kind: "friend", idea: "A bird on the windowsill.", need: "company", steps: ["a", "b"],
  estimate: { tokens: 1, dkk: 0 }, budget: 1, used: 1, status: "done", pieces: [{ at: "x", step: "b", text: "", tokens: 1 }], at: "x",
  friend: { name: "Pip", looks: "A round bird with blue wings", shape: "round", colour: "brown with blue wings", personality: "loud, proud", likes: "singing" } };
const withPip = (): State => { const s: State = { ...freshState(), projects: [structuredClone(pip)] }; moveInFinished(s); return s; };

test("a mind costs a few kroner a month on Haiku, worked out by code", () => {
  const e = mindEstimate("claude-haiku-5-5");
  assert.ok(e.dkk > 1 && e.dkk < 6, `got ${e.dkk}`);
  assert.ok(mindEstimate("claude-opus-5-5").dkk > e.dkk);
});

test("a friend has no mind unless lil guy decides it", async () => {
  const s = withPip();
  assert.equal(s.friends![0].mind, undefined);
  await friendsThink(s, new RuleBrain(), outbox());
  assert.equal(s.friends![0].mind, undefined);
});

test("lil guy gives Pip a mind; it only thinks after Frederik approves the cost", async () => {
  const s = withPip(); const log: string[] = [];
  await doMove(s, { type: "give_friend_mind", target: "Pip", text: "Pip thinks in songs and worries about the weather." }, outbox(log), new RuleBrain());
  const m = s.friends![0].mind!;
  assert.equal(m.status, "waiting");
  assert.ok(log.some(l => l.startsWith("mind:Pip:")));
  await friendsThink(s, new RuleBrain(), outbox());
  assert.equal(m.used, 0); // nothing runs while waiting
  resolveMind(s, "friend-pip", true);
  assert.equal(m.status, "on");
  assert.equal(m.monthly, m.estimate.tokens);
  await friendsThink(s, new RuleBrain(), outbox());
  assert.equal(m.used, 2000);
  assert.equal(m.said?.text, "Hello, lil guy!");
  assert.ok(s.diary.some(d => /Pip said/.test(d.text)));
  // not again until it is time
  await friendsThink(s, new RuleBrain(), outbox());
  assert.equal(m.used, 2000);
  m.lastAt = new Date(Date.now() - MIND_EVERY_MIN * 60_000 - 1000).toISOString();
  await friendsThink(s, new RuleBrain(), outbox());
  assert.equal(m.used, 4000);
});

test("a mind never goes over the month's allowance, and rests until next month", async () => {
  const s = withPip(); const log: string[] = [];
  await doMove(s, { type: "give_friend_mind", target: "Pip", text: "simple" }, outbox(), new RuleBrain());
  resolveMind(s, "friend-pip", true);
  const m = s.friends![0].mind!;
  m.used = m.monthly - 100;
  await friendsThink(s, new RuleBrain(), outbox(log));
  assert.equal(m.status, "resting");
  assert.equal(m.used, m.monthly - 100);
  assert.ok(log.some(l => /rests until next month/.test(l)));
  m.month = "2000-01"; m.lastAt = undefined;
  await friendsThink(s, new RuleBrain(), outbox());
  assert.equal(m.status, "on");
  assert.equal(m.used, 2000);
});

test("a not now keeps Pip without a mind, and lil guy waits before asking again", async () => {
  const s = withPip();
  await doMove(s, { type: "give_friend_mind", target: "Pip", text: "simple" }, outbox(), new RuleBrain());
  resolveMind(s, "friend-pip", false);
  assert.equal(s.friends![0].mind!.status, "said no");
  const log: string[] = [];
  await doMove(s, { type: "give_friend_mind", target: "Pip", text: "simple again" }, outbox(log), new RuleBrain());
  assert.equal(log.length, 0);
  await friendsThink(s, new RuleBrain(), outbox());
  assert.equal(s.friends![0].mind!.used, 0);
});

test("a friend designed with a mind asks for it when the design is finished", async () => {
  const s = freshState(); ensureWorkshop(s);
  const log: string[] = [];
  const brain = new RuleBrain();
  brain.work = async (_s, p, step, last) => ({ text: `did ${step}`, tokens: 0, dkk: 0,
    ...(last ? { friend: { name: "Wobble", looks: "a green frog", shape: "round", colour: "green", personality: "sleepy", likes: "puddles", mind: "Wobble thinks slowly and loves rain." } } : {}) });
  await doMove(s, { type: "propose_project", item: "Design Wobble", kind: "friend", text: "A frog friend.", need: "company", steps: ["Looks", "Name"] }, outbox(log), brain);
  resolveProject(s, s.projects[0].id, true);
  for (let i = 0; i < 2; i++) await doMove(s, { type: "work_on_project" }, outbox(log), brain);
  const w = s.friends!.find(f => f.name === "Wobble")!;
  assert.equal(w.mind?.status, "waiting");
  assert.equal(w.mind?.like, "Wobble thinks slowly and loves rain.");
  assert.ok(log.some(l => l.startsWith("mind:Wobble:")));
});

test("minds rest while lil guy sleeps", async () => {
  const s = withPip();
  await doMove(s, { type: "give_friend_mind", target: "Pip", text: "simple" }, outbox(), new RuleBrain());
  resolveMind(s, "friend-pip", true);
  s.sleeping = true;
  const brain = new RuleBrain(); let called = 0;
  brain.friendThink = async (): Promise<MindResult> => { called++; return { thought: "", tokens: 1, dkk: 0 }; };
  await friendsThink(s, brain, outbox());
  assert.equal(called, 0);
});
