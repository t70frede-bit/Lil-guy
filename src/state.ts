// Everything lil guy is, saved as one JSON file so he survives restarts.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { freshNeeds, type Needs } from "./needs.js";
import type { Place } from "./world.js";

export interface DiaryEntry { at: string; text: string }
export interface PendingWish { id: string; item: string; need: string; reason: string; at: string; messageId?: number }

export interface State {
  needs: Needs;
  place: Place;
  sleeping: boolean;
  paused: boolean;
  items: string[];
  /** How many times he has done each thing, for the novelty reward. */
  tried: Record<string, number>;
  diary: DiaryEntry[];
  pending: PendingWish[];
  ownerChatId?: number;
  telegramOffset: number;
  /** Messages he sent Frederik today, for the daily limit. */
  sentToday: { day: string; count: number };
  /** Recent conversation with Frederik, newest last. */
  chat: { from: "frederik" | "lil guy"; text: string }[];
  ticks: number;
}

export function freshState(): State {
  return {
    needs: freshNeeds(), place: "bed", sleeping: false, paused: false, items: [], tried: {},
    diary: [], pending: [], telegramOffset: 0, sentToday: { day: "", count: 0 }, chat: [], ticks: 0,
  };
}

export function load(path: string): State {
  try { return { ...freshState(), ...JSON.parse(readFileSync(path, "utf8")) }; }
  catch { return freshState(); }
}

export function save(path: string, s: State) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, path);
}

export function note(s: State, text: string) {
  s.diary.push({ at: new Date().toISOString(), text });
  if (s.diary.length > 300) s.diary.splice(0, s.diary.length - 300);
  console.log(`[diary] ${text}`);
}

export function remember(s: State, from: "frederik" | "lil guy", text: string) {
  s.chat.push({ from, text });
  if (s.chat.length > 20) s.chat.splice(0, s.chat.length - 20);
}
