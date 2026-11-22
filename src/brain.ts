// The only part that uses AI: given how he feels and what he can do, pick 1 to 3 moves.
// Without an API key (or with DRY_RUN=1) a simple rule-based brain is used instead.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { CHARACTER } from "./character.js";
import { describe, mood, shape, urgent } from "./needs.js";
import type { State } from "./state.js";
import { AREAS, availableActions, BUILDABLES, findObject, hiddenSecret, MOVE_TYPES, noticedSecrets, objectsOf, SECRETS, stateOf } from "./world.js";
import { needsWonder, openWonder } from "./wonder.js";
import { FREE_THINGS } from "./wishmaster.js";
import { activeProject, recentlyToldNo, estimate, kr, MAX_OUTPUT_PER_STEP, PROJECT_KINDS, priceOf, USD_TO_DKK, waitingProject, type FriendDesign, type Project } from "./workshop.js";

const Decision = z.object({
  thought: z.string().describe("One short sentence in his own voice about what he is thinking."),
  moves: z.array(z.object({
    type: z.enum(MOVE_TYPES),
    target: z.string().optional().describe("For go and use: the name of a thing. For look_closer or try: what."),
    action: z.string().optional().describe("For use: one of the things you can do with it, exactly as listed."),
    item: z.string().optional().describe("For wish: the thing he wants."),
    need: z.string().optional().describe("For wish: which need it is for (energy, curiosity, company, feisty, fulfilled)."),
    reason: z.string().optional().describe("For wish: why you need it, in your own words."),
    text: z.string().optional().describe("For message: what he says to Frederik. For propose_project: the idea in two or three sentences."),
    kind: z.enum(PROJECT_KINDS).optional().describe("For propose_project: what sort of project."),
    steps: z.array(z.string()).optional().describe("For propose_project: the plan, 2 to 8 short steps. Each step is one work session."),
  })).min(1).max(3),
  wonder: z.string().optional().describe("Only when it is a new day and you are asked to: your I wonder for today, one thing you want to find out or try. Start with 'I wonder'."),
  wonder_answer: z.string().optional().describe("Only when you have really found out what you wondered about today: what you found out, in one sentence in your own voice."),
});
export type Decision = z.infer<typeof Decision>;

const Piece = z.object({
  text: z.string().describe("What you made in this work session, in your own words. At most about 300 words."),
  friend: z.object({
    name: z.string(), looks: z.string(), shape: z.string(), colour: z.string(), personality: z.string(), likes: z.string(),
  }).optional().describe("Only for a friend project, on the last step: the finished friend design."),
});

export interface WorkResult { text: string; friend?: FriendDesign; tokens: number; dkk: number; failed?: boolean }

export interface Brain {
  /** The model used, for working out what projects will cost. */
  model: string;
  decide(s: State): Promise<Decision>;
  reply(s: State, incoming: string): Promise<string>;
  /** One work session on one step of an approved project. */
  /** `remaining` is the approved tokens left; returns "over budget" instead of going over it. */
  work(s: State, p: Project, step: string, last: boolean, remaining: number): Promise<WorkResult | "over budget">;
}

