import { test } from "node:test";
import assert from "node:assert/strict";
import { RuleBrain } from "../src/brain.js";
import { doMove, ensureWorkshop, resolveProject, step, type Outbox, luck } from "../src/lilguy.js";
import { freshState, type State } from "../src/state.js";
import { friendFrom, kindOf, lookOf, moveInFinished } from "../src/friends.js";
import { findObject, objectsOf } from "../src/world.js";
import { makeProject, type Project } from "../src/workshop.js";

luck.mishapChance = 0;

function outbox(log: string[] = []): Outbox {
  return { async say() {}, async ask() {}, async inform(t) { log.push(`inform:${t}`); }, async propose() {}, async askMore() {} };
}

// Close to what he really wrote for Pip and Clicket.
function done(id: string, title: string, idea: string, friend: Project["friend"], latest = ""): Project {
  return { id, title, kind: "friend", idea, need: "company", steps: ["a", "b"], estimate: { tokens: 1, dkk: 0 }, budget: 1, used: 1, status: "done",
    pieces: [{ at: "2026-11-22T10:00:00Z", step: "b", text: latest, tokens: 1 }], friend, at: "2026-11-22T10:00:00Z" };
}
const pip1 = done("p1", "Design my bird friend Pip", "A small bird with blue wings and a loud song who sits on the windowsill and watches outside with me.", {
  name: "Pip", looks: "A small bird with a round puffy chest, bright blue wings and black eyes", shape: "Small, round and bean-like, with a short tail and tiny legs",
  colour: "Blue wings, a pale grey-white chest and orange feet", personality: "Proud, brave, a bit loud", likes: "Singing at sunrise, a round-topped perch, watching clouds" });
const pip2 = done("p2", "Make my bird friend Pip real", "My bird friend with blue wings and a loud song should sit on the windowsill.", {
  name: "Pip", looks: "A round ball with a round face, two bright eyes, a crumb beak, tiny arms and legs and a clover leaf on the chest", shape: "Round when content, bouncy when proud",
  colour: "Soft warm brown with puddle blue Sky Flaps", personality: "Warm, loud, proud, kind to the plant", likes: "Sitting on the perch in the sun, the Pip Pip Boing call" },
  "The sill fits Pip. The spot is sunny and wide.");
const clicket = done("c1", "Design my beetle friend Clicket", "A small round puddle-blue beetle who lives under the big stone and waves at everyone.", {
  name: "Clicket", looks: "Round with a face, dot eyes, a grin and two Sniffers, with a Found Dot on the shell", shape: "Round, bounces when proud",
  colour: "Puddle blue shell, the colour of sky", personality: "Kind, quiet, waves", likes: "Waiting under the stone's edge and clicking on the stone" });

test("Pip is a bird on the windowsill with blue wings, a grey-white chest and orange feet", () => {
  const f = friendFrom(pip1)!;
  assert.equal(f.kind, "bird");
  assert.equal(f.spot, "windowsill");
  assert.equal(f.look.wings, "blue");
  assert.equal(f.look.feet, "orange");
  assert.match(f.look.belly ?? "", /grey|white/);
  assert.ok(f.look.parts.includes("tail"));
});

test("his second Pip design is brown with puddle blue flaps and a clover", () => {
  const f = friendFrom(pip2)!;
  assert.equal(f.kind, "bird");
  assert.equal(f.spot, "windowsill");
  assert.equal(f.look.body, "warm brown");
  assert.equal(f.look.wings, "puddle blue");
  assert.ok(f.look.parts.includes("clover"));
});

test("Clicket is a puddle blue beetle by the big stone, outside", () => {
  const f = friendFrom(clicket)!;
  assert.equal(f.kind, "beetle");
  assert.equal(f.spot, "stone");
  assert.equal(f.look.body, "puddle blue");
  assert.ok(f.look.parts.includes("antennae"));
});

test("kinds come from the title first", () => {
  assert.equal(kindOf("Design my beetle friend", "waves at the birds"), "beetle");
  assert.equal(kindOf("Design a friend", "a fluffy round puff"), "blob");
  assert.equal(lookOf("blob", { name: "x", looks: "a puff", shape: "ball", colour: "", personality: "", likes: "" }, "dandelion yellow").body, "yellow");
});

test("friends he already finished move in once, and the newest look of Pip wins", async () => {
  const s: State = { ...freshState(), projects: [pip1, pip2, clicket] };
  const moved = moveInFinished(s);
  assert.deepEqual(moved.map(f => f.name), ["Pip", "Clicket"]);
  assert.equal(s.friends!.length, 2);
  assert.equal(s.friends![0].look.body, "warm brown");
  assert.deepEqual(moveInFinished(s), []);
  assert.equal(s.friends![0].look.body, "warm brown"); // the old design never comes back
  // On his first step after the update, it happens by itself and shows up in his highlights.
  const t: State = { ...freshState(), projects: [pip1, pip2, clicket] };
  await step(t, new RuleBrain(), outbox());
  assert.equal(t.friends!.length, 2);
  assert.ok(t.highlights.some(h => h.kind === "friend" && /Pip moved in/.test(h.text)));
});

test("friends are in his world: he can go to them and spend time with them", async () => {
  const s: State = { ...freshState(), projects: [pip2, clicket] };
  moveInFinished(s);
  const pip = findObject(s, "Pip")!;
  assert.equal(pip.area, "home");
  assert.equal(findObject(s, "Clicket")!.area, "outside");
  assert.ok(objectsOf(s).some(o => o.id === "friend-pip"));
  const before = s.needs.company;
  await doMove(s, { type: "use", target: "Pip", action: "listen to Pip" }, outbox());
  assert.equal(s.place, "friend-pip");
  assert.ok(s.needs.company > before);
  assert.match(s.last!.line, /sang/);
});

test("finishing a friend project moves the friend in straight away and tells Frederik", async () => {
  const s = freshState(); ensureWorkshop(s);
  const log: string[] = [];
  await doMove(s, { type: "propose_project", item: "Design a friend", kind: "friend", text: "Someone to play with.", need: "company", steps: ["Looks", "Name"] }, outbox(log), new RuleBrain());
  resolveProject(s, s.projects[0].id, true);
  const brain = new RuleBrain();
  for (let i = 0; i < 2; i++) await doMove(s, { type: "work_on_project" }, outbox(log), brain);
  assert.equal(s.projects[0].status, "done");
  assert.equal(s.friends?.length, 1);
  assert.equal(s.friends![0].name, "Bobble");
  const msg = log.find(l => l.startsWith("inform:Lil guy finished"))!;
  assert.match(msg, /Bobble has moved into his world/);
  assert.doesNotMatch(msg, /does not move in/);
});

test("bits of the form are not taken as steps", () => {
  const p = makeProject({ title: "Design Clicket", idea: "A beetle", steps: ["Draw Clicket", "Name the parts", "],", "need", "company"] }, "claude-haiku-5-5");
  assert.notEqual(typeof p, "string");
  assert.deepEqual((p as Project).steps, ["Draw Clicket", "Name the parts"]);
});
