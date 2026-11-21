// The only part that uses AI: given how he feels and what he can do, pick 1 to 3 moves.
// Without an API key (or with DRY_RUN=1) a simple rule-based brain is used instead.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { CHARACTER } from "./character.js";
import { describe, mood, shape, urgent } from "./needs.js";
import type { State } from "./state.js";
import { MOVE_TYPES, PLACES, PLACE_NAMES } from "./world.js";
import { FREE_THINGS } from "./wishmaster.js";

const Decision = z.object({
  thought: z.string().describe("One short sentence in his own voice about what he is thinking."),
  moves: z.array(z.object({
    type: z.enum(MOVE_TYPES),
    target: z.string().optional().describe("For go: a place name. For look_closer or try: what."),
    item: z.string().optional().describe("For wish: the thing he wants."),
    need: z.string().optional().describe("For wish: which need it is for (energy, curiosity, company, feisty, fulfilled)."),
    reason: z.string().optional().describe("For wish: why you need it, in your own words."),
    text: z.string().optional().describe("For message: what he says to Frederik."),
  })).min(1).max(3),
});
export type Decision = z.infer<typeof Decision>;

export interface Brain { decide(s: State): Promise<Decision>; reply(s: State, incoming: string): Promise<string> }

function situation(s: State): string {
  const m = mood(s.needs, s.sleeping);
  const recent = s.diary.slice(-12).map(d => `- ${d.text}`).join("\n") || "- nothing yet";
  const tried = Object.entries(s.tried).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k} (${v}x)`).join(", ") || "nothing yet";
  return [
    `You are at: ${s.place} (${PLACES[s.place]}).`,
    `Places you can go: ${PLACE_NAMES.map(p => `${p} = ${PLACES[p]}`).join("; ")}.`,
    `Your needs: ${describe(s.needs)}. Pressing right now: ${JSON.stringify(urgent(s.needs))}.`,
    `Your mood is ${m}, so your body is a ${shape(m)}.`,
    `Things you own: ${s.items.join(", ") || "nothing yet"}.`,
    `Things you have already done (doing new things feels much better than repeating): ${tried}.`,
    `Free things the wishmaster can give if you really need them: ${FREE_THINGS.map(t => `${t.name} (for ${t.meets})`).join(", ")}.`,
    `Wishes still waiting for Frederik: ${s.pending.map(p => p.item).join(", ") || "none"}.`,
    `What happened lately:\n${recent}`,
  ].join("\n");
}

const RULES = `Pick 1 to 3 moves from the menu. Rules:
- Only wish for something when one of your pressing needs explains it, and say which need. Wishes without a need get declined.
- Prefer going somewhere or trying something you have not done before.
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
      const unseen = PLACE_NAMES.filter(p => !s.tried[`go:${p}`] && p !== s.place);
      if (unseen.length) return { thought: "What is over there?", moves: [{ type: "go", target: unseen[0] }] };
      const gift = FREE_THINGS.find(t => t.meets === "curiosity" && !s.items.includes(t.name));
      if (gift) return { thought: "I have seen everything here.", moves: [{ type: "wish", item: gift.name, need: "curiosity", reason: "I have looked at everything already." }] };
    }
    return { thought: "Hmm hm hmm.", moves: [{ type: "look_closer", target: `the ${s.place}` }] };
  }
  async reply(_s: State, incoming: string): Promise<string> {
    return incoming.length < 20 ? "Hi!! Hi hi hi!" : "I do not understand all of that, but I like that you wrote it.";
  }
}
