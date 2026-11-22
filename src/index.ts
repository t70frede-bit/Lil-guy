// Starts lil guy: his life loop every few minutes, and the Telegram wishmaster.

import { ClaudeBrain, RuleBrain, type Brain } from "./brain.js";
import { ensureWorkshop, heardFromFrederik, resolveMore, resolveProject, resolveWish, step, type Outbox } from "./lilguy.js";
import { kr } from "./workshop.js";
import { checkComputer, leaveOnScreen, sitAtComputer, viaComputer } from "./computer.js";
import { describe, mood, shape } from "./needs.js";
import { publish, publishAssets } from "./publish.js";
import { load, note, remember, save, type State } from "./state.js";
import { Telegram } from "./telegram.js";

const env = process.env;
const DATA = env.DATA_FILE ?? "data/lilguy.json";
const TICK_SECONDS = Number(env.TICK_SECONDS ?? 180);
const MODEL = env.LILGUY_MODEL ?? "claude-haiku-5-5";
const WORLD_URL = env.WORLD_URL || "https://lilguy.gokkehub.com";
const WORLD_TOKEN = env.WORLD_TOKEN;
const OWNER = env.TELEGRAM_OWNER_CHAT_ID ? Number(env.TELEGRAM_OWNER_CHAT_ID) : undefined;

const brain: Brain = env.ANTHROPIC_API_KEY && env.DRY_RUN !== "1" ? new ClaudeBrain(MODEL) : new RuleBrain();
const tg = env.TELEGRAM_BOT_TOKEN ? new Telegram(env.TELEGRAM_BOT_TOKEN) : undefined;
const s: State = load(DATA);
if (OWNER) s.ownerChatId = OWNER;
// Frederik gave him a workshop for his own projects (2026-11-21).
if (ensureWorkshop(s)) save(DATA, s);

// Straight to Telegram. Lil guy's own messages go through his little computer (see `outbox` below).
const telegramOut: Outbox = {
  async say(text) { await send(`💻 Lil guy: ${text}`); remember(s, "lil guy", text); },
  async inform(text) { await send(`Wishmaster: ${text}`); },
  async ask(wish, why) {
    const msg = `Wishmaster: Lil guy wishes for ${wish.item}.${wish.reason ? ` He says: "${wish.reason}"` : ""}\nWhy I am asking you: ${why}`;
    if (!tg || !s.ownerChatId) { console.log(`[ask] ${msg}`); return; }
    const sent = await tg.send(s.ownerChatId, msg, [{ text: "Approve", data: `yes:${wish.id}` }, { text: "Not now", data: `no:${wish.id}` }]);
    wish.messageId = sent.message_id;
  },
  async propose(p, why) {
    const msg = [
      `Wishmaster: Lil guy wants to start a project in his workshop: "${p.title}" (${p.kind}).`,
      `His idea: ${p.idea}`,
      `His plan:\n${p.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}`,
      `Estimate: up to ${p.estimate.tokens.toLocaleString("da-DK")} tokens, about ${kr(p.estimate.dkk)}.`,
      `Why I am asking you: ${why} Nothing starts until you say yes, and it can never use more than this without asking you again.`,
    ].join("\n\n");
    if (!tg || !s.ownerChatId) { console.log(`[propose] ${msg}`); return; }
    const sent = await tg.send(s.ownerChatId, msg, [{ text: "Approve", data: `pyes:${p.id}` }, { text: "Not now", data: `pno:${p.id}` }]);
    p.messageId = sent.message_id;
  },
  async askMore(p, more) {
    const msg = `Wishmaster: Lil guy's project "${p.title}" has used its ${p.budget.toLocaleString("da-DK")} tokens, with ${p.steps.length - p.pieces.length} of ${p.steps.length} steps left. To finish it he needs up to ${more.tokens.toLocaleString("da-DK")} more tokens, about ${kr(more.dkk)}.`;
    if (!tg || !s.ownerChatId) { console.log(`[more] ${msg}`); return; }
    await tg.send(s.ownerChatId, msg, [{ text: "Give more", data: `myes:${p.id}` }, { text: "Stop it", data: `mno:${p.id}` }]);
  },
};

/** His messages to Frederik are typed on his little computer, so you can see him do it in his world. */
const outbox = viaComputer(s, telegramOut);

function projects(): string {
  if (!s.projects.length) return "Lil guy has not planned any projects yet.";
  return s.projects.slice(-8).map(p =>
    `"${p.title}" (${p.kind}): ${p.status}. ${p.pieces.length}/${p.steps.length} steps. Tokens ${p.used.toLocaleString("da-DK")} of ${p.budget.toLocaleString("da-DK")} approved (estimate ${p.estimate.tokens.toLocaleString("da-DK")}, ${kr(p.estimate.dkk)}). Spent about ${kr(p.spentDkk ?? 0)}.`
  ).join("\n\n");
}

async function send(text: string) {
  if (!tg || !s.ownerChatId) { console.log(`[telegram] ${text}`); return; }
  try { await tg.send(s.ownerChatId, text); } catch (e) { console.error(e); }
}

