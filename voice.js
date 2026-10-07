// Cascade/parallel formant singer, written from the Klatt 1980 design
// (JASA 67(3): parameter frames every 5 ms, cascade F1–F5, nasal pole/zero,
// parallel frication and bursts) and Peterson-Barney vowel targets.
// Singing pitch is the note's MIDI frequency. No sample library.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyAt, sectionAt } from "./arrange.js";

const SR = 48000;
const CONS_BOOST = 1.8;
const SR24 = 24000;
const HOP = 120;
const DT = 1 / SR24;

const SCALE = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

const VOWELS = new Set(["IY", "IH", "EH", "AE", "AA", "AO", "AH", "AX", "UH", "UW", "ER", "AY", "AW", "EY", "OW", "OY"]);
const STOPS = new Set(["P", "B", "T", "D", "K", "G"]);
const AFFRICATES = new Set(["CH", "JH"]);
const FRIC = new Set(["F", "TH", "S", "SH", "V", "DH", "Z", "ZH", "HH"]);
const NASAL = new Set(["M", "N", "NG"]);

// Male Peterson-Barney centers, plus F4/F5 and bandwidths in the Klatt range.
// f: F1..F5 Hz. b: bandwidths. tilt is the one-pole glottal lowpass (higher is brighter).
const VOWEL = {
  IY: { f: [270, 2290, 3010, 3500, 4500], b: [40, 60, 160, 220, 260], tilt: 0.82 },
  IH: { f: [390, 1990, 2550, 3400, 4300], b: [60, 100, 140, 200, 260], tilt: 0.55 },
  EH: { f: [530, 1840, 2480, 3400, 4300], b: [70, 100, 130, 200, 250], tilt: 0.5 },
  AE: { f: [660, 1720, 2410, 3350, 4200], b: [80, 100, 130, 200, 250], tilt: 0.48 },
  AA: { f: [730, 1090, 2440, 3400, 4200], b: [70, 90, 130, 200, 250], tilt: 0.5 },
  AO: { f: [570, 840, 2410, 3300, 4100], b: [80, 90, 130, 210, 250], tilt: 0.42 },
  AH: { f: [640, 1190, 2390, 3400, 4200], b: [80, 100, 130, 210, 250], tilt: 0.48 },
  AX: { f: [500, 1500, 2500, 3400, 4200], b: [90, 120, 150, 220, 260], tilt: 0.45 },
  UH: { f: [440, 1020, 2240, 3300, 4000], b: [70, 90, 120, 200, 240], tilt: 0.4 },
  UW: { f: [300, 870, 2240, 3300, 4000], b: [50, 40, 90, 180, 220], tilt: 0.55 },
  ER: { f: [490, 1350, 1690, 3300, 4000], b: [80, 100, 100, 200, 240], tilt: 0.44 },
};

const DIPH = {
  AY: ["AA", "IY"],
  AW: ["AA", "UW"],
  EY: ["EH", "IY"],
  OW: ["AO", "UW"],
  OY: ["AO", "IY"],
};

// Parallel amplitudes are linear, with 1.0 corresponding to a Klatt amplitude near 60 dB
// and 0.5 near 54 dB. Only the strong partials are filled in; the rest stay at 0.
const CONS = {
  M: { f: [280, 900, 2200, 3300, 4000], b: [80, 150, 200, 250, 300], nasal: 1, fnp: 280, fnz: 850, av: 0.9, tilt: 0.4 },
  N: { f: [300, 1500, 2500, 3400, 4200], b: [80, 160, 200, 250, 300], nasal: 1, fnp: 320, fnz: 1600, av: 0.9, tilt: 0.42 },
  NG: { f: [300, 1800, 2500, 3400, 4200], b: [90, 170, 200, 250, 300], nasal: 1, fnp: 350, fnz: 2200, av: 0.85, tilt: 0.4 },
  W: { f: [300, 680, 2200, 3300, 4000], b: [60, 80, 120, 200, 250], av: 1, tilt: 0.38 },
  Y: { f: [280, 2200, 3000, 3600, 4500], b: [50, 90, 140, 200, 260], av: 1, tilt: 0.58 },
  R: { f: [420, 1100, 1560, 3200, 4000], b: [70, 90, 90, 200, 240], av: 1, tilt: 0.42 },
  L: { f: [400, 1200, 2600, 3400, 4200], b: [70, 100, 140, 210, 250], av: 1, tilt: 0.46 },
  HH: { f: [500, 1500, 2500, 3500, 4500], b: [140, 180, 220, 280, 320], av: 0.15, ah: 0.85, tilt: 0.5 },
  F: { f: [400, 1200, 1800, 3400, 4500], b: [200, 250, 300, 400, 500], af: 0.4, parF: 1700, parB: 700, parA: 0.22, ab: 0.12 },
  TH: { f: [400, 1400, 2000, 4000, 5000], b: [200, 250, 300, 400, 500], af: 0.38, parF: 2000, parB: 800, parA: 0.2, ab: 0.12 },
  S: { f: [400, 1600, 2600, 4800, 5600], b: [200, 300, 400, 500, 700], af: 0.48, parF: 5200, parB: 900, parA: 0.36, ab: 0.08 },
  SH: { f: [400, 1800, 2500, 3400, 4500], b: [200, 250, 300, 400, 500], af: 0.46, parF: 2800, parB: 700, parA: 0.34, ab: 0.08 },
  V: { f: [280, 1100, 2000, 3400, 4300], b: [80, 140, 200, 280, 320], av: 0.55, af: 0.4, parF: 1600, parB: 600, parA: 0.3, ab: 0.15, tilt: 0.4 },
  DH: { f: [280, 1300, 2200, 3600, 4400], b: [80, 150, 200, 280, 320], av: 0.6, af: 0.35, parF: 1800, parB: 650, parA: 0.28, ab: 0.14, tilt: 0.42 },
  Z: { f: [300, 1600, 2600, 4800, 5600], b: [90, 200, 300, 450, 600], av: 0.45, af: 0.4, parF: 5000, parB: 900, parA: 0.28, ab: 0.06, tilt: 0.45 },
  ZH: { f: [300, 1700, 2400, 3400, 4500], b: [90, 180, 250, 350, 450], av: 0.45, af: 0.38, parF: 2700, parB: 700, parA: 0.26, ab: 0.06, tilt: 0.44 },
  P: { stop: true, voiced: false, f: [300, 900, 1800, 3000, 4000], b: [150, 200, 250, 300, 400], parF: 1200, parB: 400, parA: 0.32, ab: 0.12 },
  B: { stop: true, voiced: true, f: [180, 900, 1800, 3000, 4000], b: [80, 180, 220, 280, 360], parF: 1100, parB: 400, parA: 0.5, ab: 0.2 },
  T: { stop: true, voiced: false, f: [300, 1600, 2600, 4500, 5600], b: [150, 220, 300, 400, 500], parF: 4500, parB: 800, parA: 0.36, ab: 0.1 },
  D: { stop: true, voiced: true, f: [180, 1500, 2500, 4200, 5200], b: [80, 180, 250, 350, 450], parF: 4000, parB: 700, parA: 0.55, ab: 0.18 },
  K: { stop: true, voiced: false, f: [300, 1800, 2400, 3600, 4500], b: [150, 200, 250, 320, 400], parF: 2200, parB: 500, parA: 0.34, ab: 0.1 },
  G: { stop: true, voiced: true, f: [180, 1600, 2300, 3400, 4300], b: [80, 180, 220, 300, 380], parF: 1900, parB: 450, parA: 0.5, ab: 0.16 },
  CH: { affr: true, voiced: false, f: [300, 1800, 2500, 3600, 4600], b: [160, 220, 280, 360, 450], parF: 3000, parB: 700, parA: 0.34, ab: 0.08 },
  JH: { affr: true, voiced: true, f: [200, 1700, 2400, 3400, 4400], b: [90, 180, 240, 320, 400], parF: 2800, parB: 650, parA: 0.6, ab: 0.16 },
};

// Singer gains raised about 3-5.5 dB in the reviewer pass after the singer
// moved an octave below high leads, so the voice sits about 2 dB under the bed.
const STYLE_GAIN = {
  lofi: { singer: 0.22, choir: 0.128, light: 0.097 },
  // Choir and light only. The 0.14 s attack needed a higher gain to stay near 5 dB under the lead.
  ambient: { singer: 0.135, choir: 0.086, light: 0.065 },
  // Choir and light only. Merged holds sat 6.4 dB under; singer gain is unchanged.
  arp: { singer: 0.175, choir: 0.138, light: 0.106 },
  synthwave: { singer: 0.186, choir: 0.087, light: 0.066 },
};

const CHOIR_VOICE = [
  { cents: 0, scale: 1, pan: 0.06, mul: 1 },
  { cents: 8, scale: 1.05, pan: 0.58, mul: 0.78 },
  { cents: -12, scale: 0.85, pan: -0.58, mul: 0.88 },
];

const ONSET = new Set([
  "P", "T", "K", "B", "D", "G", "F", "TH", "S", "SH", "V", "DH", "Z", "ZH", "HH", "CH", "JH", "M", "N", "L", "R", "W", "Y",
  "PL", "PR", "TR", "TW", "KL", "KR", "KW", "BL", "BR", "DR", "DW", "GL", "GR", "FL", "FR",
  "SL", "SM", "SN", "SW", "SP", "ST", "SK", "SHR", "SPR", "STR", "SKR", "SPL", "SKW", "THW", "THR",
]);

const LTS = [
  ["tion", "SH AH0 N"], ["sion", "ZH AH0 N"], ["ight", "AY1 T"], ["ough", "OW1"], ["augh", "AO1"],
  ["eigh", "EY1"], ["dge", "JH"], ["ing", "IH0 NG"], ["ang", "AE1 NG"], ["ong", "AO1 NG"], ["ung", "AH1 NG"],
  ["igh", "AY1"], ["ee", "IY1"], ["ea", "IY1"], ["oo", "UW1"], ["ai", "EY1"], ["ay", "EY1"], ["oa", "OW1"],
  ["ow", "OW1"], ["ou", "AW1"], ["oi", "OY1"], ["oy", "OY1"], ["au", "AO1"], ["aw", "AO1"], ["ew", "UW1"],
  ["ch", "CH"], ["sh", "SH"], ["th", "TH"], ["ph", "F"], ["wh", "W"], ["qu", "K W"], ["ck", "K"], ["ng", "NG"],
];

