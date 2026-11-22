// Lil guy's little computer, on a desk in his house. It is where he writes to Frederik and
// reads what Frederik writes back, so a message is something he walks over and does in his
// world instead of something that just happens.
//
// Every message from him goes through here (viaComputer wraps the Outbox), so new code that
// calls out.say gets the walk to the computer for free. The wishmaster's own messages
// (wishes, projects, news) are not his, so they still go straight to Telegram.
//
// While he sleeps nothing is typed: what he wants to say waits until he wakes up, and
// Frederik's messages wait on the screen until he gets up and reads them.

import type { Outbox } from "./lilguy.js";
import { note, type State } from "./state.js";

export const COMPUTER = "computer";
/** At most this many things wait on the computer, so a long sleep cannot pile them up. */
const MAX_WAITING = 5;

export interface Mailbox {
  /** Things he wanted to tell Frederik while he was asleep, sent when he wakes up. */
  unsent: string[];
  /** Frederik's messages that arrived while he was asleep, read when he wakes up. */
  unread: string[];
}

function mailbox(s: State): Mailbox {
  s.computer ??= { unsent: [], unread: [] };
  return s.computer;
}

/** He goes to his computer, switches it on and does something there (shown on his page). */
export function sitAtComputer(s: State, verb: string, line: string) {
  s.place = COMPUTER;
  s.objects[COMPUTER] = "on";
  s.last = { object: COMPUTER, verb, line, at: new Date().toISOString() };
}

/** His messages to Frederik go through his computer. Everything else is passed straight on. */
export function viaComputer(s: State, out: Outbox): Outbox {
  return {
    ...out,
    async say(text) {
      if (s.sleeping) {
        const box = mailbox(s);
        if (box.unsent.length < MAX_WAITING) box.unsent.push(text);
        note(s, "Thought of something to tell Frederik, and will write it on his computer in the morning.");
        return;
      }
      sitAtComputer(s, "write to Frederik", "Typed a message to Frederik on his little computer and pressed send.");
      await out.say(text);
    },
  };
}

/** Frederik wrote while he was asleep: the message waits on his screen. */
export function leaveOnScreen(s: State, text: string) {
  const box = mailbox(s);
  box.unread.push(text);
  if (box.unread.length > MAX_WAITING) box.unread.splice(0, box.unread.length - MAX_WAITING);
  s.objects[COMPUTER] = "a message is waiting";
  note(s, "His computer went ping while he was asleep. A message from Frederik is waiting on the screen.");
}

/**
 * Once he is awake: read what waited on the screen and answer it, then send what he wanted to say.
 * `answer` writes his reply to Frederik's messages; it is only called when there is something to read.
 */
export async function checkComputer(s: State, out: Outbox, answer: (incoming: string) => Promise<string | undefined>) {
  if (s.sleeping || s.paused || !s.computer) return;
  const box = s.computer;
  if (box.unread.length) {
    const incoming = box.unread.splice(0).join("\n");
    sitAtComputer(s, "read Frederik's message", "Woke up, saw the blinking screen and read Frederik's message.");
    note(s, "Read the message from Frederik that was waiting on his computer.");
    const reply = await answer(incoming);
    if (reply) {
      s.last = { object: COMPUTER, verb: "write to Frederik", line: "Read Frederik's message and wrote back on his little computer.", at: new Date().toISOString() };
      await out.say(reply);
    }
  }
  for (const text of box.unsent.splice(0)) {
    sitAtComputer(s, "write to Frederik", "Remembered what he wanted to tell Frederik and typed it on his little computer.");
    await out.say(text);
  }
  if (s.objects[COMPUTER] === "a message is waiting") s.objects[COMPUTER] = "on";
}

/** Wishes to use the internet. It is not built yet, so Frederik hears what saying yes would mean. */
export function isInternetWish(item: string): boolean {
  return /\b(internet|the web|web ?brows\w*|browse|browsing|online|google|websites?|search engine)\b/i.test(item);
}
