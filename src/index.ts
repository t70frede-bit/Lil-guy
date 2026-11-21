// Starts lil guy: his life loop every few minutes, and the Telegram wishmaster.

import { ClaudeBrain, RuleBrain, type Brain } from "./brain.js";
import { heardFromFrederik, resolveWish, step, type Outbox } from "./lilguy.js";
import { describe, mood, shape } from "./needs.js";
import { publish } from "./publish.js";
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

const outbox: Outbox = {
  async say(text) { await send(`Lil guy: ${text}`); remember(s, "lil guy", text); },
  async inform(text) { await send(`Wishmaster: ${text}`); },
  async ask(wish, why) {
    const msg = `Wishmaster: Lil guy wishes for ${wish.item}.${wish.reason ? ` He says: "${wish.reason}"` : ""}\nWhy I am asking you: ${why}`;
    if (!tg || !s.ownerChatId) { console.log(`[ask] ${msg}`); return; }
    const sent = await tg.send(s.ownerChatId, msg, [{ text: "Approve", data: `yes:${wish.id}` }, { text: "Not now", data: `no:${wish.id}` }]);
    wish.messageId = sent.message_id;
  },
};

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
  ].join("\n");
}

async function handleText(chatId: number, text: string) {
  if (!s.ownerChatId && text.startsWith("/start")) {
    s.ownerChatId = chatId;
    note(s, "Met Frederik for the first time.");
    await send("Wishmaster: Hello Frederik. Lil guy now knows how to reach you. Commands: /status, /diary, /pause, /resume.");
    return;
  }
  if (chatId !== s.ownerChatId) return; // only Frederik can talk to him
  if (text === "/status") return send(status());
  if (text === "/diary") return send(s.diary.slice(-10).map(d => `${d.at.slice(11, 16)} ${d.text}`).join("\n") || "Nothing yet.");
  if (text === "/pause") { s.paused = true; note(s, "Frederik paused him."); return send("Wishmaster: Lil guy is paused. /resume to wake him."); }
  if (text === "/resume") { s.paused = false; note(s, "Frederik resumed him."); return send("Wishmaster: Lil guy is running again."); }
  if (text.startsWith("/")) return;
  heardFromFrederik(s);
  remember(s, "frederik", text.slice(0, 1000));
  note(s, `Frederik said: ${text.slice(0, 200)}`);
  try {
    const reply = await brain.reply(s, text.slice(0, 1000));
    remember(s, "lil guy", reply);
    await send(`Lil guy: ${reply}`);
  } catch (e) { console.error(e); }
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
    save(DATA, s);
    await publish(s, WORLD_URL, WORLD_TOKEN, TICK_SECONDS);
    await new Promise(r => setTimeout(r, TICK_SECONDS * 1000));
  }
}

console.log(`Lil guy starting. Brain: ${brain instanceof ClaudeBrain ? MODEL : "rules (no AI)"}. Telegram: ${tg ? "on" : "off, printing to console"}. Tick: ${TICK_SECONDS}s. World page: ${WORLD_TOKEN ? WORLD_URL : "off"}.`);
pollTelegram();
lifeLoop();
