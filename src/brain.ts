// The only part that uses AI: given how he feels and what he can do, pick 1 to 3 moves.
// Without an API key (or with DRY_RUN=1) a simple rule-based brain is used instead.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { CHARACTER } from "./character.js";
import { describe, mood, shape, urgent } from "./needs.js";
import type { State } from "./state.js";
import { AREAS, availableActions, BUILDABLES, findObject, MOVE_TYPES, objectsOf, stateOf } from "./world.js";
import { FREE_THINGS } from "./wishmaster.js";

const Decision = z.object({
  thought: z.string().describe("One short sentence in his own voice about what he is thinking."),
  moves: z.array(z.object({
    type: z.enum(MOVE_TYPES),
    target: z.string().optional().describe("For go and use: the name of a thing. For look_closer or try: what."),
    action: z.string().optional().describe("For use: one of the things you can do with it, exactly as listed."),
    item: z.string().optional().describe("For wish: the thing he wants."),
    need: z.string().optional().describe("For wish: which need it is for (energy, curiosity, company, feisty, fulfilled)."),
    reason: z.string().optional().describe("For wish: why you need it, in your own words."),
    text: z.string().optional().describe("For message: what he says to Frederik."),
  })).min(1).max(3),
});
export type Decision = z.infer<typeof Decision>;

export interface Brain { decide(s: State): Promise<Decision>; reply(s: State, incoming: string): Promise<string> }

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

function situation(s: State): string {
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
    `Wishes still waiting for Frederik: ${s.pending.map(p => p.item).join(", ") || "none"}.`,
    `What happened lately:\n${recent}`,
  ].join("\n");
}

const RULES = `Pick 1 to 3 moves from the menu. Rules:
- Only wish for something when one of your pressing needs explains it, and say which need. Wishes without a need get declined.
- Prefer using things in ways you have not tried before, or going somewhere new. To use a thing, pick "use" with its name as target and one of its listed actions.
- Wishing for a place to be built is a big wish. Only do it when a need keeps coming back and nothing you have fixes it, and say which need.
- Only send Frederik a message when you have something real to say or ask. Keep it to one or two short sentences.
- When energy is very low, sleep.`;

export class ClaudeBrain implements Brain {
  private client = new Anthropic();
  constructor(private model: string) {}

  async decide(s: State): Promise<Decision> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Decision) },
      system: [{ type: "text", text: `${CHARACTER}\n\n${RULES}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: situation(s) }],
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
      system: [{ type: "text", text: `${CHARACTER}\n\nFrederik is messaging you on Telegram. Answer in one to three short sentences, in your own voice. Never promise things on behalf of the wishmaster.`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${situation(s)}\n\nRecent chat:\n${history}\n\nFrederik just wrote: ${incoming}` }],
    });
    if (res.stop_reason === "refusal") return "...";
    const text = res.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join(" ").trim();
    return text || "...";
  }
}

/** A brain with no AI, for testing and for running without an API key. */
export class RuleBrain implements Brain {
  async decide(s: State): Promise<Decision> {
    const n = s.needs, u = urgent(n);
    if (n.energy < 0.15) return { thought: "So... sleepy...", moves: [{ type: "sleep" }] };
    if (u.company && !s.pending.length) {
      return { thought: "It is very quiet.", moves: [
        { type: "wish", item: "Frederik to say hi", need: "company", reason: "I have been alone for a long time." },
      ] };
    }
    if (u.feisty) return { thought: "Hmph.", moves: [{ type: "wish", item: "a cushion to punch", need: "feisty", reason: "I am pointy and cross." }] };
    if (u.curiosity) {
      const all = objectsOf(s);
      const unseen = all.filter(o => !s.tried[`go:${o.id}`] && o.id !== s.place);
      if (unseen.length) return { thought: "What is over there?", moves: [{ type: "go", target: unseen[0].id }] };
      for (const o of all) {
        const a = availableActions(s, o).find(x => !s.tried[`use:${o.id}:${x.verb}`]);
        if (a) return { thought: `What happens if I ${a.verb}?`, moves: [{ type: "use", target: o.id, action: a.verb }] };
      }
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
}
