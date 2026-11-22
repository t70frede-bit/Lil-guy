import assert from "node:assert/strict";
import { test } from "node:test";
import { checkComputer, isInternetWish, leaveOnScreen, viaComputer } from "../src/computer.js";
import { doMove, type Outbox } from "../src/lilguy.js";
import { freshNeeds } from "../src/needs.js";
import { snapshot } from "../src/publish.js";
import { freshState } from "../src/state.js";
import { judge } from "../src/wishmaster.js";
import { findObject, objectsOf } from "../src/world.js";

function recorder() {
  const said: string[] = [];
  const out: Outbox = { say: async t => { said.push(t); }, inform: async () => {}, ask: async () => {}, propose: async () => {}, askMore: async () => {} };
  return { said, out };
}

test("his house has a little computer he can switch on", () => {
  const s = freshState();
  const c = findObject(s, "little computer");
  assert.equal(c?.id, "computer");
  assert.equal(c?.area, "home");
  assert.ok(objectsOf(s).some(o => o.id === "computer"));
});

test("a message makes him walk to his computer and send it from there", async () => {
  const s = freshState();
  s.place = "rug";
  const { said, out } = recorder();
  await doMove(s, { type: "message", text: "I found a clover under the stone." }, viaComputer(s, out));
  assert.deepEqual(said, ["I found a clover under the stone."]);
  assert.equal(s.place, "computer");
  assert.equal(s.objects.computer, "on");
  assert.equal(s.last?.object, "computer");
  // the page shows that he wrote, but never what he wrote
  assert.ok(!JSON.stringify(snapshot(s, 180)).includes("clover"));
});

test("asleep, he does not type: the message waits until he wakes up", async () => {
  const s = freshState();
  s.sleeping = true; s.place = "bed";
  const { said, out } = recorder();
  await viaComputer(s, out).say("I decided my goal in life.");
  assert.deepEqual(said, []);
  assert.equal(s.place, "bed");
  await checkComputer(s, out, async () => "unused");
  assert.deepEqual(said, [], "still asleep");
  s.sleeping = false;
  await checkComputer(s, out, async () => "unused");
  assert.deepEqual(said, ["I decided my goal in life."]);
  assert.equal(s.place, "computer");
  await checkComputer(s, out, async () => "unused");
  assert.equal(said.length, 1, "sent only once");
});

test("Frederik's message waits on the screen while he sleeps, and he answers when he wakes", async () => {
  const s = freshState();
  s.sleeping = true;
  leaveOnScreen(s, "How was your day?");
  assert.equal(s.objects.computer, "a message is waiting");
  const { said, out } = recorder();
  const read: string[] = [];
  s.sleeping = false;
  await checkComputer(s, out, async t => { read.push(t); return "I counted eleven birds."; });
  assert.deepEqual(read, ["How was your day?"]);
  assert.deepEqual(said, ["I counted eleven birds."]);
  assert.equal(s.objects.computer, "on");
});

test("a wish for the internet goes to Frederik and says it is not built yet", () => {
  assert.ok(isInternetWish("the internet"));
  assert.ok(isInternetWish("to browse websites"));
  assert.ok(!isInternetWish("a pebble"));
  const v = judge({ item: "the internet on my computer", need: "curiosity", reason: "" }, freshNeeds(), []);
  assert.equal(v.kind, "ask_frederik");
  assert.match(v.why, /not built yet/);
});
