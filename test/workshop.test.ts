import { test } from "node:test";
import assert from "node:assert/strict";
import { RuleBrain, type Brain, type WorkResult } from "../src/brain.js";
import { doMove, ensureWorkshop, resolveMore, resolveProject, step, type Outbox } from "../src/lilguy.js";
import { freshState } from "../src/state.js";
import { estimate, makeProject } from "../src/workshop.js";

function outbox(log: string[] = []): Outbox {
  return {
    async say() {}, async ask() {}, async inform(t) { log.push(`inform:${t}`); },
    async propose(p) { log.push(`propose:${p.title}:${p.estimate.tokens}`); },
    async askMore(p, m) { log.push(`more:${p.title}:${m.tokens}`); },
  };
}
const friendMove = { type: "propose_project" as const, item: "Design a friend", kind: "friend", text: "Someone to play with.", need: "company", steps: ["Looks", "Likes", "Name"] };

test("he gets a workshop once, on a plot outside", () => {
  const s = freshState();
  assert.equal(ensureWorkshop(s), true);
  assert.equal(ensureWorkshop(s), false);
  assert.equal(s.built.filter(b => b.buildable === "workshop").length, 1);
});

test("estimates grow with steps and are priced in DKK", () => {
  const a = estimate(2, "claude-haiku-5-5"), b = estimate(6, "claude-haiku-5-5");
  assert.ok(b.tokens > a.tokens * 2.5);
  assert.ok(a.dkk > 0 && a.dkk < 1);
  assert.ok(estimate(4, "unknown-model").dkk > estimate(4, "claude-haiku-5-5").dkk);
  assert.equal(typeof makeProject({ title: "x", idea: "y", steps: ["one"] }, "claude-haiku-5-5"), "string");
});

test("a project needs a real need and Frederik's yes before any work", async () => {
  const s = freshState(); ensureWorkshop(s);
  const log: string[] = [];
  await doMove(s, friendMove, outbox(log), new RuleBrain());
  assert.equal(s.projects.length, 0, "company is fine, so it is declined");

  s.needs.company = 0.1;
  await doMove(s, friendMove, outbox(log), new RuleBrain());
  assert.equal(s.projects.length, 1);
  assert.equal(s.projects[0].budget, 0);
  assert.ok(log.some(l => l.startsWith("propose:Design a friend:")));

  await doMove(s, { type: "work_on_project" }, outbox(log), new RuleBrain());
  assert.equal(s.projects[0].pieces.length, 0, "no work before approval");

  await doMove(s, friendMove, outbox(log), new RuleBrain());
  assert.equal(s.projects.length, 1, "only one project waiting at a time");

  resolveProject(s, s.projects[0].id, true);
  assert.equal(s.projects[0].budget, s.projects[0].estimate.tokens);
  for (let i = 0; i < 3; i++) await doMove(s, { type: "work_on_project" }, outbox(log), new RuleBrain());
  assert.equal(s.projects[0].status, "done");
  assert.equal(s.projects[0].friend?.name, "Bobble");
  assert.ok(log.some(l => l.startsWith("inform:Lil guy finished")));
});

test("a project stops at its budget and only goes on when Frederik gives more", async () => {
  const s = freshState(); ensureWorkshop(s); s.needs.company = 0.1;
  const greedy: Brain = Object.assign(new RuleBrain(), {
    async work(): Promise<WorkResult> { return { text: "lots", tokens: 4000, dkk: 0.01 }; },
  });
  const log: string[] = [];
  await doMove(s, friendMove, outbox(log), greedy);
  const p = s.projects[0];
  resolveProject(s, p.id, true);
  for (let i = 0; i < 5; i++) await doMove(s, { type: "work_on_project" }, outbox(log), greedy);
  assert.equal(p.status, "needs more tokens");
  assert.ok(p.used <= p.budget, "never goes over what was approved");
  assert.ok(log.some(l => l.startsWith("more:")));
  const done = p.pieces.length;
  await doMove(s, { type: "work_on_project" }, outbox(log), greedy);
  assert.equal(p.pieces.length, done, "no work while waiting");
  resolveMore(s, p.id, true);
  assert.equal(p.status, "working");
  await doMove(s, { type: "work_on_project" }, outbox(log), greedy);
  assert.equal(p.pieces.length, done + 1);
});

