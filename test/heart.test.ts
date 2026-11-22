import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleBrain } from "../src/brain.js";
import { doMove, luck, step, type Outbox } from "../src/lilguy.js";
import { freshNeeds } from "../src/needs.js";
import { snapshot } from "../src/publish.js";
import { addTheory, applyPick, applyReflection, GOAL_MIN_NIGHTS, selfText } from "../src/self.js";
import { freshState, moodOf, type State } from "../src/state.js";
import { objectsOf } from "../src/world.js";

function outbox(log: string[] = []): Outbox {
  return {
    async say(t) { log.push(`say: ${t}`); }, async ask() {}, async inform(t) { log.push(`inform: ${t}`); },
    async propose() {}, async askMore() {},
  };
}

async function withSelf(): Promise<State> {
  const s = freshState();
  applyPick(s, await new RuleBrain().pickSelf(), objectsOf(s));
  return s;
}

test("the first time he is awake he decides things about himself, once, and tells Frederik", async () => {
  luck.mishapChance = 0;
  const s = freshState();
  const log: string[] = [];
  await step(s, new RuleBrain(), outbox(log));
  assert.ok(s.self, "he has a self after his first step");
  assert.equal(s.self!.colour, "dandelion yellow");
  assert.equal(s.self!.names.lamp, "the glowy");
  assert.equal(s.self!.names.plant, "Sprout", "names stick to real things by their plain name");
  assert.equal(s.self!.goal, "", "he does not decide his goal in life on the spot");
  assert.ok(log.some(l => l.startsWith("say: I decided some things")));
  const picked = s.self!.pickedAt;
  await step(s, new RuleBrain(), outbox(log));
  assert.equal(s.self!.pickedAt, picked, "he only picks once");
});

test("he thinks about his goal in life for several nights before deciding", async () => {
  const s = await withSelf();
  const brain = new RuleBrain();
  const log: string[] = [];
  for (let night = 1; night <= GOAL_MIN_NIGHTS; night++) {
    s.sleeping = true;
    s.self!.reflectedDay = undefined; // a new night
    const r = await brain.reflect(s);
    const decided = applyReflection(s, r);
    if (night < GOAL_MIN_NIGHTS) assert.equal(s.self!.goal, "", `not decided after night ${night}`);
    else assert.ok(decided && s.self!.goal, "decides once he has thought long enough");
  }
  // Even a confident answer on the first night is not taken.
  const t = await withSelf();
  applyReflection(t, { goal_thoughts: "Hmm.", goal: "Be a pilot", goal_why: "Wings." });
  assert.equal(t.self!.goal, "");
  // The reflection in step() tells Frederik when he decides.
  const u = await withSelf();
  u.sleeping = true; u.needs = { ...freshNeeds(), energy: 0.1 };
  u.self!.goalThoughts.push(...Array.from({ length: GOAL_MIN_NIGHTS - 1 }, () => ({ at: "", text: "thinking" })));
  await step(u, brain, outbox(log));
  assert.ok(u.self!.goal);
  assert.ok(log.some(l => l.includes("goal in life")), "he tells Frederik what he decided");
  assert.ok(u.highlights.some(h => h.kind === "goal"));
});

test("he only reflects once a night", async () => {
  const s = await withSelf();
  s.sleeping = true; s.needs = { ...freshNeeds(), energy: 0.1 };
  await step(s, new RuleBrain(), outbox());
  const lines = s.self!.lines.length;
  await step(s, new RuleBrain(), outbox());
  assert.equal(s.self!.lines.length, lines);
});

test("theories can be new or change, and changing his mind is remembered", async () => {
  const s = await withSelf();
  addTheory(s, "the lamp", "It is a tiny sun that lives indoors.");
  addTheory(s, "The lamp", "It is a light you switch on with a button.");
  assert.equal(s.self!.theories.length, 1);
  assert.equal(s.self!.theories[0].was, "It is a tiny sun that lives indoors.");
  assert.ok(s.highlights.some(h => h.kind === "theory" && /Changed his mind/.test(h.text)));
  assert.match(selfText(s), /the lamp: It is a light/);
});