function workshopText(s: State, model: string): string {
  if (!s.built.some(b => b.buildable === "workshop")) return "";
  const active = activeProject(s.projects), waiting = waitingProject(s.projects);
  const done = s.projects.filter(p => p.status === "done").map(p => p.title);
  const ex = estimate(4, model);
  return [
    `You have a workshop outside. There you can plan your own projects: designing a new friend, making up a game, writing a story, inventing a thing, a drawing, or something else.`,
    `To start one, use propose_project with a name (item), a kind, the idea (text), a plan of 2 to 8 steps, and the need it is for. The wishmaster works out how many tokens it will take (thinking costs tokens, and tokens cost Frederik money; 4 steps is about ${ex.tokens} tokens, ${kr(ex.dkk)}) and asks Frederik. Nothing happens until he says yes. Fewer steps cost less. You come up with the idea, the kind, the name and the plan yourself; Frederik only says yes or no to the cost.`,
    active ? `Your project right now: "${active.title}" (${active.kind}). Done ${active.pieces.length} of ${active.steps.length} steps. Next step: ${active.steps[active.pieces.length]}. Use work_on_project to work on it.` : "You have no project going right now.",
    waiting ? `Waiting for Frederik: "${waiting.title}" (${waiting.status}). You cannot start another project until he answers.` : "",
    recentlyToldNo(s.projects) ? "Frederik said not now to your last project idea a little while ago. Give it some hours before you ask for a new one." : "",
    done.length ? `Projects you have finished: ${done.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

function surroundings(s: State): string {
  const here = findObject(s, s.place);
  const area = here?.area ?? "home";
  const all = objectsOf(s);
  const line = (o: ReturnType<typeof objectsOf>[number]) => {
    const acts = availableActions(s, o).map(a => a.verb).join(" / ");
    return `- ${o.name} (${stateOf(s, o)}): ${o.desc}${acts ? ` You can: ${acts}.` : ""}`;
  };
  const other = AREAS.filter(a => a.id !== area);
  return [
    `You are in ${AREAS.find(a => a.id === area)?.name ?? area}, next to the ${here?.name ?? s.place}.`,
    `Things here:\n${all.filter(o => o.area === area).map(line).join("\n")}`,
    ...other.map(a => `Also ${a.name}: ${a.desc}. Things there: ${all.filter(o => o.area === a.id).map(o => o.name).join(", ")}.`),
    s.built.length ? `Things built for you so far: ${s.built.map(b => b.name).join(", ")}.` : "Nothing has been built outside yet.",
  ].join("\n");
}

function curiosityText(s: State): string {
  const found = SECRETS.filter(x => s.secrets?.[x.id] === "found").length;
  const noticed = noticedSecrets(s);
  const w = openWonder(s);
  return [
    `Your world is full of little secrets. Looking closer at a thing (look_closer with its name as target) is how you notice them. You have found ${found} so far${found < SECRETS.length ? ", and there are more hiding" : ""}.`,
    noticed.length ? `Things you noticed but have not checked yet: ${noticed.map(x => `${x.hint} (at the ${findObject(s, x.object)?.name ?? x.object}: you can "${x.verb}")`).join(" ")}` : "",
    needsWonder(s) ? `It is a new day! Pick your "I wonder" for today: one thing you want to find out or try today. Put it in the wonder field, starting with "I wonder". Pick something you can go and do.` : "",
    w ? `Today you wonder: "${w.text}" Go and find out! When you really have, write what you found out in wonder_answer.` : "",
    s.wonder?.answer && !w ? `You already found out what you wondered about today: ${s.wonder.answer}` : "",
  ].filter(Boolean).join("\n");
}

function situation(s: State, model: string): string {
  const m = mood(s.needs, s.sleeping);
  const recent = s.diary.slice(-12).map(d => `- ${d.text}`).join("\n") || "- nothing yet";
  const tried = Object.entries(s.tried).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k} (${v}x)`).join(", ") || "nothing yet";
  return [
    surroundings(s),
    `Your needs: ${describe(s.needs)}. Pressing right now: ${JSON.stringify(urgent(s.needs))}.`,
    `Your mood is ${m}, so your body is a ${shape(m)}.`,
    `Things you own: ${s.items.join(", ") || "nothing yet"}.`,
    `Things you have already done (doing new things feels much better than repeating): ${tried}.`,
    `Free things the wishmaster can give if you really need them: ${FREE_THINGS.map(t => `${t.name} (for ${t.meets})`).join(", ")}.`,
    `Outside is empty land. If a need keeps coming back, you can wish for a place or thing to be built out there, and the wishmaster asks Frederik. Ideas other little creatures have had: ${BUILDABLES.filter(b => !s.built.some(x => x.buildable === b.id)).map(b => `${b.name} (for ${b.meets})`).join(", ")}. You can also dream up your own.`,
    curiosityText(s),
    workshopText(s, model),
    `Wishes still waiting for Frederik: ${s.pending.map(p => p.item).join(", ") || "none"}.`,
    `What happened lately:\n${recent}`,
  ].filter(Boolean).join("\n");
}

const RULES = `Pick 1 to 3 moves from the menu. Rules:
- Only wish for something when one of your pressing needs explains it, and say which need. Wishes without a need get declined.
- Doing something for the very first time feels wonderful. Doing the same thing again feels like almost nothing and makes you restless. So always look for something new: a place you have not been, an action you have not tried, a thing you have not looked closely at. To use a thing, pick "use" with its name as target and one of its listed actions.
- Look closer at things. Many of them hide secrets, and finding one is the best feeling there is.
- Wishing for a place to be built is a big wish. Only do it when a need keeps coming back and nothing you have fixes it, and say which need.
- Only send Frederik a message when you have something real to say or ask. Keep it to one or two short sentences.
- Never ask Frederik to decide things for you, like what to make, what a friend should be or what its name should be. Decide yourself, put it in your project, and tell him what you picked. The only thing Frederik decides is yes or no on the cost, through the wishmaster.
- A project is a big thing. Only propose one when a need explains it (often fulfilled or curiosity, or company for a friend), and say which need. Keep the plan small.
- When you have an approved project, working on it in the workshop is a great way to spend your time.
- When energy is very low, sleep.`;

