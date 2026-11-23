// Friends he designs in his workshop. When a friend design is finished, the friend moves into his
// world straight away, in the spot he pictured them, looking the way he described them.
// Everything here is plain code reading his own words: no AI, so it costs nothing.

import type { Action, WorldObject } from "./world.js";
import type { FriendDesign, Project } from "./workshop.js";

export const FRIEND_KINDS = ["bird", "beetle", "bug", "bee", "butterfly", "snail", "mouse", "bunny", "cat", "dog", "frog", "fish", "blob"] as const;
export type FriendKind = (typeof FRIEND_KINDS)[number];

/** Where a friend can live. Each one is a real spot in his world, so the page knows where to put them. */
export const FRIEND_SPOTS = {
  windowsill: { area: "home", near: "window", words: /\b(window ?sill|windowsill|sill|window|perch)\b/ },
  stone: { area: "outside", near: "stone", words: /\b(stone|rock|pebble pile|boulder)\b/ },
  shelf: { area: "home", near: "shelf", words: /\b(shelf|bookshelf|books)\b/ },
  bed: { area: "home", near: "bed", words: /\b(sock bed|bed|pillow)\b/ },
  plant: { area: "home", near: "plant", words: /\b(plant|thimble pot|flowerpot)\b/ },
  rug: { area: "home", near: "rug", words: /\b(rug|carpet|floor)\b/ },
  pond: { area: "outside", near: "pondwater", words: /\b(pond|puddle|water)\b/ },
  field: { area: "outside", near: "field", words: /\b(field|grass|meadow|outside)\b/ },
} as const;
export type FriendSpot = keyof typeof FRIEND_SPOTS;

/** What the page needs to build a friend: body plan and colours, all worked out from his words. */
export interface FriendLook {
  body: string;
  belly?: string;
  wings?: string;
  feet?: string;
  beak?: string;
  shell?: string;
  /** Small extra bits he mentioned: antennae, tail, ears, a clover on the chest, spots, a hat... */
  parts: string[];
  /** How big compared to him (1 = his size). */
  size: number;
}

export interface Friend {
  id: string;
  name: string;
  kind: FriendKind;
  spot: FriendSpot;
  look: FriendLook;
  /** One sentence for the info card, from his own design. */
  desc: string;
  design: FriendDesign;
  /** The projects that made them (he can design the same friend again, and the newest look wins). */
  projects: string[];
  at: string;
}