const SINGLE = {
  a: "AE1", e: "EH1", i: "IH1", o: "AA1", u: "AH1", y: "IY0",
  b: "B", c: "K", d: "D", f: "F", g: "G", h: "HH", j: "JH", k: "K", l: "L", m: "M", n: "N",
  p: "P", q: "K", r: "R", s: "S", t: "T", v: "V", w: "W", x: "K S", z: "Z",
};

let dict = null;
let dictFailed = false;
let dictLogged = false;
let dictMs = 0;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function pcOf(midi) {
  return ((midi % 12) + 12) % 12;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function basePhone(phone) {
  return String(phone || "").replace(/[012]$/, "");
}

function stressOf(phone) {
  const m = /([012])$/.exec(phone || "");
  return m ? Number(m[1]) : 0;
}

function isVowel(phone) {
  return VOWELS.has(basePhone(phone));
}

function hash01(n) {
  let x = Math.imul((n ^ 0x9e3779b9) >>> 0, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x >>> 0) % 100000) / 100000;
}

export function dictionaryMs() {
  return dictMs;
}

export function dictionaryReady() {
  return Boolean(dict);
}

function assetsDir() {
  return process.env.VIBE_FILTER_ASSETS
    || path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
}

export function loadDictionary() {
  if (dict || dictFailed) return dict;
  const file = path.join(assetsDir(), "cmudict", "cmudict.dict");
  const t0 = Date.now();
  try {
    const text = fs.readFileSync(file, "utf8");
    const map = new Map();
    let start = 0;
    const n = text.length;
    while (start < n) {
      let end = text.indexOf("\n", start);
      if (end < 0) end = n;
      let line = text.slice(start, end);
      start = end + 1;
      if (!line || line.charCodeAt(0) === 59) continue;
      const hash = line.indexOf("#");
      if (hash >= 0) line = line.slice(0, hash);
      line = line.trim();
      if (!line) continue;
      const sp = line.indexOf(" ");
      if (sp < 0) continue;
      const word = line.slice(0, sp).toLowerCase();
      if (word.includes("(")) continue;
      if (map.has(word)) continue;
      const phones = line.slice(sp + 1).trim();
      if (phones) map.set(word, phones);
    }
    dict = map;
    dictMs = Date.now() - t0;
  } catch {
    dictFailed = true;
    dict = null;
    dictMs = Date.now() - t0;
    if (!dictLogged) {
      dictLogged = true;
      console.error("cmudict missing, using letter-to-sound");
    }
  }
  return dict;
}