test("rule-based life with a workshop runs and makes projects", async () => {
  const s = freshState(); ensureWorkshop(s);
  const out = outbox();
  for (let i = 0; i < 300; i++) {
    await step(s, new RuleBrain(), out);
    for (const p of s.projects) if (p.status === "waiting") resolveProject(s, p.id, i % 3 !== 0);
    for (const w of [...s.pending]) (await import("../src/lilguy.js")).resolveWish(s, w.id, true);
  }
  assert.ok(s.projects.length >= 1);
  for (const v of Object.values(s.needs)) assert.ok(v >= 0 && v <= 1);
});

test("after a not now he waits before proposing again", async () => {
  const s = freshState(); ensureWorkshop(s); s.needs.company = 0.1;
  const log: string[] = [];
  await doMove(s, friendMove, outbox(log), new RuleBrain());
  resolveProject(s, s.projects[0].id, false);
  await doMove(s, friendMove, outbox(log), new RuleBrain());
  assert.equal(s.projects.length, 1);
  s.projects[0].decidedAt = new Date(Date.now() - 7 * 3600_000).toISOString();
  await doMove(s, friendMove, outbox(log), new RuleBrain());
  assert.equal(s.projects.length, 2);
});

test("a step the brain says would go over the budget stops the project", async () => {
  const s = freshState(); ensureWorkshop(s); s.needs.company = 0.1;
  const careful: Brain = Object.assign(new RuleBrain(), { async work(): Promise<"over budget"> { return "over budget"; } });
  const log: string[] = [];
  await doMove(s, friendMove, outbox(log), careful);
  resolveProject(s, s.projects[0].id, true);
  await doMove(s, { type: "work_on_project" }, outbox(log), careful);
  assert.equal(s.projects[0].status, "needs more tokens");
  assert.equal(s.projects[0].used, 0);
  assert.ok(log.some(l => l.startsWith("more:")));
});

test("a step that comes out broken is paid for but not counted as done", async () => {
  const s = freshState(); ensureWorkshop(s); s.needs.company = 0.1;
  const broken: Brain = Object.assign(new RuleBrain(), { async work(): Promise<WorkResult> { return { text: "", tokens: 1000, dkk: 0.001, failed: true }; } });
  await doMove(s, friendMove, outbox(), broken);
  resolveProject(s, s.projects[0].id, true);
  await doMove(s, { type: "work_on_project" }, outbox(), broken);
  assert.equal(s.projects[0].pieces.length, 0);
  assert.equal(s.projects[0].used, 1000);
});

test("he does not hand creative choices to Frederik", async () => {
  const { asksFrederikToChoose } = await import("../src/lilguy.js");
  for (const t of ["What should my friend be called?", "What should I name my friend?", "Can you pick a colour for my friend?", "What kind of friend should I make?", "Which name do you think is best?", "What do you want my friend to look like?"])
    assert.ok(asksFrederikToChoose(t), t);
  for (const t of ["I named my friend Bobble! He is blue.", "Are you awake?", "I made a friend called Pip. Do you like him?", "Hello Frederik!"])
    assert.ok(!asksFrederikToChoose(t), t);
  const s = freshState(); const said: string[] = [];
  await doMove(s, { type: "message", text: "What should my friend be called?" }, { ...outbox(), async say(t: string) { said.push(t); } });
  assert.equal(said.length, 0);
  await doMove(s, { type: "message", text: "I named my friend Pip!" }, { ...outbox(), async say(t: string) { said.push(t); } });
  assert.deepEqual(said, ["I named my friend Pip!"]);
});
