import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleBrain } from "../src/brain.js";
import { resolveWish, step, type Outbox } from "../src/lilguy.js";
import { freshNeeds, mood, shape } from "../src/needs.js";
import { freshState } from "../src/state.js";
import { judge } from "../src/wishmaster.js";

test("a wish without a need is declined", () => {
  const v = judge({ item: "a rocket", need: "curiosity", reason: "" }, freshNeeds(), []);
  assert.equal(v.kind, "declined");
});

test("a needed free thing is granted", () => {
  const needs = { ...freshNeeds(), curiosity: 0.9 };
  const v = judge({ item: "a pebble", need: "curiosity", reason: "" }, needs, []);
  assert.equal(v.kind, "granted");
});

test("a free thing he already has does not help curiosity", () => {
  const needs = { ...freshNeeds(), curiosity: 0.9 };
  assert.equal(judge({ item: "a pebble", need: "curiosity", reason: "" }, needs, ["a pebble"]).kind, "declined");
});

test("a needed thing that is not free goes to Frederik", () => {
  const needs = { ...freshNeeds(), company: 0.1 };
  assert.equal(judge({ item: "Frederik to say hi", need: "company", reason: "" }, needs, []).kind, "ask_frederik");
});

test("mood decides the shape", () => {
  assert.equal(shape(mood({ ...freshNeeds(), company: 0.05 })), "cube");
  assert.equal(shape(mood({ ...freshNeeds(), feisty: 0.95 })), "spiky ball");
  assert.equal(shape(mood({ ...freshNeeds(), energy: 0.05 })), "droopy ball");
  assert.equal(shape(mood({ ...freshNeeds(), curiosity: 0.95 })), "ball");
});

test("lonely lil guy asks Frederik, and approval cheers him up", async () => {
  const s = freshState();
  s.needs.company = 0.1;
  const asked: string[] = [];
  const out: Outbox = { say: async () => {}, inform: async () => {}, ask: async w => { asked.push(w.item); } };
  await step(s, new RuleBrain(), out);
  assert.deepEqual(asked, ["Frederik to say hi"]);
  const before = s.needs.company;
  resolveWish(s, s.pending[0].id, true);
  assert.ok(s.needs.company > before + 0.4);
  assert.equal(s.pending.length, 0);
});

test("a day of rule-based life runs without errors and explores", async () => {
  const s = freshState();
  const out: Outbox = { say: async () => {}, inform: async () => {}, ask: async () => {} };
  for (let i = 0; i < 200; i++) {
    await step(s, new RuleBrain(), out);
    for (const p of [...s.pending]) resolveWish(s, p.id, i % 2 === 0);
  }
  assert.ok(Object.keys(s.tried).some(k => k.startsWith("go:")));
  for (const v of Object.values(s.needs)) assert.ok(v >= 0 && v <= 1);
});