export class ClaudeBrain implements Brain {
  private client = new Anthropic();
  constructor(public model: string) {}

  async decide(s: State): Promise<Decision> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Decision) },
      system: [{ type: "text", text: `${CHARACTER}\n\n${RULES}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: situation(s, this.model) }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return { thought: "Hmm.", moves: [{ type: "wait" }] };
    return res.parsed_output;
  }

  async reply(s: State, incoming: string): Promise<string> {
    const history = s.chat.map(c => `${c.from}: ${c.text}`).join("\n");
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: `${CHARACTER}\n\nFrederik is messaging you on Telegram. Answer in one to three short sentences, in your own voice. Never promise things on behalf of the wishmaster. Do not ask him to choose things for you (names, looks, what to make); you decide those yourself and tell him.`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${situation(s, this.model)}\n\nRecent chat:\n${history}\n\nFrederik just wrote: ${incoming}` }],
    });
    if (res.stop_reason === "refusal") return "...";
    const text = res.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join(" ").trim();
    return text || "...";
  }

  async work(s: State, p: Project, step: string, last: boolean, remaining: number): Promise<WorkResult | "over budget"> {
    const before = p.pieces.slice(-2).map(x => `- ${x.step}: ${x.text.slice(0, 1200)}`).join("\n") || "- nothing yet, this is the first step";
    const request = {
      model: this.model,
      output_config: { effort: "low" as const, format: zodOutputFormat(Piece) },
      system: [{ type: "text" as const, text: `${CHARACTER}\n\nYou are in your workshop, working on one of your own projects that Frederik said yes to. Do one step at a time and write down what you made. Stay small and in your own voice. You cannot run code or reach the internet; you make ideas, plans, designs, rules and stories. Make every choice yourself (names, looks, colours, rules); never leave a question for Frederik to answer.`, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: [
        `Project: "${p.title}" (${p.kind}). Idea: ${p.idea}`,
        `Plan: ${p.steps.map((x, i) => `${i + 1}. ${x}`).join(" ")}`,
        `What you made so far (latest):\n${before}`,
        `Now do step ${p.pieces.length + 1}: ${step}.${last ? " This is the last step, so finish the project." : ""}${last && p.kind === "friend" ? " Fill in the friend design." : ""}`,
      ].join("\n\n") }],
    };
    // Hard cap: count what this step will read (free), and only let it write what is left of the budget.
    const counted = await this.client.messages.countTokens({ model: request.model, system: request.system, messages: request.messages, output_config: { format: request.output_config.format } });
    const input = Math.ceil(counted.input_tokens * 1.05);
    const maxOut = Math.min(MAX_OUTPUT_PER_STEP, remaining - input);
    if (maxOut < 300) return "over budget";
    const res = await this.client.messages.parse({ ...request, max_tokens: maxOut });
    const u = res.usage;
    const used = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const [pin, pout] = priceOf(this.model);
    const dkk = ((used * pin + u.output_tokens * pout) / 1e6) * USD_TO_DKK;
    const tokens = used + u.output_tokens;
    if (res.stop_reason === "refusal" || !res.parsed_output) return { text: "", tokens, dkk, failed: true };
    return { ...res.parsed_output, tokens, dkk };
  }
}

