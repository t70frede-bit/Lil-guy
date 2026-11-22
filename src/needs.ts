// Lil guy's needs. Plain code, no AI: they drift every tick and every move changes them.

export type NeedName = "energy" | "curiosity" | "company" | "feisty" | "fulfilled";
export type Needs = Record<NeedName, number>;
export type Mood = "content" | "curious" | "lonely" | "feisty" | "sleepy" | "proud";
export type Shape = "ball" | "spiky ball" | "cube" | "droopy ball";

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function freshNeeds(): Needs {
  return { energy: 0.8, curiosity: 0.55, company: 0.7, feisty: 0.1, fulfilled: 0.5 };
}

/** One tick of passive drift while awake. */
export function drift(n: Needs): Needs {
  return {
    energy: clamp(n.energy - 0.005),
    curiosity: clamp(n.curiosity + 0.05), // builds fast: he gets restless sooner
    company: clamp(n.company - 0.01),
    feisty: clamp(n.feisty - 0.03),
    fulfilled: clamp(n.fulfilled - 0.01),
  };
}

export function sleepTick(n: Needs): Needs {
  return { ...n, energy: clamp(n.energy + 0.08), feisty: clamp(n.feisty - 0.05) };
}

export function moodWeights(n: Needs, sleeping: boolean, proud = false) {
  const sleepy = sleeping ? 1 : clamp((0.3 - n.energy) / 0.3);
  return {
    // A proud moment wins over most moods for a little while, but not over being very tired.
    proud: proud && !sleeping ? 0.85 * (1 - sleepy) : 0,
    lonely: clamp((0.4 - n.company) / 0.4),
    feisty: clamp((n.feisty - 0.45) / 0.55),
    sleepy,
    curious: clamp((n.curiosity - 0.5) / 0.5) * (1 - sleepy),
    content: 0.3,
  };
}

export function mood(n: Needs, sleeping = false, proud = false): Mood {
  const w = moodWeights(n, sleeping, proud);
  return (Object.entries(w) as [Mood | "lonely", number][]).sort((a, b) => b[1] - a[1])[0][0] as Mood;
}

export function shape(m: Mood): Shape {
  switch (m) {
    case "lonely": return "cube";
    case "feisty": return "spiky ball";
    case "sleepy": return "droopy ball";
    default: return "ball";
  }
}

/** The needs that are currently "in need", used by the wishmaster to judge wishes. */
export function urgent(n: Needs): Partial<Record<NeedName, string>> {
  const out: Partial<Record<NeedName, string>> = {};
  if (n.energy < 0.3) out.energy = "tired";
  if (n.curiosity > 0.6) out.curiosity = "bored, wants something new";
  if (n.company < 0.35) out.company = "lonely";
  if (n.feisty > 0.6) out.feisty = "frustrated";
  if (n.fulfilled < 0.35) out.fulfilled = "feels like he has not done anything";
  return out;
}

export function describe(n: Needs): string {
  return (Object.keys(n) as NeedName[]).map(k => `${k} ${Math.round(n[k] * 100)}%`).join(", ");
}
