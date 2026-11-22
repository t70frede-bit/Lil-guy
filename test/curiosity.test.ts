import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleBrain } from "../src/brain.js";
import { doMove, step, type Outbox } from "../src/lilguy.js";
import { drift, freshNeeds } from "../src/needs.js";
import { snapshot } from "../src/publish.js";
import { freshState } from "../src/state.js";
import { answerWonder, needsWonder, setWonder, today } from "../src/wonder.js";
import { availableActions, findObject, hiddenSecret, noveltyReward, SECRETS } from "../src/world.js";

const out: Outbox = { async say() {}, async ask() {}, async inform() {}, async propose() {}, async askMore() {} };

test("a first is worth a lot more than a repeat, and repeats wear off fast", () => {
  assert.ok(noveltyReward(0) >= 0.4);
  assert.ok(noveltyReward(1) <= noveltyReward(0) / 4);
  assert.ok(noveltyReward(3) < 0.02);
});

test("repeating the same thing makes him more restless, not less", async () => {
  const s = freshState();
  s.needs = { ...freshNeeds(), curiosity: 0.5 };
  await doMove(s, { type: "use", target: "ball", action: "kick" }, out);
  const afterFirst = s.needs.curiosity;
  assert.ok(afterFirst < 0.2, `first kick should satisfy curiosity, got ${afterFirst}`);
  for (let i = 0; i < 4; i++) await doMove(s, { type: "use", target: "ball", action: "kick" }, out);
  assert.ok(s.needs.curiosity > afterFirst, "kicking the ball over and over makes him restless");
});

test("curiosity builds faster", () => {
  let n = { ...freshNeeds(), curiosity: 0.1 };
  for (let i = 0; i < 10; i++) n = drift(n);
  assert.ok(n.curiosity >= 0.59, `10 ticks (30 min) should make him curious again, got ${n.curiosity}`);
});

test("secrets stay hidden until he looks closer, then he can find them", async () => {
  const s = freshState();
  s.place = "rug";
  const rug = findObject(s, "rug")!;
  assert.ok(!availableActions(s, rug).some(a => a.secret));
  await doMove(s, { type: "look_closer", target: "rug" }, out);
  assert.equal(s.secrets.floorboard, "noticed");
  assert.ok(availableActions(s, rug).some(a => a.verb === "lift the corner of the rug"));
  s.needs.fulfilled = 0.2;
  const before = s.needs.fulfilled;
  await doMove(s, { type: "use", target: "rug", action: "lift the corner of the rug" }, out);
  assert.equal(s.secrets.floorboard, "found");
  assert.ok(s.needs.fulfilled > before + 0.3, "finding a secret feels wonderful");
  assert.ok(s.highlights.some(h => h.kind === "secret"));
  // The marble only shows up once the floorboard is found.
  assert.equal(hiddenSecret(s, "rug")?.id, "marble");
});

test("the treasure map leads outside to the stone, then back to the shelf", async () => {
  const s = freshState();
  assert.equal(hiddenSecret(s, "stone")?.id, "beetles", "the dig spot is not there without the map");
  s.secrets.map = "found";
  assert.equal(hiddenSecret(s, "stone")?.id, "tinbox");
  s.secrets.tinbox = "found";
  assert.equal(hiddenSecret(s, "shelf")?.id, "keyhole");
});

test("shadow animals only appear when the lamp is on", () => {
  const s = freshState();
  assert.equal(hiddenSecret(s, "lamp"), undefined);
  s.objects.lamp = "on";
  assert.equal(hiddenSecret(s, "lamp")?.id, "shadows");
});

test("every secret points at a real thing", () => {
  const s = freshState();
  for (const x of SECRETS) assert.ok(findObject(s, x.object)?.id === x.object, x.id);
});

test("he picks one I wonder a day, and only answers it after doing something new", () => {
  const s = freshState();
  const morning = new Date("2026-11-23T08:00:00Z"); // 9:00 in Denmark
  assert.ok(needsWonder(s, morning));
  assert.ok(setWonder(s, "what is under the rug", morning));
  assert.equal(s.wonder?.text, "I wonder what is under the rug");
  assert.equal(s.wonder?.day, today(morning));
  assert.ok(!needsWonder(s, morning), "one a day");
  assert.equal(answerWonder(s, "A floorboard!", morning), "not yet");
  s.tried["use:rug:lift the corner of the rug"] = 1;
  const before = s.needs.fulfilled;
  assert.equal(answerWonder(s, "A floorboard!", morning), "answered");
  assert.ok(s.needs.fulfilled > before);
  // Next day, before 6 in the morning in Denmark: not yet. After: a new one.
  assert.ok(!needsWonder(s, new Date("2026-11-24T03:00:00Z")));
  assert.ok(needsWonder(s, new Date("2026-11-24T06:00:00Z")));
});

test("the rule brain picks a wonder and the page gets it", async () => {
  const s = freshState();
  s.place = "rug";
  await step(s, new RuleBrain(), out);
  assert.ok(s.wonder?.text.startsWith("I wonder"));
  const snap = snapshot(s, 180);
  assert.equal(snap.wonder?.text, s.wonder?.text);
  assert.deepEqual(snap.secrets, s.secrets);
});

test("a curious rule brain goes looking for secrets", async () => {
  const s = freshState();
  s.place = "rug";
  for (const o of ["bed", "shelf", "rug", "window", "lamp", "ball", "doorstep", "field", "stone"]) s.tried[`go:${o}`] = 1;
  s.needs = { ...freshNeeds(), curiosity: 0.9 };
  await step(s, new RuleBrain(), out);
  assert.ok(Object.keys(s.secrets).length > 0, "he noticed a secret");
});
