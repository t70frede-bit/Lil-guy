// Lil guy's daily "I wonder": each morning he picks one thing to find out or try that day.
// The AI picks it as part of a normal decision (no extra AI call); plain code keeps track of it.

import { applyEffect } from "./wishmaster.js";
import { highlight, note, type State } from "./state.js";

const TZ = "Europe/Copenhagen";
/** Mornings start at 6, Danish time. */
export const MORNING_HOUR = 6;
/** How finding out what he wondered about feels. */
export const WONDER_JOY = { fulfilled: 0.35, curiosity: -0.3, feisty: -0.1 };

export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function localHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Does he need to pick a new "I wonder"? Once a day, from the morning on, while awake. */
export function needsWonder(s: State, now = new Date()): boolean {
  if (s.sleeping) return false;
  if (s.wonder?.day === today(now)) return false;
  // His very first one he may pick any time; after that, a new one each morning.
  return !s.wonder || localHour(now) >= MORNING_HOUR;
}

/** The wonder for today that he has not answered yet. */
export function openWonder(s: State, now = new Date()) {
  return s.wonder && s.wonder.day === today(now) && !s.wonder.answer ? s.wonder : undefined;
}

export function setWonder(s: State, text: string, now = new Date()): boolean {
  if (!needsWonder(s, now)) return false;
  let t = text.trim().replace(/\s+/g, " ").slice(0, 160);
  if (t.length < 6) return false;
  if (!/^i wonder/i.test(t)) t = `I wonder ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  s.wonder = { day: today(now), text: t, at: now.toISOString(), triedAtStart: Object.keys(s.tried).length };
  note(s, `Woke up wondering: ${t}`);
  highlight(s, "wonder", `Today's wonder: ${t}`);
  return true;
}

/**
 * He says he found out. It only counts if he has done something new since he picked it,
 * so just saying "I found out" is not enough: he has to actually go and explore.
 */
export function answerWonder(s: State, answer: string, now = new Date()): "answered" | "not yet" | "none" {
  const w = openWonder(s, now);
  if (!w) return "none";
  const a = answer.trim().replace(/\s+/g, " ").slice(0, 240);
  if (!a) return "none";
  if (Object.keys(s.tried).length <= w.triedAtStart) {
    note(s, `Thought he knew the answer to "${w.text}", but he has not actually tried anything new yet.`);
    return "not yet";
  }
  w.answer = a;
  w.answeredAt = now.toISOString();
  s.needs = applyEffect(s.needs, WONDER_JOY);
  note(s, `Found out! ${w.text}... ${a}`);
  highlight(s, "wonder", `Found out what he wondered about! ${a}`);
  return "answered";
}