const COLOUR_WORDS = [
  "puddle blue", "sky blue", "light blue", "dark blue", "baby blue", "navy", "blue", "teal", "turquoise", "mint", "green", "leaf green", "moss",
  "yellow", "lemon", "gold", "golden", "honey", "orange", "peach", "coral", "red", "cherry", "pink", "rose", "purple", "lilac", "lavender", "violet",
  "brown", "warm brown", "cocoa", "chocolate", "tan", "sand", "cream", "white", "pale grey", "grey", "gray", "silver", "black", "charcoal",
];
// Longest first, so "puddle blue" wins over "blue".
const COLOURS_BY_LENGTH = [...COLOUR_WORDS].sort((a, b) => b.length - a.length);
const lower = (t: string) => t.toLowerCase().replace(/[“”"]/g, " ");

/** The first colour word in a piece of text. */
export function colourIn(text: string): string | undefined {
  const t = lower(text);
  let best: { at: number; c: string } | undefined;
  for (const c of COLOURS_BY_LENGTH) {
    const m = new RegExp(`\\b${c}\\b`).exec(t);
    if (m && (!best || m.index < best.at)) best = { at: m.index, c };
  }
  return best?.c;
}

/** The colour he said a body part has, e.g. "bright blue wings", "wings of puddle blue", "orange feet". */
function colourOf(text: string, part: RegExp): string | undefined {
  const t = lower(text);
  for (const clause of t.split(/[,.;]| and | with /)) {
    if (!part.test(clause)) continue;
    const c = colourIn(clause);
    if (c) return c;
  }
  return undefined;
}

const KIND_WORDS: [FriendKind, RegExp][] = [
  ["bird", /\b(bird|birdie|chick|sparrow|robin|tit|finch|owl|duck|beak|wings?|feathers?|tweet|chirp)\b/],
  ["beetle", /\b(beetle|ladybug|ladybird)\b/],
  ["bee", /\b(bee|bumblebee)\b/],
  ["butterfly", /\b(butterfly|moth)\b/],
  ["snail", /\b(snail|slug)\b/],
  ["bug", /\b(bug|ant|cricket|grasshopper|insect|caterpillar|worm)\b/],
  ["mouse", /\b(mouse|mice|hamster|rat)\b/],
  ["bunny", /\b(bunny|rabbit|hare)\b/],
  ["cat", /\b(cat|kitten|kitty)\b/],
  ["dog", /\b(dog|puppy|pup)\b/],
  ["frog", /\b(frog|toad)\b/],
  ["fish", /\b(fish|goldfish)\b/],
];

/** What kind of creature he designed, from the title first (he names it there), then the design. */
export function kindOf(title: string, text: string): FriendKind {
  for (const t of [lower(title), lower(text)]) {
    // The first creature word wins, so "a beetle who waves at the birds" is a beetle.
    let best: { at: number; k: FriendKind } | undefined;
    for (const [k, re] of KIND_WORDS) {
      const m = re.exec(t);
      if (m && (!best || m.index < best.at)) best = { at: m.index, k };
    }
    if (best) return best.k;
  }
  return "blob";
}

const DEFAULT_SPOT: Record<FriendKind, FriendSpot> = {
  bird: "windowsill", beetle: "stone", bug: "stone", bee: "plant", butterfly: "plant", snail: "stone",
  mouse: "shelf", bunny: "field", cat: "rug", dog: "rug", frog: "pond", fish: "pond", blob: "rug",
};

/** Where he pictured them living. Their own design counts most, then the idea, then what he wrote last. */
export function spotOf(kind: FriendKind, texts: string[], hasPond: boolean): FriendSpot {
  for (const raw of texts) {
    const t = lower(raw);
    let best: { at: number; s: FriendSpot } | undefined;
    for (const [s, def] of Object.entries(FRIEND_SPOTS) as [FriendSpot, (typeof FRIEND_SPOTS)[FriendSpot]][]) {
      if (s === "pond" && !hasPond) continue;
      const m = def.words.exec(t);
      if (m && (!best || m.index < best.at)) best = { at: m.index, s };
    }
    if (best) return best.s;
  }
  const d = DEFAULT_SPOT[kind];
  return d === "pond" && !hasPond ? "field" : d;
}

const PARTS: [string, RegExp][] = [
  ["antennae", /\b(antenna|antennae|feelers|sniffers)\b/],
  ["tail", /\btail\b/],
  ["ears", /\b(ears?)\b/],
  ["clover", /\b(clover|four-leaf|four leaf)\b/],
  ["leaf", /\bleaf\b/],
  ["spots", /\b(spots?|dots?|freckles)\b/],
  ["stripes", /\bstripes?\b/],
  ["hat", /\b(hat|cap)\b/],
  ["scarf", /\bscarf\b/],
  ["crest", /\b(crest|tuft|mohawk)\b/],
  ["cheeks", /\b(cheeks|blush)\b/],
  ["arms", /\b(arms|hands)\b/],
  ["legs", /\b(legs|feet|toes)\b/],
];

/** His words turned into a body plan the page can build. */
export function lookOf(kind: FriendKind, d: FriendDesign, myColour?: string): FriendLook {
  const all = `${d.looks}. ${d.shape}. ${d.colour}`;
  const wings = /wing|flap/i.test(all) || kind === "bird" || kind === "bee" || kind === "butterfly" ? colourOf(all, /wing|flap/) : undefined;
  const belly = colourOf(all, /\b(chest|belly|tummy)\b/);
  const feet = colourOf(all, /\b(feet|foot|legs|toes)\b/);
  const beak = colourOf(all, /\b(beak|bill)\b/);
  const shell = colourOf(all, /\b(shell|back)\b/);
  // The body is the colour he named for the body, or the first colour that is not for another part.
  const bodySaid = colourOf(all, /\b(body|ball|round|fur|feathers|coat|skin)\b/);
  const used = [wings, belly, feet, beak, shell];
  const firstFree = COLOURS_BY_LENGTH.map(c => ({ c, at: lower(d.colour).search(new RegExp(`\\b${c}\\b`)) }))
    .filter(x => x.at >= 0 && !used.some(u => u && u.includes(x.c))).sort((a, b) => a.at - b.at)[0]?.c;
  const body = bodySaid && !used.includes(bodySaid) ? bodySaid : firstFree ?? shell ?? wings ?? colourIn(all) ?? colourIn(myColour ?? "") ?? "cream";
  const parts = PARTS.filter(([, re]) => re.test(lower(all))).map(([p]) => p);
  const small = /\b(tiny|small|little|wee|mini)\b/.test(lower(all));
  const size = kind === "bird" || kind === "mouse" ? 0.55 : ["beetle", "bug", "bee", "snail", "butterfly"].includes(kind) ? 0.4 : small ? 0.6 : 0.8;
  return {
    body, ...(belly ? { belly } : {}), ...(wings ? { wings } : {}), ...(feet ? { feet } : {}), ...(beak ? { beak } : {}),
    ...(shell && shell !== body ? { shell } : {}), parts, size,
  };
}

const slug = (t: string) => lower(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "friend";
export const friendId = (name: string) => `friend-${slug(name)}`;

/** Make the friend from a finished friend project. */
export function friendFrom(p: Project, opts: { hasPond?: boolean; myColour?: string } = {}): Friend | undefined {
  const d = p.friend;
  if (!d?.name?.trim()) return undefined;
  const designText = `${d.looks}. ${d.shape}. ${d.colour}. ${d.likes}`;
  const kind = kindOf(p.title, `${designText}. ${p.idea}`);
  const latest = p.pieces[p.pieces.length - 1]?.text ?? "";
  const spot = spotOf(kind, [d.home ?? "", `${d.likes}. ${d.looks}`, p.idea, latest], !!opts.hasPond);
  const name = d.name.trim().slice(0, 30);
  return {
    id: friendId(name), name, kind, spot, look: lookOf(kind, d, opts.myColour),
    desc: `${cap(d.looks.replace(/\.$/, ""))}. ${cap(d.personality.replace(/\.$/, ""))}.`.slice(0, 300),
    design: d, projects: [p.id], at: new Date().toISOString(),
  };
}

const cap = (t: string) => t ? t[0].toUpperCase() + t.slice(1) : t;

export const SPOT_WORDS: Record<FriendSpot, string> = {
  windowsill: "on the windowsill", stone: "by the big stone", shelf: "on the bookshelf", bed: "by the sock bed",
  plant: "next to the little plant", rug: "on the rug", pond: "by the little pond", field: "out in the field",
};

const SONG: Partial<Record<FriendKind, string>> = { bird: "sing", beetle: "click", bug: "chirp", bee: "buzz", frog: "croak", cat: "purr", dog: "bark", mouse: "squeak" };

/** What he can do with a friend. Being with a friend never gets old, so these do not fade. */
export function friendActions(f: Friend): Action[] {
  const n = f.name;
  const sound = SONG[f.kind];
  const song = sound === "sing" ? `${n} sang its loud song for him, right at him.` : sound ? `${n} did a happy ${sound} back.` : `${n} wiggled back at him.`;
  return [
    { verb: `say hello to ${n}`, care: true, effect: { company: 0.08, feisty: -0.03 }, line: `Said hello to ${n}.`,
      lines: [`Said hello to ${n}. ${n} looked at him with one eye, then the other.`, `Said good morning to ${n}, very politely.`, `Waved at ${n}. ${n} waved back, sort of.`, `Told ${n} about his day. ${n} listened very well.`] },
    { verb: `listen to ${n}`, care: true, effect: { company: 0.06, fulfilled: 0.03 }, line: song },
    { verb: `sit with ${n}`, care: true, effect: { company: 0.07, energy: 0.03 }, line: `Sat next to ${n} for a while. Neither of them said anything, and that was nice.` },
    { verb: `show ${n} something`, care: true, effect: { company: 0.05, curiosity: -0.04 }, line: `Showed ${n} one of his treasures. ${n} was very impressed.` },
  ];
}

/** Friends as things in his world, next to their spot. */
export function friendObjects(friends: Friend[] | undefined): WorldObject[] {
  return (friends ?? []).map(f => ({
    id: f.id, name: f.name, area: FRIEND_SPOTS[f.spot]?.area ?? "home", kind: "friend", state: `lives ${SPOT_WORDS[f.spot]}`,
    desc: `${f.desc} Your friend, who you designed yourself.`, actions: friendActions(f),
  }));
}

/**
 * A finished friend project: the friend moves in. A newer design of a friend with the same name
 * (he made Pip twice) replaces the older look, so they look like he pictured them last.
 */
export function moveIn(s: { friends?: Friend[]; built: { buildable?: string }[]; self?: { colour?: string } }, p: Project): { friend: Friend; isNew: boolean } | undefined {
  const f = friendFrom(p, { hasPond: s.built.some(b => b.buildable === "pond"), myColour: s.self?.colour });
  if (!f) return undefined;
  s.friends ??= [];
  const i = s.friends.findIndex(x => x.id === f.id);
  if (i >= 0) { s.friends[i] = { ...f, projects: [...new Set([...s.friends[i].projects, p.id])], at: s.friends[i].at }; return { friend: s.friends[i], isNew: false }; }
  s.friends.push(f);
  return { friend: f, isNew: true };
}

/** For friends he finished before they could move in: move them in now, oldest project first. */
export function moveInFinished(s: { friends?: Friend[]; projects: Project[]; built: { buildable?: string }[]; self?: { colour?: string } }): Friend[] {
  const moved: Friend[] = [];
  for (const p of s.projects) {
    if (p.status !== "done" || !p.friend) continue;
    if (s.friends?.some(f => f.projects.includes(p.id))) continue;
    const r = moveIn(s, p);
    if (r?.isNew) moved.push(r.friend);
  }
  return moved;
}