export function pronounce(word) {
  const key = String(word || "").toLowerCase();
  const table = loadDictionary();
  if (table) {
    if (table.has(key)) return table.get(key).split(/\s+/);
    const stripped = key.replace(/'/g, "");
    if (stripped !== key && table.has(stripped)) return table.get(stripped).split(/\s+/);
  } else if (!dictLogged) {
    dictLogged = true;
    console.error("cmudict missing, using letter-to-sound");
  }
  return letterToSound(key.replace(/'/g, ""));
}

function letterToSound(word) {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return ["AH0"];
  const phones = [];
  let i = 0;
  let vowelSeen = false;
  const push = (token) => {
    for (const phone of token.split(" ")) {
      if (!phone) continue;
      if (isVowel(phone)) {
        if (vowelSeen && phone.endsWith("1")) phones.push(phone.slice(0, -1) + "0");
        else phones.push(phone);
        vowelSeen = true;
      } else phones.push(phone);
    }
  };
  while (i < w.length) {
    let hit = null;
    for (const [graf, phonesText] of LTS) {
      if (w.startsWith(graf, i)) {
        hit = [graf, phonesText];
        break;
      }
    }
    if (hit) {
      push(hit[1]);
      i += hit[0].length;
      continue;
    }
    const one = SINGLE[w[i]];
    if (one) push(one);
    i += 1;
  }
  if (!phones.some(isVowel)) phones.push("AH0");
  return phones;
}

function legalOnset(bases) {
  if (!bases.length || bases.length > 3) return bases.length === 0;
  return ONSET.has(bases.join(""));
}

function longestOnset(bases) {
  for (let len = Math.min(3, bases.length); len >= 0; len -= 1) {
    if (legalOnset(bases.slice(bases.length - len))) return len;
  }
  return 0;
}

export function syllabify(phones) {
  const list = phones && phones.length ? phones : ["AH0"];
  const vows = [];
  for (let i = 0; i < list.length; i += 1) if (isVowel(list[i])) vows.push(i);
  if (!vows.length) return [{ phones: list.slice(), stress: 0, vowel: "AH" }];
  const out = [];
  for (let s = 0; s < vows.length; s += 1) {
    const v = vows[s];
    const prev = s === 0 ? -1 : vows[s - 1];
    const next = s + 1 < vows.length ? vows[s + 1] : list.length;
    let start;
    if (s === 0) start = 0;
    else {
      const cluster = list.slice(prev + 1, v).map(basePhone);
      start = v - longestOnset(cluster);
    }
    let end;
    if (s === vows.length - 1) end = list.length;
    else {
      const cluster = list.slice(v + 1, next).map(basePhone);
      const coda = cluster.length - longestOnset(cluster);
      end = v + 1 + coda;
    }
    out.push({
      phones: list.slice(start, end),
      stress: stressOf(list[v]),
      vowel: basePhone(list[v]),
    });
  }
  return out;
}

function wordsOf(line) {
  return String(line || "").toLowerCase().match(/[a-z0-9']+/g) || [];
}

function lyricLines(text) {
  return String(text || "")
    .split(/\n+/)
    .flatMap((line) => line.split(/\s+\/\s+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function lineSyllables(line) {
  const words = wordsOf(line);
  const syllables = [];
  for (const word of words) {
    const phones = pronounce(word);
    const parts = syllabify(phones);
    parts.forEach((part, index) => {
      syllables.push({ ...part, word, index, count: parts.length });
    });
  }
  return syllables;
}

function leadPhrases(lead, sections) {
  const phrases = [];
  let cur = [];
  const nameAt = (t) => sectionAt(sections, t)?.name || "";
  for (const note of lead) {
    if (!cur.length) {
      cur.push(note);
      continue;
    }
    const prev = cur[cur.length - 1];
    const gap = note.t - (prev.t + (prev.dur || 0.2));
    // "variation" only marks a note whose contour was bent; it is not a new phrase.
    const roleOf = (n) => (n.role === "variation" ? "" : (n.role || ""));
    const roleBreak = roleOf(note) !== roleOf(prev) && roleOf(note) !== "" && roleOf(prev) !== "";
    const sectionBreak = nameAt(note.t) !== nameAt(prev.t);
    // A short rest inside one role stays in the phrase. The last motif note
    // after that rest is not a new phrase.
    if (roleBreak || sectionBreak || gap > 0.75) {
      phrases.push(cur);
      cur = [note];
    } else cur.push(note);
  }
  if (cur.length) phrases.push(cur);
  // Generated motifs make two shapes the old fixed motif never did. A lone
  // short note right before the next phrase is a pickup: it joins that phrase.
  // A long run of sequence notes holds several sub-phrases: it splits after a
  // held note (twice the run's median length), so a line can start there.
  const merged = [];
  for (let i = 0; i < phrases.length; i += 1) {
    const phrase = phrases[i];
    const next = phrases[i + 1];
    if (phrase.length === 1 && next && (phrase[0].dur || 0.2) < 0.3 && !phrase[0].land
      && next[0].t - (phrase[0].t + (phrase[0].dur || 0.2)) <= 0.1
      && nameAt(next[0].t) === nameAt(phrase[0].t)) {
      phrases[i + 1] = [phrase[0], ...next];
      continue;
    }
    merged.push(phrase);
  }
  const out = [];
  for (const phrase of merged) {
    if (phrase.length < 8) {
      out.push(phrase);
      continue;
    }
    const durs = phrase.map((note) => note.dur || 0.2).sort((a, b) => a - b);
    const median = durs[Math.floor(durs.length / 2)];
    let part = [];
    for (let i = 0; i < phrase.length; i += 1) {
      part.push(phrase[i]);
      const held = (phrase[i].dur || 0.2) >= median * 1.9 && (phrase[i].dur || 0.2) >= 0.4;
      if (held && part.length >= 3 && phrase.length - i - 1 >= 3) {
        out.push(part);
        part = [];
      }
    }
    if (part.length) out.push(part);
  }
  return out;
}

function cloneNote(note) {
  return {
    t: note.t,
    midi: note.midi,
    dur: note.dur || 0.2,
    strong: Boolean(note.strong),
    land: Boolean(note.land),
    role: note.role || "",
  };
}

function slotCapacity(notes) {
  let count = notes.length;
  for (const note of notes) {
    if (note.land) continue;
    if ((note.dur || 0) >= 0.28) count += 1;
  }
  return count;
}

function expandSlots(notes, extra, protectLand) {
  // Long notes may be split more than once (a 1 s note can carry three
  // syllables) when a sparse melody has fewer notes than the line has syllables.
  let out = expandOnce(notes, extra, protectLand);
  for (let pass = 0; pass < 2 && out.length - notes.length < extra; pass += 1) {
    const before = out.length;
    out = expandOnce(out, extra - (out.length - notes.length), protectLand);
    if (out.length === before) break;
  }
  return out;
}

function expandOnce(notes, extra, protectLand) {
  const slots = notes.map(cloneNote);
  if (extra <= 0) return slots;
  const order = slots
    .map((note, index) => ({ index, dur: note.dur, land: note.land }))
    .filter((item) => item.dur >= 0.28 && !(protectLand && item.land))
    .sort((a, b) => b.dur - a.dur);
  const splitAt = new Set();
  let left = extra;
  for (const item of order) {
    if (left <= 0) break;
    if (item.dur * 0.5 < 0.12) continue;
    splitAt.add(item.index);
    left -= 1;
  }
  if (!splitAt.size) return slots;
  const next = [];
  for (let i = 0; i < slots.length; i += 1) {
    const note = slots[i];
    if (!splitAt.has(i)) {
      next.push(note);
      continue;
    }
    const half = round3(note.dur * 0.5);
    const rest = round3(note.dur - half);
    next.push({ ...note, dur: half, land: false });
    next.push({ ...note, t: round3(note.t + half), dur: rest, strong: false, land: note.land });
  }
  return next;
}

function placeHead(syllables, slots) {
  const placed = [];
  if (!syllables.length) return { placed, unsung: 0 };
  if (!slots.length) return { placed, unsung: syllables.length };
  if (syllables.length > slots.length) {
    for (let i = 0; i < slots.length; i += 1) placed.push({ syl: syllables[i], note: slots[i] });
    return { placed, unsung: syllables.length - slots.length };
  }
  for (let i = 0; i < syllables.length - 1; i += 1) placed.push({ syl: syllables[i], note: slots[i] });
  const first = slots[syllables.length - 1];
  const last = slots[slots.length - 1];
  const span = slots.slice(syllables.length - 1);
  placed.push({
    syl: syllables[syllables.length - 1],
    note: { ...first, dur: round3(last.t + last.dur - first.t) },
    melisma: span.length > 1 ? span : null,
  });
  return { placed, unsung: 0 };
}

function placeOnSlots(syllables, slots, holdCadence) {
  if (!syllables.length) return { placed: [], unsung: 0 };
  const cadence = holdCadence
    ? slots.findIndex((note) => note.land && note.dur >= 0.8)
    : -1;
  const cadenceAt = cadence >= 0 ? cadence : (holdCadence && slots.length && slots[slots.length - 1].dur >= 1.2 ? slots.length - 1 : -1);
  if (cadenceAt > 0) {
    const before = slots.slice(0, cadenceAt);
    const tail = slots.slice(cadenceAt);
    const head = syllables.slice(0, -1);
    const headSlots = expandSlots(before, Math.max(0, head.length - before.length), false);
    const headFit = placeHead(head, headSlots);
    const cad0 = tail[0];
    const cad1 = tail[tail.length - 1];
    headFit.placed.push({
      syl: syllables[syllables.length - 1],
      note: { ...cad0, dur: round3(cad1.t + cad1.dur - cad0.t), land: true },
      melisma: tail.length > 1 ? tail : null,
    });
    return { placed: headFit.placed, unsung: headFit.unsung };
  }
  const grown = expandSlots(slots, Math.max(0, syllables.length - slots.length), true);
  return placeHead(syllables, grown);
}

function singableIndexes(phrases, sections, duration) {
  const idxs = [];
  phrases.forEach((phrase, index) => {
    const name = sectionAt(sections, phrase[0].t)?.name || "";
    if (duration >= 18 && (name === "intro" || name === "resolve")) return;
    if (name === "breakdown") return;
    idxs.push(index);
  });
  return idxs;
}

function planLineRanges(phrases, sections, duration, syllCounts) {
  const idxs = singableIndexes(phrases, sections, duration);
  const lineCount = syllCounts.length;
  if (!lineCount || !idxs.length) return [];
  let suffix = idxs.length - 1;
  const need = syllCounts[lineCount - 1] || 1;
  for (let s = idxs.length - 1; s >= 0; s -= 1) {
    let notes = [];
    for (let k = s; k < idxs.length; k += 1) notes.push(...phrases[idxs[k]]);
    suffix = s;
    if (slotCapacity(notes) >= need) break;
  }
  // The last line owns the cadence window. Earlier lines take earlier phrases
  // in order and never start on that window's tail.
  const ranges = new Array(lineCount);
  ranges[lineCount - 1] = { from: idxs[suffix], to: phrases.length };
  const earlier = lineCount - 1;
  const before = idxs.slice(0, suffix);
  // Earlier lines share the phrases before that window in order. A line takes
  // phrases until it has room for its syllables (generated motifs can be short
  // fragments), but always leaves one phrase for each line still to come.
  let k = 0;
  for (let i = 0; i < earlier; i += 1) {
    if (k >= before.length) {
      ranges[i] = null;
      continue;
    }
    const startK = k;
    let room = slotCapacity(phrases[before[k]]);
    k += 1;
    while (k < before.length && room < (syllCounts[i] || 1) && before.length - k > earlier - 1 - i) {
      room += slotCapacity(phrases[before[k]]);
      k += 1;
    }
    if (i === earlier - 1) k = before.length;
    const from = before[startK];
    const to = k < before.length ? before[k] : idxs[suffix];
    ranges[i] = { from, to };
  }
  if (ranges.every(Boolean)) return ranges;
  // A sparse melody (long notes, few phrases) can let the last line's window
  // swallow every phrase and leave earlier lines silent. Share the phrases out
  // in order instead: each line starts on its own phrase, the last line keeps
  // the cadence. Intro phrases are allowed only when there are not enough.
  let pool = idxs;
  if (pool.length < lineCount) {
    pool = phrases.map((_, index) => index).filter((index) => sectionAt(sections, phrases[index][0].t)?.name !== "breakdown");
  }
  if (pool.length < lineCount) return ranges;
  // The last line still gets a window big enough for its syllables; earlier
  // lines share what comes before it, at least one phrase each.
  let lastStart = pool.length - 1;
  let room = 0;
  for (let k = pool.length - 1; k >= 0; k -= 1) {
    room += slotCapacity(phrases[pool[k]]);
    lastStart = k;
    if (room >= (syllCounts[lineCount - 1] || 1)) break;
  }
  lastStart = Math.max(lastStart, lineCount - 1);
  const starts = [];
  let at = 0;
  for (let i = 0; i < lineCount - 1; i += 1) {
    starts.push(at);
    let have = slotCapacity(phrases[pool[at]]);
    at += 1;
    while (at < lastStart && have < (syllCounts[i] || 1) && lastStart - at > lineCount - 2 - i) {
      have += slotCapacity(phrases[pool[at]]);
      at += 1;
    }
  }
  starts.push(lastStart);
  const shared = new Array(lineCount);
  for (let i = 0; i < lineCount; i += 1) {
    const from = pool[starts[i]];
    const to = i + 1 < lineCount ? pool[starts[i + 1]] : phrases.length;
    shared[i] = { from, to };
  }
  return shared;
}

function fitLyricsToPhrases(linesIn, phrasesIn, sections, duration) {
  const sylls = linesIn.map((line) => lineSyllables(line));
  // More lines than singable phrases (slow clips with long motifs): split the
  // longest phrase after its longest inner note until every line can start on
  // its own phrase. Each half is still a run of consecutive melody notes.
  const phrases = phrasesIn.map((phrase) => phrase.slice());
  for (let guard = 0; guard < 8 && singableIndexes(phrases, sections, duration).length < sylls.length + 1; guard += 1) {
    let pick = -1;
    for (const index of singableIndexes(phrases, sections, duration)) {
      if (phrases[index].length >= 4 && (pick < 0 || phrases[index].length > phrases[pick].length)) pick = index;
    }
    if (pick < 0) break;
    const phrase = phrases[pick];
    let cut = Math.floor(phrase.length / 2);
    let best = -1;
    for (let i = 1; i < phrase.length - 2; i += 1) {
      if ((phrase[i].dur || 0.2) > best) { best = phrase[i].dur || 0.2; cut = i + 1; }
    }
    cut = Math.min(phrase.length - 2, Math.max(2, cut));
    phrases.splice(pick, 1, phrase.slice(0, cut), phrase.slice(cut));
  }
  const ranges = planLineRanges(phrases, sections, duration, sylls.map((syll) => syll.length));
  const owned = new Set(ranges.filter(Boolean).map((range) => range.from));
  const lines = [];
  const placed = [];
  let syllables = 0;
  let sung = 0;
  let unsung = 0;
  sylls.forEach((syll, li) => {
    syllables += syll.length;
    const range = ranges[li];
    if (!range || range.from == null || range.from >= phrases.length) {
      unsung += syll.length;
      lines.push({
        text: linesIn[li],
        syllables: syll.length,
        sung: 0,
        phones: syll.map((part) => part.phones),
      });
      return;
    }
    const isLast = li === sylls.length - 1;
    const from = range.from;
    const ceiling = range.to;
    const notes = [];
    const firstSyl = syll[0];
    if (firstSyl && (firstSyl.stress || 0) === 0 && from > 0 && !owned.has(from - 1)) {
      const prev = phrases[from - 1];
      const tail = prev[prev.length - 1];
      const head = phrases[from][0];
      const gap = head.t - (tail.t + (tail.dur || 0.2));
      if ((tail.dur || 0) <= 0.45 && gap <= 0.08 && gap >= -0.04) notes.push(cloneNote(tail));
    }
    // The last line always takes its whole window, so the final syllable can
    // sit on the cadence even when an earlier phrase already has enough slots.
    const initialTo = isLast ? Math.min(phrases.length, ceiling) : Math.min(phrases.length, from + 1);
    for (let p = from; p < initialTo; p += 1) notes.push(...phrases[p].map(cloneNote));
    let through = initialTo - 1;
    let fit = placeOnSlots(syll, notes, isLast);
    while (fit.unsung > 0 && through + 1 < ceiling && through + 1 < phrases.length) {
      through += 1;
      notes.push(...phrases[through].map(cloneNote));
      fit = placeOnSlots(syll, notes, isLast);
    }
    unsung += fit.unsung;
    sung += syll.length - fit.unsung;
    fit.placed.forEach((item) => placed.push({ ...item, line: li }));
    lines.push({
      text: linesIn[li],
      syllables: syll.length,
      sung: syll.length - fit.unsung,
      phones: syll.map((part) => part.phones),
    });
  });
  return { lines, placed, syllables, sung, unsung };
}

function lengthenStress(placed) {
  for (let i = 0; i < placed.length - 1; i += 1) {
    const a = placed[i];
    const b = placed[i + 1];
    if (a.syl.word !== b.syl.word || a.melisma || b.melisma) continue;
    if ((a.syl.stress || 0) <= (b.syl.stress || 0)) continue;
    if (a.note.dur >= b.note.dur) continue;
    const gap = b.note.t - (a.note.t + a.note.dur);
    if (gap > 0.04) continue;
    const give = Math.min(0.07, b.note.dur * 0.28);
    if (give < 0.02 || b.note.dur - give < 0.06) continue;
    a.note = { ...a.note, dur: round3(a.note.dur + give) };
    b.note = { ...b.note, t: round3(b.note.t + give), dur: round3(b.note.dur - give) };
  }
}

function consDur(phone) {
  const b = basePhone(phone);
  if (STOPS.has(b)) return 0.05;
  if (AFFRICATES.has(b)) return 0.07;
  if (b === "S" || b === "SH" || b === "Z" || b === "ZH") return 0.07;
  if (FRIC.has(b)) return 0.05;
  if (NASAL.has(b)) return 0.048;
  if (b === "HH") return 0.04;
  return 0.045;
}

function onsetDurOf(phone) {
  const b = basePhone(phone);
  if (b === "S" || b === "SH" || b === "CH") return 0.072;
  if (b === "Z" || b === "ZH" || b === "JH") return 0.06;
  if (STOPS.has(b)) return 0.046;
  if (FRIC.has(b)) return 0.05;
  if (NASAL.has(b)) return 0.048;
  if (b === "HH") return 0.04;
  return 0.045;
}

function codaDurOf(phone) {
  const b = basePhone(phone);
  if (NASAL.has(b)) return 0.038;
  if (b === "S" || b === "SH" || b === "Z" || b === "ZH") return 0.036;
  if (AFFRICATES.has(b)) return 0.034;
  return 0.03;
}

function gainsFor(style, tier) {
  const table = STYLE_GAIN[style] || STYLE_GAIN.ambient;
  if (tier === "singer") return [table.singer, 0, 0];
  if (tier === "light") return [0, 0, table.light * CHOIR_VOICE[2].mul];
  const g = table.choir;
  return CHOIR_VOICE.map((voice) => g * voice.mul);
}

function emptyFit(duration) {
  return {
    coverage: 0,
    unsungPct: 0,
    syllables: 0,
    sung: 0,
    lines: [],
    choir: [],
    phonemes: [],
    events: [],
    voiceClashes: [],
    duration,
  };
}

function chordAt(chords, t) {
  if (!chords || !chords.length) return null;
  let chord = chords[0];
  for (let i = 0; i < chords.length; i += 1) {
    if (t >= chords[i].t0 - 0.001) chord = chords[i];
    else break;
  }
  return chord;
}

function soundingPcs(chord, bass, t, dur) {
  const pcs = new Set((chord?.notes || []).map(pcOf));
  for (const note of bass || []) {
    const end = note.t + (note.dur || 0.2);
    if (note.t < t + dur - 0.02 && end > t + 0.02) pcs.add(pcOf(note.midi));
  }
  return [...pcs];
}

function semiClash(midi, pcs) {
  return pcs.some((pc) => {
    const d = Math.abs(pcOf(midi) - pc) % 12;
    return d === 1 || d === 11;
  });
}

function hitsLead(midi, t, dur, lead) {
  for (const note of lead) {
    const end = note.t + (note.dur || 0.2);
    if (!(note.t < t + dur - 0.02 && end > t + 0.02)) continue;
    if (Math.abs(midi - note.midi) <= 1) return true;
    if (pcOf(midi) === pcOf(note.midi)) return true;
  }
  return false;
}

function degreeShift(midi, key, steps, approx) {
  const scale = SCALE[key.mode] || SCALE.major;
  const rel = ((pcOf(midi) - key.pc) % 12 + 12) % 12;
  let deg = 0;
  let best = 99;
  for (let i = 0; i < scale.length; i += 1) {
    const d = Math.min((rel - scale[i] + 12) % 12, (scale[i] - rel + 12) % 12);
    if (d < best) {
      best = d;
      deg = i;
    }
  }
  const pc = (key.pc + scale[(deg + steps + 70) % 7]) % 12;
  const target = midi - approx;
  let chosen = null;
  let dist = 99;
  for (let m = 36; m <= 96; m += 1) {
    if (pcOf(m) !== pc) continue;
    const d = Math.abs(m - target);
    if (d < dist) {
      dist = d;
      chosen = m;
    }
  }
  return chosen;
}

function fitUnder(midi, leadMidi) {
  if (midi == null) return null;
  let m = midi;
  const hi = Math.min(76, leadMidi - 3);
  while (m > hi) m -= 12;
  while (m < 52) m += 12;
  if (m < 52 || m > hi) return null;
  return m;
}

function closest(target, pool) {
  let best = pool[0];
  let dist = Math.abs(best - target);
  for (const midi of pool) {
    const d = Math.abs(midi - target);
    if (d < dist) {
      dist = d;
      best = midi;
    }
  }
  return best;
}

function choirPool(note, lead, chords, bass, key) {
  const local = keyAt(key, note.t);
  const chord = chordAt(chords, note.t + 0.01);
  const pcs = soundingPcs(chord, bass, note.t, note.dur);
  const hi = Math.min(76, (note.leadMidi || 80) - 3);
  const scale = (SCALE[local.mode] || SCALE.major).map((semi) => (semi + local.pc) % 12);
  const bad = (midi) => midi < 52 || midi > hi || semiClash(midi, pcs) || hitsLead(midi, note.t, note.dur, lead);
  const pool = [];
  const chordPcs = new Set((chord?.notes || []).map(pcOf));
  for (let m = 52; m <= hi; m += 1) {
    const pc = pcOf(m);
    if (!scale.includes(pc) && !chordPcs.has(pc)) continue;
    if (bad(m)) continue;
    pool.push(m);
  }
  return { bad, pool };
}

function screenChoir(notes, lead, chords, bass, key) {
  const flags = [];
  let prev = null;
  for (const note of notes) {
    const leapLimited = prev != null && !note.phraseStart;
    const nearOf = (pool) => (leapLimited ? pool.filter((midi) => Math.abs(midi - prev) <= 7) : pool);
    let info = choirPool(note, lead, chords, bass, key);
    const leap = leapLimited && Math.abs(note.midi - prev) > 7;
    if (info.bad(note.midi) || leap) {
      const near = nearOf(info.pool);
      if (near.length) note.midi = closest(prev ?? note.midi, near);
      else {
        // No harmony tone within a 5th fits the whole hold. Shorten from the
        // tail until one does, instead of keeping a semitone clash.
        const original = note.dur;
        let fitted = false;
        for (let dur = original - 0.02; dur >= 0.18; dur -= 0.02) {
          note.dur = round3(dur);
          info = choirPool(note, lead, chords, bass, key);
          const shorter = nearOf(info.pool);
          if (shorter.length) {
            note.midi = closest(prev ?? note.midi, shorter);
            fitted = true;
            break;
          }
        }
        if (!fitted) {
          note.dur = original;
          info = choirPool(note, lead, chords, bass, key);
          if (info.pool.length) note.midi = closest(prev ?? note.midi, info.pool);
          else note.strong = false;
        }
      }
    }
    info = choirPool(note, lead, chords, bass, key);
    if (info.bad(note.midi)) flags.push(`${note.t.toFixed(3)} midi ${note.midi} choir`);
    prev = note.midi;
  }
  return flags;
}

function overlapAmount(note, intervals) {
  const a = note.t;
  const b = note.t + (note.dur || 0.2);
  let hit = 0;
  for (const [s, e] of intervals) {
    const lo = Math.max(a, s);
    const hi = Math.min(b, e);
    if (hi > lo) hit += hi - lo;
  }
  return hit;
}

function choirVoicesFor(name) {
  if (name === "intro" || name === "resolve") return 0;
  if (name === "build" || name === "B" || name === "A'") return 3;
  return name === "A" || name === "breakdown" || name === "outro" ? 1 : 0;
}

function mergeCoverage(intervals, duration) {
  if (!intervals.length || duration <= 0) return 0;
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  let s = sorted[0][0];
  let e = sorted[0][1];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i][0] <= e) e = Math.max(e, sorted[i][1]);
    else {
      total += Math.max(0, Math.min(e, duration) - Math.max(0, s));
      s = sorted[i][0];
      e = sorted[i][1];
    }
  }
  total += Math.max(0, Math.min(e, duration) - Math.max(0, s));
  return total / duration;
}

function segmentsForSyllable(item, style, tier, prevEnd) {
  const phones = item.syl.phones.length ? item.syl.phones : ["AH0"];
  const notes = item.melisma && item.melisma.length ? item.melisma : [item.note];
  let v0 = phones.findIndex(isVowel);
  if (v0 < 0) v0 = 0;
  let v1 = v0;
  for (let i = phones.length - 1; i >= 0; i -= 1) {
    if (isVowel(phones[i])) {
      v1 = i;
      break;
    }
  }
  const onset = phones.slice(0, v0);
  const nucleus = basePhone(phones[v0]);
  const coda = phones.slice(v1 + 1);
  const diph = DIPH[nucleus] || null;
  const vowelPhone = diph ? diph[0] : (nucleus === "AH" && stressOf(phones[v0]) === 0 ? "AX" : nucleus);
  const phone2 = diph ? diph[1] : null;
  let onsetD = onset.map(onsetDurOf);
  let codaD = coda.map(codaDurOf);
  const beat = notes[0].t;
  const end = notes[notes.length - 1].t + notes[notes.length - 1].dur;
  const span = Math.max(0.05, end - beat);
  let codaSum = codaD.reduce((a, b) => a + b, 0);
  if (coda.length && codaSum > 0.07) {
    const scale = 0.07 / codaSum;
    codaD = codaD.map((d) => Math.max(0.02, d * scale));
    codaSum = codaD.reduce((a, b) => a + b, 0);
    if (codaSum > 0.07) {
      const again = 0.07 / codaSum;
      codaD = codaD.map((d) => d * again);
      codaSum = 0.07;
    }
  }
  let onsetSum = onsetD.reduce((a, b) => a + b, 0);
  // Onset prefers the gap before the beat. The vowel keeps at least 60% of the note.
  const roomBefore = Math.max(0, beat - Math.max(0, prevEnd));
  const preFull = Math.min(onsetSum, roomBefore);
  let inside = Math.max(0, onsetSum - preFull);
  const vowelNow = span - codaSum - inside;
  if (vowelNow < span * 0.6) {
    let deficit = span * 0.6 - vowelNow;
    const takeIn = Math.min(inside, deficit);
    inside -= takeIn;
    deficit -= takeIn;
    if (deficit > 0 && codaSum > 0) {
      const floor = Math.min(codaSum, codaD.length * 0.02);
      const takeC = Math.min(deficit, Math.max(0, codaSum - floor));
      if (takeC > 0) {
        const scale = (codaSum - takeC) / codaSum;
        codaD = codaD.map((d) => d * scale);
        codaSum -= takeC;
      }
    }
    const newSum = preFull + inside;
    if (onsetSum > newSum && onsetSum > 0) {
      const scale = newSum / onsetSum;
      onsetD = onsetD.map((d) => d * scale);
      onsetSum = newSum;
    }
  }
  const pre = Math.min(onsetSum, roomBefore);
  const gains = gainsFor(style, tier);
  const segs = [];
  const phonemeRows = [];
  let t = beat - pre;
  onset.forEach((phone, index) => {
    const dur = onsetD[index];
    if (dur < 0.01) return;
    segs.push(segment(t, t + dur, notes[0].midi, phone, null, gains, tier, 0));
    phonemeRows.push({ phone, t, dur });
    t += dur;
  });
  const vowelStart = Math.max(beat, t);
  const vowelEnd = Math.max(vowelStart + 0.03, end - codaSum);
  const vowDur = Math.max(0.03, vowelEnd - vowelStart);
  // Diphthongs stay on the first target, then glide across the last 40%.
  const diph0 = diph ? vowelStart + vowDur * 0.6 : vowelStart;
  const diph1 = vowelEnd;
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    const start = i === 0 ? vowelStart : Math.max(note.t, vowelStart);
    const stop = i === notes.length - 1 ? vowelEnd : note.t + note.dur;
    if (stop - start < 0.02) continue;
    const prevMidi = i === 0 ? note.midi : notes[i - 1].midi;
    segs.push({
      ...segment(start, stop, note.midi, vowelPhone, phone2, gains, tier, i === 0 ? 0 : 0.05),
      midi0: prevMidi,
      diph0,
      diph1,
    });
  }
  phonemeRows.push({ phone: phones[v0], t: vowelStart, dur: Math.max(0.03, vowelEnd - vowelStart) });
  t = vowelEnd;
  coda.forEach((phone, index) => {
    const dur = codaD[index];
    if (dur < 0.012) return;
    segs.push(segment(t, t + dur, notes[notes.length - 1].midi, phone, null, gains, tier, 0));
    phonemeRows.push({ phone, t, dur });
    t += dur;
  });
  const label = item.syl.count > 1 ? `${item.syl.word}:${item.syl.index + 1}` : item.syl.word;
  return {
    segs,
    row: {
      t: round3(phonemeRows.length ? phonemeRows[0].t : beat),
      t1: round3(t),
      midi: notes[0].midi,
      syllable: label,
      word: item.syl.word,
      phones: phonemeRows.map((row) => row.phone),
      durations: phonemeRows.map((row) => round3(row.dur)),
      role: tier,
    },
    end: t,
  };
}

function segment(t0, t1, midi, phone, phone2, gains, tier, glide) {
  return {
    t0, t1, midi0: midi, midi1: midi, glide, phone: basePhone(phone), phone2, gains, tier, diph0: t0, diph1: t1,
  };
}

function chordStamp(chords, t) {
  const chord = chordAt(chords, t + 0.01);
  return chord ? chord.t0 : -1;
}

function mergeChoirHolds(group, chords) {
  const holds = [];
  let i = 0;
  while (i < group.length) {
    const first = group[i];
    const stamp = chordStamp(chords, first.t);
    let j = i + 1;
    let end = first.t + (first.dur || 0.2);
    while (j < group.length) {
      const next = group[j];
      if (next.t - end > 0.14) break;
      if (chordStamp(chords, next.t) !== stamp) break;
      const acc = end - first.t;
      const nextDur = next.dur || 0.2;
      if (acc >= 0.48 && nextDur >= 0.4) break;
      if (acc >= 1.3) break;
      end = next.t + nextDur;
      j += 1;
    }
    holds.push(group.slice(i, j));
    i = j;
  }
  return holds;
}

function pickChoirMidi(hold, prev, phraseStart, key, chords, bass, lead, loLead) {
  const t = hold[0].t;
  const end = hold[hold.length - 1].t + (hold[hold.length - 1].dur || 0.2);
  const dur = Math.max(0.05, end - t);
  const local = keyAt(key, t);
  const chord = chordAt(chords, t + 0.01);
  const pcs = soundingPcs(chord, bass, t, dur);
  const hi = Math.min(76, loLead - 3);
  const bad = (midi) => midi < 52 || midi > hi || semiClash(midi, pcs) || hitsLead(midi, t, dur, lead);
  const pool = [];
  const seen = new Set();
  const push = (midi) => {
    if (midi == null || seen.has(midi) || bad(midi)) return;
    seen.add(midi);
    pool.push(midi);
  };
  for (const note of hold) {
    for (const spec of [[-2, 4], [-5, 9]]) {
      const base = degreeShift(note.midi, local, spec[0], spec[1]);
      if (base == null) continue;
      for (let shift = -24; shift <= 24; shift += 12) push(fitUnder(base + shift, loLead));
    }
  }
  const scale = (SCALE[local.mode] || SCALE.major).map((semi) => (semi + local.pc) % 12);
  const chordPcs = new Set((chord?.notes || []).map(pcOf));
  for (let m = 52; m <= hi; m += 1) {
    const pc = pcOf(m);
    if (!scale.includes(pc) && !chordPcs.has(pc)) continue;
    push(m);
  }
  let choices = pool;
  if (prev != null && !phraseStart) {
    const near = pool.filter((midi) => Math.abs(midi - prev) <= 7);
    if (near.length) choices = near;
    else if (!bad(prev)) choices = [prev];
  }
  if (!choices.length) {
    const fallback = fitUnder(loLead - 4, loLead);
    if (fallback != null && !bad(fallback)) return fallback;
    return Math.max(52, Math.min(hi, loLead - 7));
  }
  return closest(prev == null ? loLead - 4 : prev, choices);
}

function addChoir(lead, covered, chords, bass, key, sections, style, duration) {
  const notes = [];
  const groups = [];
  let cur = [];
  const nameAt = (t) => sectionAt(sections, t)?.name || "";
  for (const note of lead) {
    if (note.t >= duration - 0.05) continue;
    if (overlapAmount(note, covered) > (note.dur || 0.2) * 0.45) {
      if (cur.length) groups.push(cur);
      cur = [];
      continue;
    }
    const voices = choirVoicesFor(nameAt(note.t));
    if (!voices) {
      if (cur.length) groups.push(cur);
      cur = [];
      continue;
    }
    if (!cur.length) {
      cur.push(note);
      continue;
    }
    const prev = cur[cur.length - 1];
    const gap = note.t - (prev.t + (prev.dur || 0.2));
    if (gap > 0.13 || nameAt(note.t) !== nameAt(prev.t)) {
      groups.push(cur);
      cur = [note];
    } else cur.push(note);
  }
  if (cur.length) groups.push(cur);
  const vowels = ["UW", "AA", "OW"];
  groups.forEach((group, index) => {
    const name = nameAt(group[0].t);
    const voices = choirVoicesFor(name);
    const tier = voices >= 3 ? "choir" : "light";
    const vowel = vowels[index % vowels.length];
    const onset = index % 3 === 2 ? "M" : index % 2 === 0 ? "W" : "HH";
    const gains = gainsFor(style, tier);
    const holds = mergeChoirHolds(group, chords);
    let prevMidi = notes.length ? notes[notes.length - 1].midi : null;
    holds.forEach((hold, i) => {
      const leadMidi = hold.reduce((min, note) => Math.min(min, note.midi), 120);
      const end = hold[hold.length - 1].t + (hold[hold.length - 1].dur || 0.2);
      const midi = pickChoirMidi(hold, prevMidi, i === 0, key, chords, bass, lead, leadMidi);
      prevMidi = midi;
      notes.push({
        t: round3(hold[0].t),
        midi,
        dur: round3(Math.min(Math.max(0.05, end - hold[0].t), Math.max(0.05, duration - hold[0].t))),
        strong: hold.some((note) => note.strong) || end - hold[0].t > 0.45,
        vowel,
        onset: i === 0 ? onset : "",
        section: name,
        voices,
        leadMidi,
        tier,
        phraseStart: i === 0,
      });
    });
    group.holdCount = holds.length;
    group.gains = gains;
    group.tier = tier;
    group.vowel = vowel;
    group.onset = onset;
  });
  const flags = screenChoir(notes, lead, chords, bass, key);
  const segs = [];
  const phonemes = [];
  let noteIndex = 0;
  for (const group of groups) {
    const slice = notes.slice(noteIndex, noteIndex + (group.holdCount || 0));
    noteIndex += group.holdCount || 0;
    let prevEnd = 0;
    slice.forEach((note, i) => {
      const isFirst = i === 0;
      const isLast = i === slice.length - 1;
      const onsetPhone = isFirst ? group.onset : "";
      const beat = note.t;
      let onsetDur = onsetPhone ? Math.min(consDur(onsetPhone) * 0.8, 0.06) : 0;
      const room = Math.max(0, beat - prevEnd);
      if (onsetDur > room) onsetDur = room > 0.015 ? room : 0;
      if (onsetDur >= 0.015) {
        segs.push(segment(beat - onsetDur, beat, note.midi, onsetPhone, null, group.gains, group.tier, 0));
      }
      const release = isLast
        ? Math.min(style === "ambient" ? 0.16 : 0.045, note.dur * (style === "ambient" ? 0.22 : 0.18))
        : 0;
      const prevMidi = i === 0 ? note.midi : slice[i - 1].midi;
      const vowelEnd = note.t + note.dur - release;
      if (vowelEnd - beat > 0.03) {
        segs.push({
          ...segment(beat, vowelEnd, note.midi, note.vowel, null, group.gains, group.tier, i === 0 ? 0 : 0.05),
          midi0: prevMidi,
          attack: style === "ambient" ? 0.14 : 0,
        });
      }
      const phones = [];
      const durations = [];
      if (onsetDur >= 0.015) {
        phones.push(onsetPhone);
        durations.push(round3(onsetDur));
      }
      phones.push(note.vowel);
      durations.push(round3(Math.max(0.03, vowelEnd - beat)));
      phonemes.push({
        t: round3(onsetDur >= 0.015 ? beat - onsetDur : beat),
        t1: round3(vowelEnd),
        midi: note.midi,
        syllable: note.vowel === "UW" ? "ooh" : note.vowel === "AA" ? "aah" : "oh",
        word: "",
        phones,
        durations,
        role: "choir",
      });
      prevEnd = vowelEnd;
      if (isLast) {
        const gapNote = lead.find((item) => item.t > note.t + note.dur - 0.02);
        const gap = gapNote ? gapNote.t - (note.t + note.dur) : 1;
        if (gap > 0.15) {
          const b0 = vowelEnd + 0.03;
          const b1 = b0 + 0.055;
          segs.push(segment(b0, b1, note.midi, "HH", null, group.gains.map((g) => g * 0.45), group.tier, 0));
        }
      }
    });
  }
  return { notes, segs, phonemes, flags };
}

export function planPerformance({
  lead = [],
  chords = [],
  bassline = [],
  key = { pc: 0, mode: "major" },
  sections = [],
  style = "ambient",
  duration = 0,
  lyrics = "",
  lyricsOn = false,
  oohaah = false,
}) {
  const safeStyle = STYLE_GAIN[style] ? style : "ambient";
  const text = lyricsOn ? String(lyrics || "") : "";
  const linesIn = lyricLines(text);
  const phrases = leadPhrases(lead, sections);
  const fitted = linesIn.length
    ? fitLyricsToPhrases(linesIn, phrases, sections, duration)
    : { lines: [], placed: [], syllables: 0, sung: 0, unsung: 0 };
  if (fitted.placed.length) lengthenStress(fitted.placed);
  const { lines, placed } = fitted;
  const { syllables, sung, unsung } = fitted;
  const events = [];
  const phonemes = [];
  const covered = [];
  let prevEnd = 0;
  // The lead often sits in D5-D6. A formant voice that high loses its vowels
  // (F0 above F1), so the singer takes the melody an octave down when the
  // sung notes are high, and the ducked lead instrument doubles it above.
  const noteList = (item) => (item.melisma && item.melisma.length ? item.melisma : [item.note]);
  const sungMidis = placed.flatMap(noteList).map((note) => note.midi).sort((a, b) => a - b);
  const medianMidi = sungMidis.length ? sungMidis[Math.floor(sungMidis.length / 2)] : 0;
  const wantShift = medianMidi >= 72 ? -12 : 0;
  // Close semitone rubs (a minor 2nd or minor 9th against a sounding chord
  // tone or the bass) that the octave drop would create. A line keeps the
  // lead's octave when dropping it would rub more.
  const harsh = (midi, t, dur) => {
    let count = 0;
    for (const probe of [t + 0.02, t + dur * 0.5]) {
      const chord = chordAt(chords, probe);
      for (const other of chord?.notes || []) {
        const gap = Math.abs(midi - other);
        if (gap === 1 || gap === 13) count += 1;
      }
    }
    for (const b of bassline || []) {
      const end = b.t + (b.dur || 0.2);
      if (b.t < t + dur - 0.03 && end > t + 0.03 && Math.abs(midi - b.midi) === 1) count += 1;
    }
    return count;
  };
  const lineShift = new Map();
  if (wantShift) {
    for (const li of new Set(placed.map((item) => item.line))) {
      const notesOf = placed.filter((item) => item.line === li).flatMap(noteList);
      const down = notesOf.reduce((sum, note) => sum + harsh(note.midi + wantShift, note.t, note.dur), 0);
      const same = notesOf.reduce((sum, note) => sum + harsh(note.midi, note.t, note.dur), 0);
      lineShift.set(li, down <= same ? wantShift : 0);
    }
  }
  let singerShift = 0;
  for (const itemIn of placed) {
    const shift = lineShift.get(itemIn.line) || 0;
    if (shift) singerShift = shift;
    const shiftNote = (note) => ({ ...note, midi: note.midi + shift });
    const item = shift
      ? {
        ...itemIn,
        note: shiftNote(itemIn.note),
        melisma: itemIn.melisma && itemIn.melisma.length ? itemIn.melisma.map(shiftNote) : itemIn.melisma,
      }
      : itemIn;
    const built = segmentsForSyllable(item, safeStyle, "singer", prevEnd);
    events.push(...built.segs);
    phonemes.push(built.row);
    covered.push([built.row.t, built.row.t1]);
    prevEnd = built.end;
  }
  let choir = [];
  let voiceClashes = [];
  if (oohaah && lead.length) {
    const planned = addChoir(lead, covered, chords, bassline, key, sections, safeStyle, duration);
    choir = planned.notes.map((note) => ({
      t: round3(note.t),
      midi: note.midi,
      dur: round3(note.dur),
      vowel: note.vowel,
      section: note.section,
      voices: note.voices,
    }));
    events.push(...planned.segs);
    phonemes.push(...planned.phonemes);
    voiceClashes = planned.flags;
  }
  events.sort((a, b) => a.t0 - b.t0);
  linkLegatoPitch(events);
  phonemes.sort((a, b) => a.t - b.t);
  const coverage = syllables ? Math.round(mergeCoverage(covered, duration) * 1000) / 10 : 0;
  const unsungPct = syllables ? Math.round((unsung / syllables) * 1000) / 10 : 0;
  return {
    coverage,
    unsungPct,
    syllables,
    sung,
    lines,
    choir,
    phonemes,
    events,
    voiceClashes,
    singerShift,
    duration,
  };
}

// A new syllable used to start on its own MIDI immediately. Legato notes
// (the next phone begins as the previous one ends) glide across 50 ms.
function linkLegatoPitch(events) {
  let prev = null;
  for (const seg of events) {
    if ((seg.tier || "singer") !== "singer") continue;
    if (prev && seg.t0 - prev.t1 <= 0.04 && seg.t0 >= prev.t1 - 0.02) {
      const still = (prev.glide || 0) > 0 && prev.midi0 !== prev.midi1 && prev.t0 + prev.glide > seg.t0 + 0.001;
      if (still && (seg.glide || 0) <= 0 && seg.midi1 === prev.midi1) {
        const elapsed = Math.max(0, seg.t0 - prev.t0);
        const gu = clamp(elapsed / prev.glide, 0, 1);
        const c = 0.5 - 0.5 * Math.cos(Math.PI * gu);
        seg.midi0 = prev.midi0 + (prev.midi1 - prev.midi0) * c;
        seg.glide = Math.max(0.01, prev.glide - elapsed);
      } else if ((seg.glide || 0) <= 0 && seg.midi1 !== prev.midi1) {
        seg.midi0 = prev.midi1;
        seg.glide = 0.05;
      }
    }
    prev = seg;
  }
}

function targetOf(phone) {
  const base = basePhone(phone);
  if (DIPH[base]) return VOWEL[DIPH[base][0]];
  if (VOWEL[base]) return VOWEL[base];
  if (CONS[base]) return CONS[base];
  return VOWEL.AH;
}

function mixTarget(phone, phone2, u) {
  const a = targetOf(phone);
  const b = phone2 ? targetOf(phone2) : null;
  if (!b) {
    return {
      ...a,
      f: a.f.slice(),
      b: a.b.slice(),
      parF: a.f[1],
      parB: Math.max(40, (a.b[1] || 80) * 0.8),
      parA: 0.22,
      ab: 0,
    };
  }
  const c = 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1));
  const f = a.f.map((value, i) => value + ((b.f[i] || value) - value) * c);
  const bw = a.b.map((value, i) => value + ((b.b[i] || value) - value) * c);
  return {
    ...a,
    f,
    b: bw,
    tilt: (a.tilt || 0.45) + ((b.tilt || 0.45) - (a.tilt || 0.45)) * c,
    av: 1,
    af: 0,
    ah: 0.035,
    nasal: 0,
    parF: f[1],
    parB: Math.max(40, (bw[1] || 80) * 0.8),
    parA: 0.22,
    ab: 0,
  };
}

function shapeConsonant(spec, u, dur) {
  const burst = STOPS.has(specName(spec)) || spec.stop || spec.affr;
  if (spec.stop || spec.affr) {
    const burstLen = spec.affr ? Math.min(0.045, dur * 0.55) : Math.min(0.016, dur * 0.4);
    const burstU = 1 - burstLen / Math.max(dur, 0.02);
    if (u < burstU) {
      return {
        ...spec,
        f: spec.voiced ? [180, 700, 1600, 2800, 3600] : [250, 800, 1600, 2400, 3200],
        b: spec.voiced ? [70, 140, 180, 220, 260] : [120, 180, 220, 260, 300],
        av: spec.voiced ? 0.32 : 0,
        af: 0,
        ah: 0,
        nasal: 0,
        parA: 0,
        ab: 0,
        kind: spec.voiced ? 0 : 0,
      };
    }
    const edge = clamp((u - burstU) / Math.max(0.001, 1 - burstU), 0, 1);
    const env = Math.sin(Math.PI * edge);
    return { ...spec, av: spec.voiced ? 0.25 : 0, af: env, ah: 0, nasal: 0, kind: 2, parA: (spec.parA || 0.5) * env, ab: (spec.ab || 0) * env };
  }
  if (spec.nasal) return { ...spec, kind: 1, av: spec.av || 0.85, af: 0 };
  if ((spec.af || 0) > 0.2 && (spec.av || 0) < 0.2) return { ...spec, kind: 2, av: 0 };
  return { ...spec, kind: (spec.af || 0) > 0.2 ? 2 : 0 };
}

function specName(spec) {
  return "";
}

function rawAt(seg, t) {
  const dur = Math.max(0.02, seg.t1 - seg.t0);
  const u = clamp((t - seg.t0) / dur, 0, 1);
  const base = basePhone(seg.phone);
  let spec;
  if (seg.phone2) {
    const du = clamp((t - (seg.diph0 || seg.t0)) / Math.max(0.05, (seg.diph1 || seg.t1) - (seg.diph0 || seg.t0)), 0, 1);
    spec = mixTarget(seg.phone, seg.phone2, du);
    spec.kind = 0;
    spec.av = 1;
    spec.af = 0;
    spec.ah = 0.04;
  } else if (VOWEL[base] || DIPH[base]) {
    spec = mixTarget(DIPH[base] ? DIPH[base][0] : base, DIPH[base] ? DIPH[base][1] : null, DIPH[base] ? u : 0);
    spec.kind = 0;
    spec.av = 1;
    spec.af = 0;
    spec.ah = 0.04;
  } else {
    const cons = CONS[base] || CONS.HH;
    spec = shapeConsonant({ ...cons, f: cons.f.slice(), b: cons.b.slice() }, u, dur);
    if (!spec.kind) spec.kind = spec.nasal ? 1 : (spec.af || 0) > 0.2 ? 2 : 0;
  }
  return spec;
}

function blendSpec(a, b, u) {
  if (!b) return a;
  const c = 0.5 - 0.5 * Math.cos(Math.PI * clamp(u, 0, 1));
  const f = a.f.map((value, i) => value + ((b.f[i] || value) - value) * c);
  const bw = (a.b || [80, 100, 130, 200, 250]).map((value, i) => value + (((b.b || a.b)[i] || value) - value) * c);
  return {
    ...a,
    f,
    b: bw,
    av: (a.av || 0) + ((b.av || 0) - (a.av || 0)) * c,
    af: (a.af || 0) + ((b.af || 0) - (a.af || 0)) * c,
    ah: (a.ah || 0) + ((b.ah || 0) - (a.ah || 0)) * c,
    nasal: (a.nasal || 0) + ((b.nasal || 0) - (a.nasal || 0)) * c,
    tilt: (a.tilt || 0.45) + ((b.tilt || 0.45) - (a.tilt || 0.45)) * c,
    fnp: (a.fnp || 300) + ((b.fnp || a.fnp || 300) - (a.fnp || 300)) * c,
    fnz: (a.fnz || 1200) + ((b.fnz || a.fnz || 1200) - (a.fnz || 1200)) * c,
    parF: (a.parF || 2000) + ((b.parF || a.parF || 2000) - (a.parF || 2000)) * c,
    parB: (a.parB || 400) + ((b.parB || a.parB || 400) - (a.parB || 400)) * c,
    parA: (a.parA || 0) + ((b.parA || 0) - (a.parA || 0)) * c,
    ab: (a.ab || 0) + ((b.ab || 0) - (a.ab || 0)) * c,
    kind: c < 0.55 ? a.kind || 0 : b.kind || 0,
  };
}

function pole(f, bw, mode) {
  const freq = clamp(f, 70, SR24 * 0.46);
  const width = clamp(bw, 25, 1800);
  const r = Math.exp((-Math.PI * width) / SR24);
  const w = (2 * Math.PI * freq) / SR24;
  const b1 = 2 * r * Math.cos(w);
  const b2 = -r * r;
  let a = 1 - b1 - b2;
  if (mode === "peak") {
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    const re = 1 - b1 * cw - b2 * c2;
    const im = b1 * sw + b2 * s2;
    a = Math.sqrt(re * re + im * im) || 1;
  }
  return [a, b1, b2];
}

function zero(f, bw) {
  const freq = clamp(f, 70, SR24 * 0.46);
  const width = clamp(bw, 40, 1800);
  const r = Math.exp((-Math.PI * width) / SR24);
  const c1 = -2 * r * Math.cos((2 * Math.PI * freq) / SR24);
  const c2 = r * r;
  const g = 1 + c1 + c2;
  const n = Math.abs(g) < 1e-3 ? 1 : g;
  return [1 / n, c1 / n, c2 / n];
}

function buildFrames(segments, t0, t1, formantScale, cents) {
  const total = Math.max(1, Math.round((t1 - t0) * SR24));
  const frames = [];
  let left = total;
  let sample = 0;
  let segIndex = 0;
  let f1Held = 0;
  while (left > 0) {
    const n = Math.min(HOP, left);
    const t = t0 + (sample + n * 0.5) * DT;
    while (segIndex < segments.length - 1 && t > segments[segIndex].t1) segIndex += 1;
    const seg = segments[Math.min(segIndex, segments.length - 1)];
    let spec = rawAt(seg, t);
    if ((seg.attack || 0) > 0.02 && t - seg.t0 < seg.attack) {
      const env = 0.5 - 0.5 * Math.cos((Math.PI * clamp((t - seg.t0) / seg.attack, 0, 1)));
      spec = { ...spec, av: (spec.av || 0) * env, ah: (spec.ah || 0) * env };
    }
    // Meet in the middle of the boundary. Blending all the way to the next
    // phone and then starting the next phone back at the previous one snaps
    // F2 by more than a kilohertz in one frame.
    const edge = 0.042;
    if (segIndex > 0 && t - seg.t0 < edge) {
      const u = 0.5 + 0.5 * clamp((t - seg.t0) / edge, 0, 1);
      spec = blendSpec(rawAt(segments[segIndex - 1], segments[segIndex - 1].t1 - 0.001), spec, u);
    } else if (segIndex + 1 < segments.length && seg.t1 - t < edge) {
      const u = 0.5 * clamp((edge - (seg.t1 - t)) / edge, 0, 1);
      spec = blendSpec(spec, rawAt(segments[segIndex + 1], segments[segIndex + 1].t0 + 0.001), u);
    }
    const scale = formantScale || 1;
    const f = spec.f.map((freq, i) => clamp(freq * (i < 3 ? scale : 1 + (scale - 1) * 0.6), 90, 5600));
    const local = t - seg.t0;
    const noteDur = seg.t1 - seg.t0;
    const depth = noteDur > 0.38 ? 0.4 * clamp((local - 0.2) / 0.16, 0, 1) : 0;
    const vib = Math.sin(2 * Math.PI * 5.5 * t);
    let midi = seg.midi1;
    if (seg.glide > 0 && seg.midi0 !== seg.midi1) {
      const gu = clamp((t - seg.t0) / seg.glide, 0, 1);
      const c = 0.5 - 0.5 * Math.cos(Math.PI * gu);
      midi = seg.midi0 + (seg.midi1 - seg.midi0) * c;
    }
    midi += (cents || 0) / 100 + depth * vib;
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    // Cascade F1 sits below the fundamental on high notes and mutes IY, IH, and UW.
    // Ease F1 up toward the fundamental so the note still speaks. The blend starts
    // only once F0 passes F1, and at 220 Hz every target F1 is still above that,
    // so the measured vowel envelopes stay put.
    if (seg.tier === "singer" && (spec.av || 0) > 0.4 && f[0]) {
      let desired = f[0];
      if (f0 > f[0]) {
        const u = clamp((f0 / f[0] - 1) / 0.15, 0, 1);
        const tracked = Math.min(f0 * 0.97, Math.max(f[0], f0 * 0.9));
        desired = f[0] + (tracked - f[0]) * u;
      }
      // A one-frame jump here is a click. Glide F1 over several frames.
      if (!f1Held) f1Held = desired;
      f1Held += clamp(desired - f1Held, -35, 35);
      f[0] = f1Held;
    }
    const c = new Float32Array(24);
    for (let i = 0; i < 5; i += 1) {
      const coef = pole(f[i], spec.b[i] || 150);
      c[i * 3] = coef[0];
      c[i * 3 + 1] = coef[1];
      c[i * 3 + 2] = coef[2];
    }
    const np = pole(spec.fnp || 300, spec.nasal ? 90 : 400, "peak");
    c[15] = np[0];
    c[16] = np[1];
    c[17] = np[2];
    const nz = zero(spec.fnz || 1400, spec.nasal ? 180 : 800);
    c[18] = nz[0];
    c[19] = nz[1];
    c[20] = nz[2];
    const pp = pole(spec.parF || 2000, spec.parB || 500, "peak");
    c[21] = pp[0];
    c[22] = pp[1];
    c[23] = pp[2];
    frames.push({
      n,
      f0,
      av: spec.av || 0,
      af: spec.af || 0,
      ah: spec.ah || 0,
      nasal: spec.nasal || 0,
      tilt: spec.tilt || 0.45,
      parA: spec.parA || 0,
      ab: spec.ab || 0,
      kind: spec.kind || 0,
      g: seg.gains,
      c,
    });
    sample += n;
    left -= n;
  }
  const fade = Math.min(Math.floor(total * 0.25), Math.round(0.006 * SR24));
  return { frames, total, fade };
}

function makeState(seed) {
  return {
    phase: 0,
    cycle: 1,
    jit: 0,
    shim: 1,
    s: (seed >>> 0) || 1,
    m1: [0, 0, 0, 0, 0, 0, 0],
    m2: [0, 0, 0, 0, 0, 0, 0],
    x1: 0,
    x2: 0,
    tilt: 0,
    held: 0,
    dc: 0,
    bp: 0,
  };
}

function noise(state) {
  let x = state.s >>> 0;
  x ^= (x << 13) >>> 0;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  x >>>= 0;
  state.s = x || 1;
  return x / 2147483648 - 1;
}

function resonate(state, index, x, c, o) {
  const y = c[o] * x + c[o + 1] * state.m1[index] + c[o + 2] * state.m2[index];
  state.m2[index] = state.m1[index];
  state.m1[index] = y;
  return y;
}

function renderMono(built, seed, voiceIndex) {
  const { frames, total, fade } = built;
  const out = new Float32Array(total);
  const state = makeState((seed + voiceIndex * 977) >>> 0);
  const oq = 0.5;
  let pos = 0;
  const OUT = 0.85;
  // Amplitudes move across the 5 ms frame. A step here is a click, especially
  // on the noise bypass that does not pass through a resonator.
  let prevAv = 0;
  let prevAf = 0;
  let prevAh = 0;
  let prevPar = 0;
  let prevAb = 0;
  let prevNasal = 0;
  const prevC = new Float32Array(24);
  const liveC = new Float32Array(24);
  const dC = new Float32Array(24);
  for (const frame of frames) {
    const c = frame.c;
    const g = frame.g[voiceIndex] || 0;
    const live = g > 0;
    const tgtAv = frame.av * g;
    // Consonant noise runs about 5 dB hotter than the Klatt table values so
    // S, T, K, CH and friends cut through a full mix (reviewer pass).
    const tgtAf = frame.af * g * CONS_BOOST;
    const tgtAh = frame.ah * g * 1.4;
    const tgtPar = live ? (frame.parA || 0) * CONS_BOOST : 0;
    const tgtAb = live ? (frame.ab || 0) * 1.5 : 0;
    const tgtNasal = live ? frame.nasal || 0 : 0;
    const quiet = !live
      && prevAv < 1e-5 && prevAf < 1e-5 && prevAh < 1e-5
      && prevPar < 1e-4 && prevAb < 1e-4 && prevNasal < 1e-4;
    if (quiet) {
      pos += frame.n;
      continue;
    }
    const n = frame.n;
    const dAv = tgtAv - prevAv;
    const dAf = tgtAf - prevAf;
    const dAh = tgtAh - prevAh;
    const dPar = tgtPar - prevPar;
    const dAb = tgtAb - prevAb;
    const dNasal = tgtNasal - prevNasal;
    let motion = 0;
    for (let k = 0; k < 24; k += 1) {
      dC[k] = c[k] - prevC[k];
      const ad = dC[k] < 0 ? -dC[k] : dC[k];
      if (ad > motion) motion = ad;
    }
    const moving = motion > 2e-4;
    if (!moving) liveC.set(c);
    for (let i = 0; i < n; i += 1) {
      const u = (i + 1) / n;
      const av = prevAv + dAv * u;
      const af = prevAf + dAf * u;
      const ah = prevAh + dAh * u;
      const parA = prevPar + dPar * u;
      const ab = prevAb + dAb * u;
      const nasal = prevNasal + dNasal * u;
      if (moving) {
        for (let k = 0; k < 24; k += 1) liveC[k] = prevC[k] + dC[k] * u;
      }
      let closure = 0;
      if (state.phase >= 1) {
        state.phase -= 1;
        state.cycle += 1;
        closure = 1;
        const h = hash01((seed + state.cycle * 13 + voiceIndex * 101) >>> 0);
        state.jit = (h - 0.5) * 0.007;
        state.shim = 1 + (hash01((seed + state.cycle * 29) >>> 0) - 0.5) * 0.045;
      }
      state.phase += frame.f0 * (1 + state.jit) * DT;
      const open = state.phase < oq;
      const xOpen = open ? state.phase / oq : 1;
      // Closure impulse (Klatt-style excitation) plus a short Rosenberg open phase.
      const rosen = open ? 6 * xOpen * (1 - xOpen) : 0;
      const pulse = closure * 0.9 + rosen * 0.2;
      const flow = open ? xOpen * xOpen * (3 - 2 * xOpen) : 0;
      const glot = pulse * state.shim * av;
      state.tilt += (glot - state.tilt) * frame.tilt;
      const nz = noise(state);
      const voiced = av > 0.02;
      let input = state.tilt + nz * ah * (0.35 + 0.65 * (voiced ? flow : 1));
      // Crossfade the nasal branch. A hard gate here clicks when M or N meets a vowel.
      {
        const yz = liveC[18] * input + liveC[19] * state.x1 + liveC[20] * state.x2;
        state.x2 = state.x1;
        state.x1 = input;
        const nasaled = resonate(state, 5, yz, liveC, 15);
        input += (nasaled - input) * nasal;
      }
      let y = input;
      for (let r = 0; r < 5; r += 1) y = resonate(state, r, y, liveC, r * 3);
      let fric = 0;
      if (af > 0.0004 || parA > 0.0004 || ab > 0.0004) {
        const mod = voiced ? 0.28 + 0.72 * flow : 1;
        const nsrc = nz * af * mod;
        const tiltShare = 1 / (1 + af * 16);
        const src = state.tilt * tiltShare + nsrc;
        state.bp += (nsrc * ab - state.bp) * 0.55;
        fric = resonate(state, 6, src, liveC, 21) * parA + state.bp;
      } else state.bp *= 0.9;
      let sample = (y + fric) * OUT;
      if ((pos & 1) === 0) state.held = sample;
      sample = sample * 0.84 + state.held * 0.16;
      state.dc += (sample - state.dc) * 0.015;
      sample -= state.dc;
      const lim = 0.16;
      if (sample > lim) sample = lim + Math.tanh(sample - lim) * 0.03;
      else if (sample < -lim) sample = -lim + Math.tanh(sample + lim) * 0.03;
      out[pos] = sample;
      pos += 1;
    }
    prevAv = tgtAv;
    prevAf = tgtAf;
    prevAh = tgtAh;
    prevPar = tgtPar;
    prevAb = tgtAb;
    prevNasal = tgtNasal;
    prevC.set(c);
  }
  if (fade > 1) {
    for (let i = 0; i < fade; i += 1) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
      out[i] *= w;
      out[total - 1 - i] *= w;
    }
  }
  return out;
}

function mixUp(mono, t0, L, R, pan) {
  const angle = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  const panL = Math.cos(angle);
  const panR = Math.sin(angle);
  const i0 = Math.round(t0 * SR);
  for (let i = 0; i < mono.length; i += 1) {
    const s0 = mono[i];
    const s1 = i + 1 < mono.length ? mono[i + 1] : s0;
    const a = i0 + i * 2;
    if (a >= 0 && a < L.length) {
      L[a] += s0 * panL;
      R[a] += s0 * panR;
    }
    const b = a + 1;
    if (b >= 0 && b < L.length) {
      const mid = (s0 + s1) * 0.5;
      L[b] += mid * panL;
      R[b] += mid * panR;
    }
  }
}

function groupSpans(events) {
  const spans = [];
  let cur = [];
  for (const event of events) {
    if (!(event.t1 > event.t0)) continue;
    if (!cur.length) {
      cur.push(event);
      continue;
    }
    const prev = cur[cur.length - 1];
    if (event.t0 - prev.t1 > 0.012) {
      spans.push(cur);
      cur = [event];
    } else cur.push(event);
  }
  if (cur.length) spans.push(cur);
  return spans;
}

export async function renderVoice(L, R, perf, seed, shouldStop) {
  const events = (perf && perf.events) || [];
  if (!events.length) return;
  const spans = groupSpans(events);
  for (let s = 0; s < spans.length; s += 1) {
    if (shouldStop && shouldStop()) {
      const err = new Error("Cancelled");
      err.cancelled = true;
      throw err;
    }
    const span = spans[s];
    const t0 = span[0].t0;
    const t1 = span[span.length - 1].t1;
    const active = [0, 1, 2].filter((voice) => span.some((seg) => seg.gains && seg.gains[voice] > 0));
    for (const voice of active) {
      const spec = CHOIR_VOICE[voice];
      const built = buildFrames(span, t0, t1, spec.scale, voice === 0 && active.length === 1 ? 0 : spec.cents);
      const mono = renderMono(built, seed >>> 0, voice, voice);
      mixUp(mono, t0, L, R, active.length === 1 ? 0 : spec.pan);
    }
    if ((s & 3) === 3) await new Promise((resolve) => setImmediate(resolve));
  }
}

export async function renderSustained(phone, midi, seconds, seed = 1) {
  const dur = Math.max(0.2, seconds);
  const n = Math.round((dur + 0.05) * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const base = basePhone(phone);
  const diph = DIPH[base];
  const perf = {
    events: [{
      t0: 0.03,
      t1: dur,
      midi0: midi,
      midi1: midi,
      glide: 0,
      phone: diph ? diph[0] : base,
      phone2: diph ? diph[1] : null,
      diph0: 0.03,
      diph1: dur,
      gains: [0.55, 0, 0],
      tier: "singer",
    }],
  };
  await renderVoice(L, R, perf, seed, null);
  return { L, R };
}

function writeWav(file, L, R) {
  const n = L.length;
  const buf = Buffer.allocUnsafe(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  let offset = 44;
  for (let i = 0; i < n; i += 1) {
    let l = L[i];
    let r = R[i];
    if (l > 1) l = 1;
    else if (l < -1) l = -1;
    if (r > 1) r = 1;
    else if (r < -1) r = -1;
    buf.writeInt16LE((l < 0 ? l * 32768 : l * 32767) | 0, offset);
    buf.writeInt16LE((r < 0 ? r * 32768 : r * 32767) | 0, offset + 2);
    offset += 4;
  }
  fs.writeFileSync(file, buf);
}

async function demo(outFile) {
  const syll = [...syllabify(pronounce("hello")), ...syllabify(pronounce("world"))];
  syll[0].word = "hello";
  syll[0].index = 0;
  syll[0].count = 2;
  syll[1].word = "hello";
  syll[1].index = 1;
  syll[1].count = 2;
  syll[2].word = "world";
  syll[2].index = 0;
  syll[2].count = 1;
  const notes = [
    { t: 0.35, midi: 60, dur: 0.42, strong: true },
    { t: 0.77, midi: 62, dur: 0.42, strong: false },
    { t: 1.19, midi: 64, dur: 0.42, strong: true },
    { t: 1.61, midi: 67, dur: 0.5, strong: false },
  ];
  const placed = [
    { syl: syll[0], note: notes[0] },
    { syl: syll[1], note: notes[1] },
    { syl: syll[2], note: { ...notes[2], dur: round3(notes[3].t + notes[3].dur - notes[2].t) }, melisma: [notes[2], notes[3]] },
  ];
  const events = [];
  let prev = 0;
  for (const item of placed) {
    const built = segmentsForSyllable(item, "ambient", "singer", prev);
    events.push(...built.segs);
    prev = built.end;
  }
  const n = Math.round(2.5 * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  await renderVoice(L, R, { events }, 0x71c0, null);
  writeWav(outFile, L, R);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked && process.argv[2] === "--test" && process.argv[3]) {
  demo(process.argv[3]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (invoked && process.argv[2] === "--vowel" && process.argv[3] && process.argv[4]) {
  const phone = process.argv[3].toUpperCase();
  const midi = Number(process.argv[5] || 57);
  const seconds = Number(process.argv[6] || 1);
  renderSustained(phone, midi, seconds, 3).then(({ L, R }) => writeWav(process.argv[4], L, R)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

function pathToFileURL(file) {
  const abs = path.resolve(file);
  return new URL(`file://${abs}`);
}
