// Lil guy's small world and the menu of moves he can pick from.
// The AI can only choose from this menu; anything else is refused by code.

import { clamp, type Needs } from "./needs.js";

export const PLACES = {
  bed: "a sock folded into a bed",
  window: "the windowsill, where light and birds happen",
  rug: "the big soft rug in the middle of the room",
  shelf: "a bookshelf full of things he does not understand yet",
  doorstep: "the doorstep, where the outside begins",
} as const;
export type Place = keyof typeof PLACES;
export const PLACE_NAMES = Object.keys(PLACES) as Place[];

export const MOVE_TYPES = [
  "wait",          // stay put and watch
  "go",            // go to a place (target = place)
  "look_closer",   // examine something where he is (target = thing)
  "try",           // try doing something new (target = short description)
  "rest",          // short rest
  "sleep",         // go to sleep until rested
  "wish",          // ask the wishmaster for something (item + need + reason)
  "message",       // send Frederik a message (text)
] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export interface Move {
  type: MoveType;
  target?: string;
  item?: string;
  need?: string;
  text?: string;
}

/** How a move changes his needs before novelty rewards. */
export function moveEffect(type: MoveType, n: Needs): Needs {
  const e = { ...n };
  switch (type) {
    case "go": e.energy -= 0.04; break;
    case "look_closer": e.energy -= 0.02; break;
    case "try": e.energy -= 0.05; e.fulfilled += 0.03; break;
    case "rest": e.energy += 0.06; e.curiosity += 0.02; break;
    case "message": e.company += 0.05; break;
    default: break;
  }
  for (const k of Object.keys(e) as (keyof Needs)[]) e[k] = clamp(e[k]);
  return e;
}

/**
 * Novelty reward: the first time he does something, it feels great.
 * Each repeat of the same thing gives less, so exploring and trying beats repeating.
 */
export function noveltyReward(timesDone: number): number {
  return 0.25 / (1 + timesDone * 1.5);
}
