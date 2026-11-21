import assert from "node:assert/strict";
import { test } from "node:test";
import { RuleBrain } from "../src/brain.js";
import { build, doMove, resolveWish, step, type Outbox } from "../src/lilguy.js";
import { findObject } from "../src/world.js";
import { freshNeeds, mood, shape } from "../src/needs.js";
import { backfillHighlights, freshState } from "../src/state.js";
import { heardFromFrederik } from "../src/lilguy.js";
import { snapshot } from "../src/publish.js";
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

test("using a thing changes its state and feels new the first time", async () => {
  const s = freshState();
  const out: Outbox = { say: async () => {}, inform: async () => {}, ask: async () => {} };
  await doMove(s, { type: "use", target: "lamp", action: "switch on" }, out);
  assert.equal(s.objects.lamp, "on");
  assert.equal(s.place, "lamp");
  assert.equal(s.last?.verb, "switch on");
  await doMove(s, { type: "use", target: "lamp", action: "switch on" }, out); // not possible while on
  assert.equal(s.tried["use:lamp:switch on"], 1);
  await doMove(s, { type: "use", target: "the lamp", action: "switch off" }, out);
  assert.equal(s.objects.lamp, "off");
});

test("going outside works and keeps the go: reward key", async () => {
  const s = freshState();
  const out: Outbox = { say: async () => {}, inform: async () => {}, ask: async () => {} };
  await doMove(s, { type: "go", target: "outside" }, out);
  assert.equal(s.place, "field");
  assert.equal(s.tried["go:field"], 1);
});

test("an approved wish for a place gets built outside, and its things can be used", async () => {
  const s = freshState();
  s.needs.fulfilled = 0.1;
  const asked: string[] = [];
  const out: Outbox = { say: async () => {}, inform: async () => {}, ask: async (w, why) => { asked.push(why); } };
  await doMove(s, { type: "wish", item: "somewhere to draw pictures", need: "fulfilled" }, out);
  assert.match(asked[0], /built in his world/);
  resolveWish(s, s.pending[0].id, true);
  assert.equal(s.built.length, 1);
  assert.equal(s.built[0].buildable, "artcorner");
  await doMove(s, { type: "use", target: "easel", action: "paint" }, out);
  assert.equal(s.objects.easel, "painted");
});

test("an approved wish for an unknown place still gets built", () => {
  const s = freshState();
  const b = build(s, "a tiny museum of pebbles");
  assert.equal(b?.kind, "custom");
  assert.ok(findObject(s, b!.id));
});

test("old saved places still work", () => {
  for (const p of ["bed", "window", "rug", "shelf", "doorstep"]) assert.ok(findObject({ built: [] }, p), p);
});

test("highlights keep firsts, wishes and builds, but not repeats", async () => {
  const s = freshState();
  const out: Outbox = { async say() {}, async ask() {}, async inform() {} };
  await doMove(s, { type: "use", target: "lamp", action: "switch on" }, out);
  await doMove(s, { type: "use", target: "lamp", action: "switch off" }, out);
  await doMove(s, { type: "use", target: "lamp", action: "switch on" }, out);
  assert.equal(s.highlights.filter(h => h.kind === "first").length, 1);
  s.needs = { ...s.needs, curiosity: 0.9, fulfilled: 0.1 };
  s.pending.push({ id: "w1", item: "an art corner", need: "fulfilled", reason: "", at: new Date().toISOString() });
  resolveWish(s, "w1", true);
  assert.ok(s.highlights.some(h => h.kind === "built" && /art corner/.test(h.text)));
  heardFromFrederik(s); heardFromFrederik(s);
  assert.equal(s.highlights.filter(h => h.kind === "chat").length, 1);
  assert.ok(snapshot(s, 180).highlights.length >= 3);
});

test("an older lil guy gets highlights picked from his diary", () => {
  const s = freshState();
  s.diary = [
    { at: "2026-11-21T10:00:00Z", text: "Rolled around on the rug." },
    { at: "2026-11-21T10:05:00Z", text: "Switched the lamp on. Light! (new!)" },
    { at: "2026-11-21T10:10:00Z", text: "Frederik said yes! A little cinema was built outside." },
    { at: "2026-11-21T10:15:00Z", text: "Tried humming (new!)." },
  ];
  backfillHighlights(s);
  assert.deepEqual(s.highlights.map(h => h.kind), ["first", "built"]);
});

test("a gift from the wishmaster becomes something he can use", async () => {
  const s = freshState();
  const out: Outbox = { async say() {}, async ask() {}, async inform() {} };
  s.needs = { ...s.needs, energy: 0.1 };
  await doMove(s, { type: "wish", item: "a warm blanket", need: "energy", reason: "I am cold and tired" } as any, out);
  assert.ok(s.items.includes("a warm blanket"));
  assert.equal(findObject(s, "blanket")?.id, "blanket");
  await doMove(s, { type: "use", target: "blanket", action: "spread it over the bed" }, out);
  assert.equal(s.objects.blanket, "spread out");
  assert.equal(s.last?.object, "blanket");
});

test("a present Frederik approved becomes a gift box", async () => {
  const s = freshState();
  s.pending.push({ id: "p1", item: "a toy car", need: "curiosity", reason: "", at: new Date().toISOString() });
  resolveWish(s, "p1", true);
  const box = findObject(s, "toy car");
  assert.equal(box?.id, "gift-toy-car");
  assert.equal(box?.kind, "giftbox");
});