function status(): string {
  const m = mood(s.needs, s.sleeping);
  return [
    `Lil guy is ${s.paused ? "paused" : s.sleeping ? "asleep" : "awake"} at the ${s.place}.`,
    `Mood: ${m}, so he is a ${shape(m)}.`,
    `Needs: ${describe(s.needs)}.`,
    `Owns: ${s.items.join(", ") || "nothing yet"}.`,
    `Waiting wishes: ${s.pending.map(p => p.item).join(", ") || "none"}.`,
    `Projects: ${s.projects.filter(p => p.status === "working" || p.status === "waiting" || p.status === "needs more tokens").map(p => `${p.title} (${p.status})`).join(", ") || "none going"}.`,
  ].join("\n");
}

async function handleText(chatId: number, text: string) {
  if (!s.ownerChatId && text.startsWith("/start")) {
    s.ownerChatId = chatId;
    note(s, "Met Frederik for the first time.");
    await send("Wishmaster: Hello Frederik. Lil guy now knows how to reach you. Commands: /status, /diary, /projects, /pause, /resume.");
    return;
  }
  if (chatId !== s.ownerChatId) return; // only Frederik can talk to him
  if (text === "/status") return send(status());
  if (text === "/diary") return send(s.diary.slice(-10).map(d => `${d.at.slice(11, 16)} ${d.text}`).join("\n") || "Nothing yet.");
  if (text === "/projects") return send(projects());
  if (text === "/pause") { s.paused = true; note(s, "Frederik paused him."); return send("Wishmaster: Lil guy is paused. /resume to wake him."); }
  if (text === "/resume") { s.paused = false; note(s, "Frederik resumed him."); return send("Wishmaster: Lil guy is running again."); }
  if (text.startsWith("/")) return;
  heardFromFrederik(s);
  remember(s, "frederik", text.slice(0, 1000));
  note(s, `Frederik said: ${text.slice(0, 200)}`);
  if (s.sleeping) {
    // He is fast asleep: the message waits on his computer until he wakes up and reads it.
    leaveOnScreen(s, text.slice(0, 1000));
    await send("Wishmaster: Lil guy is asleep. Your message is waiting on his computer, and he will read it when he wakes up.");
    return;
  }
  sitAtComputer(s, "write to Frederik", "His computer went ping. He ran over, read Frederik's message and wrote back.");
  try {
    const reply = await brain.reply(s, text.slice(0, 1000));
    await telegramOut.say(reply);
  } catch (e) { console.error(e); }
}

/** What he says back to messages that waited on his computer while he slept. */
async function answerWaiting(incoming: string): Promise<string | undefined> {
  try { return await brain.reply(s, `(This waited on your computer while you were asleep. You just woke up and read it.)\n${incoming}`); }
  catch (e) { console.error(e); return undefined; }
}

async function pollTelegram() {
  if (!tg) return;
  for (;;) {
    try {
      const updates = await tg.getUpdates(s.telegramOffset);
      for (const u of updates) {
        s.telegramOffset = u.update_id + 1;
        if (u.message?.text) await handleText(u.message.chat.id, u.message.text.trim());
        const cb = u.callback_query;
        if (cb?.data && cb.message && cb.message.chat.id === s.ownerChatId) {
          const [verb, id] = cb.data.split(":");
          if (verb === "pyes" || verb === "pno" || verb === "myes" || verb === "mno") {
            const yes = verb.endsWith("yes");
            const p = verb[0] === "p" ? resolveProject(s, id, yes) : resolveMore(s, id, yes);
            await tg.answer(cb.id, p ? (yes ? "Approved" : "Okay") : "Already handled");
            await tg.clearButtons(cb.message.chat.id, cb.message.message_id).catch(() => {});
            if (p) await send(yes ? `Wishmaster: Approved. "${p.title}" may use up to ${p.budget.toLocaleString("da-DK")} tokens.` : verb === "pno" ? "Wishmaster: Told him not now." : `Wishmaster: Stopped "${p.title}".`);
            save(DATA, s);
            continue;
          }
          const wish = resolveWish(s, id, verb === "yes");
          await tg.answer(cb.id, wish ? (verb === "yes" ? "Approved" : "Okay, not now") : "Already handled");
          await tg.clearButtons(cb.message.chat.id, cb.message.message_id).catch(() => {});
          if (wish) await send(verb === "yes" ? `Wishmaster: Approved. Lil guy gets ${wish.item}.` : `Wishmaster: Told him not now.`);
        }
        save(DATA, s);
      }
    } catch (e) {
      console.error("Telegram polling error:", (e as Error).message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function lifeLoop() {
  for (;;) {
    await step(s, brain, outbox);
    await checkComputer(s, telegramOut, answerWaiting);
    save(DATA, s);
    await publish(s, WORLD_URL, WORLD_TOKEN, TICK_SECONDS);
    await publishAssets(WORLD_URL, WORLD_TOKEN);
    await new Promise(r => setTimeout(r, TICK_SECONDS * 1000));
  }
}

console.log(`Lil guy starting. Brain: ${brain instanceof ClaudeBrain ? MODEL : "rules (no AI)"}. Telegram: ${tg ? "on" : "off, printing to console"}. Tick: ${TICK_SECONDS}s. World page: ${WORLD_TOKEN ? WORLD_URL : "off"}.`);
pollTelegram();
lifeLoop();