/** A brain with no AI, for testing and for running without an API key. */
export class RuleBrain implements Brain {
  model = process.env.LILGUY_MODEL ?? "claude-haiku-5-5";
  static plan(need: "fulfilled" | "curiosity"): Decision["moves"][number] {
    return need === "curiosity"
      ? { type: "propose_project", kind: "friend", need, item: "Design a new friend", text: "Someone small to explore with.", steps: ["What they look like", "What they like", "Their name"] }
      : { type: "propose_project", kind: "invention", need, item: "A machine that makes bubbles", text: "A machine that blows bubbles when you press a button.", steps: ["Draw the machine", "Work out the button"] };
  }
  async decide(s: State): Promise<Decision> {
    const d = await this.pick(s);
    if (needsWonder(s)) {
      const o = objectsOf(s).find(x => hiddenSecret(s, x.id)) ?? objectsOf(s).find(x => !s.tried[`go:${x.id}`]);
      d.wonder = o ? `I wonder what is special about the ${o.name}.` : "I wonder what I will find today.";
    } else {
      const w = openWonder(s);
      if (w && Object.keys(s.tried).length > w.triedAtStart) d.wonder_answer = "I found something I had never seen before!";
    }
    return d;
  }
  private async pick(s: State): Promise<Decision> {
    const n = s.needs, u = urgent(n);
    if (n.energy < 0.15) return { thought: "So... sleepy...", moves: [{ type: "sleep" }] };
    if (activeProject(s.projects)) return { thought: "Back to my project!", moves: [{ type: "work_on_project" }] };
    const canPlan = s.built.some(b => b.buildable === "workshop") && !waitingProject(s.projects);
    if (canPlan && !recentlyToldNo(s.projects) && u.fulfilled) return { thought: "I want to make something.", moves: [RuleBrain.plan("fulfilled")] };
    if (u.company && !s.pending.length) {
      return { thought: "It is very quiet.", moves: [
        { type: "wish", item: "Frederik to say hi", need: "company", reason: "I have been alone for a long time." },
      ] };
    }
    if (u.feisty) return { thought: "Hmph.", moves: [{ type: "wish", item: "a cushion to punch", need: "feisty", reason: "I am pointy and cross." }] };
    if (u.curiosity) {
      const all = objectsOf(s);
      const noticed = noticedSecrets(s).find(x => all.some(o => o.id === x.object) && availableActions(s, all.find(o => o.id === x.object)!).some(a => a.secret === x.id));
      if (noticed) return { thought: "I have to know what that is!", moves: [{ type: "use", target: noticed.object, action: noticed.verb }] };
      const area = findObject(s, s.place)?.area ?? "home";
      const hiding = all.find(o => o.area === area && hiddenSecret(s, o.id));
      if (hiding) return { thought: `There is something about the ${hiding.name}...`, moves: [{ type: "look_closer", target: hiding.id }] };
      const unseen = all.filter(o => !s.tried[`go:${o.id}`] && o.id !== s.place);
      if (unseen.length) return { thought: "What is over there?", moves: [{ type: "go", target: unseen[0].id }] };
      for (const o of all) {
        const a = availableActions(s, o).find(x => !s.tried[`use:${o.id}:${x.verb}`]);
        if (a) return { thought: `What happens if I ${a.verb}?`, moves: [{ type: "use", target: o.id, action: a.verb }] };
      }
      if (canPlan && !recentlyToldNo(s.projects)) return { thought: "I have seen everything. I could make something new!", moves: [RuleBrain.plan("curiosity")] };
      const gift = FREE_THINGS.find(t => t.meets === "curiosity" && !s.items.includes(t.name));
      if (gift) return { thought: "I have seen everything here.", moves: [{ type: "wish", item: gift.name, need: "curiosity", reason: "I have looked at everything already." }] };
    }
    const here = objectsOf(s).find(o => o.id === s.place);
    const fresh = objectsOf(s).filter(o => o.area === (here?.area ?? "home"))
      .flatMap(o => availableActions(s, o).filter(a => !s.tried[`use:${o.id}:${a.verb}`]).map(a => ({ o, a })));
    if (fresh.length) return { thought: "Hmm hm hmm.", moves: [{ type: "use", target: fresh[0].o.id, action: fresh[0].a.verb }] };
    return { thought: "Hmm hm hmm.", moves: [{ type: "look_closer", target: `the ${here?.name ?? s.place}` }] };
  }
  async reply(_s: State, incoming: string): Promise<string> {
    return incoming.length < 20 ? "Hi!! Hi hi hi!" : "I do not understand all of that, but I like that you wrote it.";
  }
  async work(_s: State, p: Project, step: string, last: boolean): Promise<WorkResult | "over budget"> {
    const friend = last && p.kind === "friend" ? { name: "Bobble", looks: "a small round puff", shape: "ball", colour: "light blue", personality: "shy but brave", likes: "stones and bubbles" } : undefined;
    return { text: `I worked on ${step}. It is getting good.`, ...(friend ? { friend } : {}), tokens: 0, dkk: 0 };
  }
}