test("some first tries go wrong, and the second try feels extra good", async () => {
  const s = await withSelf();
  s.needs = { ...freshNeeds(), curiosity: 0.6 };
  luck.mishapChance = 1;
  await doMove(s, { type: "use", target: "lamp", action: "switch on" }, outbox());
  assert.equal(s.objects.lamp, undefined, "nothing happened the first time");
  assert.equal(s.tried["use:lamp:switch on"], undefined, "it still counts as a first next time");
  assert.equal(s.last?.verb, "oops");
  await doMove(s, { type: "use", target: "lamp", action: "switch on" }, outbox());
  assert.equal(s.objects.lamp, "on", "the second try always works");
  assert.equal(moodOf(s), "proud");
  luck.mishapChance = 0;
});

test("looking after his plant never fades, and it gets thirsty again every morning", async () => {
  luck.mishapChance = 0;
  const s = await withSelf();
  s.needs = { ...freshNeeds(), curiosity: 0.5, fulfilled: 0.2 };
  for (let i = 0; i < 4; i++) await doMove(s, { type: "use", target: "plant", action: "talk to it" }, outbox());
  s.needs.fulfilled = 0.3;
  const before = s.needs.fulfilled;
  const curiosity = s.needs.curiosity;
  await doMove(s, { type: "use", target: "plant", action: "talk to it" }, outbox());
  assert.ok(s.needs.fulfilled > before, "still feels good the fifth time");
  assert.ok(s.needs.curiosity <= curiosity, "and does not make him restless");
  await doMove(s, { type: "use", target: "plant", action: "water it" }, outbox());
  assert.equal(s.objects.plant, "perky");
  // bedtime and morning rituals
  await doMove(s, { type: "sleep" }, outbox());
  assert.ok(s.highlights.some(h => h.kind === "ritual" && /goodnight to Sprout/.test(h.text)));
  s.needs.energy = 0.94;
  s.self!.reflectedDay = "already";
  await step(s, new RuleBrain(), outbox());
  assert.equal(s.sleeping, false);
  assert.equal(s.objects.plant, "a bit thirsty");
  assert.ok(s.highlights.some(h => h.kind === "ritual" && /good morning to Sprout/.test(h.text)));
});

test("finding a secret makes him proud for a little while", async () => {
  luck.mishapChance = 0;
  const s = await withSelf();
  s.place = "rug";
  await doMove(s, { type: "look_closer", target: "rug" }, outbox());
  const secret = Object.keys(s.secrets)[0];
  assert.ok(secret);
  const { SECRETS } = await import("../src/world.js");
  const x = SECRETS.find(y => y.id === secret)!;
  await doMove(s, { type: "use", target: x.object, action: x.verb }, outbox());
  assert.equal(moodOf(s), "proud");
  assert.notEqual(moodOf(s, Date.now() + 3600_000), "proud", "the proud feeling passes");
});

test("his page shows who he is, but nothing private", async () => {
  const s = await withSelf();
  s.self!.treasured.push({ at: "", text: "Frederik said something nice" });
  const snap = snapshot(s, 180);
  assert.equal(snap.self?.colour, "dandelion yellow");
  assert.ok(!JSON.stringify(snap.self).includes("Frederik said something nice"));
});

test("his personality brief carries his style and his life into what he makes", async () => {
  const { personalityBrief } = await import("../src/self.js");
  const s = await withSelf();
  addTheory(s, "the lamp", "A tiny sun.");
  s.items.push("a bottle cap");
  const brief = personalityBrief(s, "proud");
  assert.match(brief, /round and has a little face/);
  assert.match(brief, /the lamp: A tiny sun/);
  assert.match(brief, /bottle cap/);
  assert.match(brief, /proud/);
  assert.equal(personalityBrief(freshState()), "", "no brief before he knows who he is");
});

test("a place he wished for is built the way he pictured it, in his colour", async () => {
  const { resolveWish } = await import("../src/lilguy.js");
  const s = await withSelf();
  s.pending.push({ id: "w1", item: "a bubble hut", need: "curiosity", reason: "", at: "", looks: "A round mint green hut with a bubble on top" });
  resolveWish(s, "w1", true);
  const b = s.built.at(-1)!;
  assert.equal(b.looks, "A round mint green hut with a bubble on top");
  assert.equal(b.colour, "dandelion yellow");
});
