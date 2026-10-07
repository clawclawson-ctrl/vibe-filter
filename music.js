// Generated music for a clip. The picture is reduced to brightness, color, saturation
// and motion; those pick one key, a diatonic chord rhythm, and how busy the notes are.
// Same clip and style always write the same WAV. Only Node and ffmpeg are used.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { playNote, bankReady, loadIr } from "./samples.js";
import {
  planSections,
  chooseProg,
  sectionChordIds,
  composeLines,
  walkBass,
  pulseBass,
  fixParallel,
  settleStrong,
  keepContour,
  smoothLeaps,
  clearClashes,
  sectionAt,
  glintTimes,
  keyAt,
} from "./arrange.js";
import { planPerformance, renderVoice } from "./voice.js";
import { buildGenome, dHashFrame, fingerprintOf, holdsFor, rngFor } from "./genome.js";
import { eqPair, chorusPair, widenPair, saturatePair, pingPongSend, decorrelate, addInto, gluePair } from "./mixbus.js";

const SR = 48000;
const TABLE = 4096;

// Raw analysis numbers from an 8 fps postcard-sized frame sit in a narrow band.
// These map that band onto 0..1 so a calm clip and a busy one land apart.
const MOTION_LO = 0.012;
const MOTION_HI = 0.14;
const SAT_LO = 0.06;
const SAT_HI = 0.42;

const SAW_SOFT = buildWave((k) => Math.exp(-k / 8) / k);
const SAW_BRIGHT = buildWave((k) => Math.exp(-k / 20) / k);
const SQUARE_SOFT = buildWave((k) => (k % 2 ? Math.exp(-k / 6) / k : 0));
const TRI = buildWave((k) => (k % 2 ? 1 / (k * k) : 0));
const SINE = buildWave((k) => (k === 1 ? 1 : 0));

function buildWave(harmonicAmp) {
  const table = new Float32Array(TABLE + 1);
  for (let k = 1; k <= 48; k += 1) {
    const amp = harmonicAmp(k);
    if (amp < 1e-5) continue;
    const step = (2 * Math.PI * k) / TABLE;
    for (let i = 0; i < TABLE; i += 1) table[i] += amp * Math.sin(step * i);
  }
  let peak = 0;
  for (let i = 0; i < TABLE; i += 1) peak = Math.max(peak, Math.abs(table[i]));
  const gain = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < TABLE; i += 1) table[i] *= gain;
  table[TABLE] = table[0];
  return table;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashNoise(i) {
  let x = Math.imul(i + 1, 747796405) + 2891336453;
  x = Math.imul(x ^ (x >>> 16), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  x ^= x >>> 16;
  return ((x >>> 0) / 4294967296) * 2 - 1;
}

function midiFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function normMotion(m) {
  return clamp((m - MOTION_LO) / (MOTION_HI - MOTION_LO), 0, 1);
}

function normSat(s) {
  return clamp((s - SAT_LO) / (SAT_HI - SAT_LO), 0, 1);
}

function panGains(pan) {
  const angle = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  return [Math.cos(angle), Math.sin(angle)];
}

// --- picture analysis -------------------------------------------------------

const FRAME_W = 64;
const FRAME_H = 36;
const FRAME_BYTES = FRAME_W * FRAME_H * 3;
const ANALYZE_FPS = 8;

function measureFrame(frame, prev) {
  const n = FRAME_W * FRAME_H;
  let bright = 0;
  let sat = 0;
  let warm = 0;
  let hx = 0;
  let hy = 0;
  let hueW = 0;
  let motion = 0;
  for (let i = 0, p = 0; i < n; i += 1, p += 3) {
    const r = frame[p] * (1 / 255);
    const g = frame[p + 1] * (1 / 255);
    const b = frame[p + 2] * (1 / 255);
    bright += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    warm += r - b;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const c = mx - mn;
    sat += mx > 1e-5 ? c / mx : 0;
    if (c > 0.08) {
      let h;
      if (mx === r) h = ((g - b) / c) % 6;
      else if (mx === g) h = (b - r) / c + 2;
      else h = (r - g) / c + 4;
      if (h < 0) h += 6;
      const ang = h * (Math.PI / 3);
      hx += Math.cos(ang) * c;
      hy += Math.sin(ang) * c;
      hueW += c;
    }
    if (prev) {
      motion += Math.abs(frame[p] - prev[p]) + Math.abs(frame[p + 1] - prev[p + 1]) + Math.abs(frame[p + 2] - prev[p + 2]);
    }
  }
  return {
    brightness: bright / n,
    saturation: sat / n,
    warmth: warm / n,
    hue: hueW > 0 ? Math.atan2(hy, hx) * (180 / Math.PI) : 0,
    motion: prev ? motion / (n * 255 * 3) : 0,
  };
}

function smoothFrames(raw) {
  const radius = 3;
  const keys = ["brightness", "saturation", "warmth", "motion"];
  return raw.map((frame, i) => {
    const out = { hue: frame.hue, rawMotion: frame.motion };
    for (const key of keys) {
      let sum = 0;
      let count = 0;
      for (let j = i - radius; j <= i + radius; j += 1) {
        if (j < 0 || j >= raw.length) continue;
        sum += raw[j][key];
        count += 1;
      }
      out[key] = sum / count;
    }
    return out;
  });
}

function detectCuts(frames) {
  const sorted = frames.map((f) => f.rawMotion).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const cuts = [];
  for (let i = 1; i < frames.length - 1; i += 1) {
    const m = frames[i].rawMotion;
    if (m < 0.1) continue;
    if (m < median * 2.7 && m < 0.26) continue;
    if (m < frames[i - 1].rawMotion || m < frames[i + 1].rawMotion) continue;
    const t = i / ANALYZE_FPS;
    if (cuts.length && t - cuts[cuts.length - 1] < 0.5) continue;
    cuts.push(t);
  }
  return cuts;
}

function detectShifts(frames, cuts) {
  const half = 4;
  const shifts = cuts.slice();
  for (let i = half; i < frames.length; i += 1) {
    const a = frames[i];
    const b = frames[i - half];
    if (
      Math.abs(a.brightness - b.brightness) > 0.08 ||
      Math.abs(a.warmth - b.warmth) > 0.055 ||
      Math.abs(a.saturation - b.saturation) > 0.1
    ) {
      shifts.push(i / ANALYZE_FPS);
    }
  }
  shifts.sort((a, b) => a - b);
  const out = [];
  for (const t of shifts) {
    if (!out.length || t - out[out.length - 1] > 0.4) out.push(t);
  }
  return out;
}

function meanOf(frames, key) {
  if (!frames.length) return 0;
  let sum = 0;
  for (const frame of frames) sum += frame[key];
  return sum / frames.length;
}

// ss/t match the render's input trim (both omitted means the whole file).
export function analyzeClip({ ffmpeg, file, ss = 0, t = 0, length, onSpawn }) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-nostdin", "-hide_banner"];
    if (ss > 0) args.push("-ss", ss.toFixed(3));
    if (t > 0) args.push("-t", t.toFixed(3));
    args.push(
      "-i", file,
      "-an",
      "-vf", `fps=${ANALYZE_FPS},scale=${FRAME_W}:${FRAME_H}:flags=bilinear`,
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "pipe:1",
    );
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    if (onSpawn) onSpawn(child);
    const raw = [];
    const hashes = [];
    const prev = Buffer.alloc(FRAME_BYTES);
    let hasPrev = false;
    let buf = Buffer.alloc(0);
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= FRAME_BYTES) {
        const frame = buf.subarray(0, FRAME_BYTES);
        buf = buf.subarray(FRAME_BYTES);
        raw.push(measureFrame(frame, hasPrev ? prev : null));
        hashes.push(dHashFrame(frame, FRAME_W, FRAME_H));
        frame.copy(prev);
        hasPrev = true;
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (err) => {
      if (onSpawn) onSpawn(null);
      reject(err);
    });
    child.on("close", (code) => {
      if (onSpawn) onSpawn(null);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "Could not read the picture"));
        return;
      }
      if (!raw.length) {
        reject(new Error("Could not read the picture"));
        return;
      }
      const frames = smoothFrames(raw);
      const cuts = detectCuts(frames);
      const duration = length > 0 ? length : frames.length / ANALYZE_FPS;
      resolve({
        fps: ANALYZE_FPS,
        duration,
        frames,
        hashes,
        cuts,
        shifts: detectShifts(frames, cuts),
        mean: {
          brightness: meanOf(frames, "brightness"),
          saturation: meanOf(frames, "saturation"),
          warmth: meanOf(frames, "warmth"),
          motion: meanOf(frames, "motion"),
          hue: meanOf(raw, "hue"),
        },
      });
    });
  });
}

function frameAt(analysis, t) {
  const frames = analysis.frames;
  if (!frames.length) return { brightness: 0.4, saturation: 0.2, warmth: 0, motion: 0, rawMotion: 0 };
  const x = clamp(t, 0, analysis.duration) * analysis.fps;
  const i = clamp(Math.round(x), 0, frames.length - 1);
  return frames[i];
}

function regionMean(analysis, t0, t1, key) {
  const frames = analysis.frames;
  if (!frames.length) return 0;
  const a = clamp(Math.floor(t0 * analysis.fps), 0, frames.length - 1);
  const b = clamp(Math.ceil(t1 * analysis.fps), a, frames.length - 1);
  let sum = 0;
  let count = 0;
  for (let i = a; i <= b; i += 1) {
    sum += frames[i][key];
    count += 1;
  }
  return sum / count;
}

// --- harmony ----------------------------------------------------------------

// Semitone sets are measured from the tonic. The last interval is the 9th (or #11).
function chordDef(root, quality, symbol, bassSemi) {
  const rel = {
    maj9: [0, 4, 7, 11, 14],
    min9: [0, 3, 7, 10, 14],
    dom13: [0, 4, 10, 14, 21, 7],
    dom7: [0, 4, 7, 10, 14],
    min7: [0, 3, 7, 10, 14],
    hdim: [0, 3, 6, 10, 14],
    dim7: [0, 3, 6, 9],
    sus13: [0, 5, 7, 10, 14, 21],
  }[quality];
  const def = { root, semis: rel.map((n) => root + n), symbol };
  if (bassSemi != null) def.bassSemi = bassSemi;
  return def;
}

const CHORDS = {
  major: {
    I: { root: 0, semis: [0, 4, 7, 11, 14], symbol: "maj7" },
    ii: { root: 2, semis: [2, 5, 9, 12, 16], symbol: "m9" },
    iii: { root: 4, semis: [4, 7, 11, 14, 17], symbol: "m7" },
    IV: { root: 5, semis: [5, 9, 12, 16, 19], symbol: "maj7" },
    V: { root: 7, semis: [7, 11, 17, 21, 28, 14], symbol: "13" },
    vi: { root: 9, semis: [9, 12, 16, 23, 19], symbol: "m9" },
    vii: chordDef(11, "hdim", "m7b5"),
    III7: chordDef(4, "dom7", "7"),
    "V/V": chordDef(2, "dom7", "7", 6),
    "V/ii": chordDef(9, "dom7", "7"),
    Vsus: chordDef(7, "sus13", "13sus"),
    v: chordDef(7, "min7", "m7"),
    iv: chordDef(5, "min7", "m7"),
    bVII: chordDef(10, "maj9", "maj7"),
    bVI: chordDef(8, "maj9", "maj7"),
    bIII: chordDef(3, "maj9", "maj7"),
    bII: chordDef(1, "maj9", "maj7"),
  },
  lydian: {
    I: { root: 0, semis: [0, 4, 11, 18, 14], symbol: "maj7" },
    II: { root: 2, semis: [2, 6, 9, 13, 16], symbol: "maj7" },
    iii: { root: 4, semis: [4, 7, 11, 14, 17], symbol: "m7" },
    V: { root: 7, semis: [7, 11, 17, 21, 14], symbol: "13" },
    vi: { root: 9, semis: [9, 12, 16, 23, 19], symbol: "m9" },
    vii: chordDef(11, "min7", "m7"),
    IV: chordDef(5, "maj9", "maj7"),
    Vsus: chordDef(7, "sus13", "9sus"),
    "V/V": chordDef(2, "dom7", "7"),
    iv: chordDef(5, "min7", "m7"),
    bVII: chordDef(10, "maj9", "maj7"),
    bVI: chordDef(8, "maj9", "maj7"),
    bIII: chordDef(3, "maj9", "maj7"),
  },
  mixolydian: {
    I: chordDef(0, "maj9", "maj7"),
    ii: chordDef(2, "min9", "m9"),
    iii: chordDef(4, "min7", "m7"),
    IV: chordDef(5, "maj9", "maj7"),
    v: chordDef(7, "min7", "m7"),
    vi: chordDef(9, "min9", "m9"),
    bVII: chordDef(10, "maj9", "maj7"),
    Vsus: chordDef(7, "sus13", "13sus"),
    "V/V": chordDef(2, "dom7", "7"),
    iv: chordDef(5, "min7", "m7"),
    bVI: chordDef(8, "maj9", "maj7"),
    bIII: chordDef(3, "maj9", "maj7"),
    bII: chordDef(1, "maj9", "maj7"),
  },
  dorian: {
    i: { root: 0, semis: [0, 3, 7, 10, 14], symbol: "m9" },
    ii: { root: 2, semis: [2, 5, 9, 12, 16], symbol: "m9" },
    bIII: { root: 3, semis: [3, 7, 10, 14, 17], symbol: "maj7" },
    IV: { root: 5, semis: [5, 9, 12, 16, 19], symbol: "maj7" },
    v: { root: 7, semis: [7, 10, 14, 17, 21], symbol: "m7" },
    bVII: { root: 10, semis: [10, 14, 17, 21, 24], symbol: "maj7" },
    vi: chordDef(9, "min7", "m7"),
    bVI: chordDef(8, "maj9", "maj7"),
    bII: chordDef(1, "maj9", "maj7"),
    iv: chordDef(5, "min7", "m7"),
  },
  minor: {
    i: { root: 0, semis: [0, 3, 7, 10, 14], symbol: "m9" },
    ii: chordDef(2, "hdim", "m7b5"),
    bIII: { root: 3, semis: [3, 7, 10, 14, 17], symbol: "maj7" },
    iv: { root: 5, semis: [5, 8, 12, 15, 19], symbol: "m7" },
    v: { root: 7, semis: [7, 10, 14, 17, 21], symbol: "m7" },
    V: { root: 7, semis: [7, 11, 14, 17, 21], symbol: "7" },
    VI: { root: 8, semis: [8, 12, 15, 19, 22], symbol: "maj7" },
    bVI: { root: 8, semis: [8, 12, 15, 19, 22], symbol: "maj7" },
    bVII: { root: 10, semis: [10, 14, 17, 21, 24], symbol: "maj7" },
    bII: chordDef(1, "maj9", "maj7"),
    IV: chordDef(5, "maj9", "maj7"),
    I: chordDef(0, "maj9", "maj7"),
    "V/V": chordDef(2, "dom7", "7"),
    Vsus: chordDef(7, "sus13", "13sus"),
  },
  phrygian: {
    i: chordDef(0, "min9", "m9"),
    bII: chordDef(1, "maj9", "maj7"),
    bIII: chordDef(3, "maj9", "maj7"),
    iv: chordDef(5, "min7", "m7"),
    v: chordDef(7, "min7", "m7"),
    bVI: chordDef(8, "maj9", "maj7"),
    bVII: chordDef(10, "maj9", "maj7"),
    Vsus: chordDef(7, "sus13", "13sus"),
  },
  harmonicMinor: {
    i: chordDef(0, "min9", "m9"),
    ii: chordDef(2, "hdim", "m7b5"),
    bIII: chordDef(3, "maj9", "maj7"),
    iv: chordDef(5, "min7", "m7"),
    v: chordDef(7, "min7", "m7"),
    V: chordDef(7, "dom7", "7"),
    V7: chordDef(7, "dom7", "7"),
    VI: chordDef(8, "maj9", "maj7"),
    bVI: chordDef(8, "maj9", "maj7"),
    bVII: chordDef(10, "maj9", "maj7"),
    bII: chordDef(1, "maj9", "maj7"),
    viio: chordDef(11, "dim7", "dim7"),
    Vsus: chordDef(7, "sus13", "13sus"),
    "V/V": chordDef(2, "dom7", "7"),
  },
};

// A few whole loops per mood. The clip picks one; it does not walk chord to chord.
// Later entries are the more extended, colorful loops.
const LOOPS = {
  major: {
    bright: [
      ["I", "V", "vi", "IV"],
      ["ii", "V", "I", "vi"],
      ["IV", "iii", "vi", "V"],
    ],
    dark: [
      ["vi", "IV", "I", "V"],
      ["ii", "V", "vi", "IV"],
      ["vi", "ii", "V", "I"],
    ],
  },
  lydian: {
    bright: [
      ["I", "II", "V", "vi"],
      ["I", "V", "II", "vi"],
    ],
    dark: [
      ["vi", "II", "V", "I"],
      ["vi", "V", "II", "I"],
    ],
  },
  dorian: {
    bright: [
      ["i", "IV", "bVII", "IV"],
      ["i", "bVII", "IV", "i"],
    ],
    dark: [
      ["i", "bVII", "ii", "v"],
      ["i", "ii", "bVII", "IV"],
    ],
  },
  minor: {
    bright: [
      ["i", "VI", "bIII", "bVII"],
      ["i", "bVII", "bIII", "VI"],
    ],
    dark: [
      ["i", "iv", "bVII", "bIII"],
      ["i", "bVII", "VI", "V"],
    ],
  },
};

const BRIGHTEN = { vi: "I", ii: "IV", iii: "V", i: "bIII", iv: "VI", v: "V" };
const DARKEN = { I: "vi", IV: "ii", V: "vi", II: "vi", bIII: "i", VI: "iv", bVII: "i" };

const PENTA = {
  major: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 9],
  mixolydian: [0, 2, 4, 7, 10],
  dorian: [0, 3, 5, 7, 10],
  minor: [0, 3, 5, 7, 10],
  phrygian: [0, 1, 5, 7, 10],
  harmonicMinor: [0, 3, 5, 7, 11],
};

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const CHORD_SYMBOLS = {
  I: "maj7", ii: "m9", iii: "m7", IV: "maj7", V: "13", vi: "m9",
  II: "maj7", i: "m9", iv: "m7", v: "m7", bIII: "maj7", bVII: "maj7",
  VI: "maj7", bVI: "maj7", bII: "maj7", vii: "m7b5", viio: "dim7",
  V7: "7", III7: "7", Vsus: "13sus",
};

function ensureColorChords() {
  const add = (mode, id, def) => {
    if (!CHORDS[mode][id]) CHORDS[mode][id] = def;
  };
  for (const mode of Object.keys(CHORDS)) {
    for (const [id, symbol] of Object.entries(CHORD_SYMBOLS)) {
      if (CHORDS[mode][id] && !CHORDS[mode][id].symbol) CHORDS[mode][id].symbol = symbol;
    }
  }
  add("major", "iv", { root: 5, semis: [5, 8, 12, 15, 19], symbol: "m7" });
  add("major", "bVII", { root: 10, semis: [10, 14, 17, 21, 24], symbol: "maj7" });
  add("major", "bVI", { root: 8, semis: [8, 12, 15, 19, 22], symbol: "maj7" });
  add("major", "V/ii", { root: 9, semis: [9, 13, 16, 19, 23], symbol: "7" });
  add("major", "V/V", { root: 2, semis: [2, 6, 9, 12, 16], symbol: "7", bassSemi: 6 });
  add("major", "Vsus", { root: 7, semis: [7, 9, 14, 17, 21, 28], symbol: "13sus" });
  add("minor", "V/V", { root: 2, semis: [2, 6, 9, 12, 16], symbol: "7" });
  add("lydian", "Vsus", { root: 7, semis: [7, 9, 14, 17, 21], symbol: "9sus" });
}
ensureColorChords();

function spellPc(pc, flat) {
  return (flat ? FLAT_NAMES : SHARP_NAMES)[pcOf(pc)];
}

function preferFlat(pc) {
  return [1, 3, 5, 6, 8, 10].includes(pcOf(pc));
}

function nameMatches(name, notes, rootPc) {
  const have = new Set(notes.map((midi) => (pcOf(midi) - rootPc + 12) % 12));
  const has = (...semis) => semis.every((semi) => have.has(semi));
  const minorThird = has(3) && !has(4);
  if (name.includes("6/9")) return has(4, 9, 2) && !has(11) && !minorThird;
  if (name.includes("add9")) return has(4, 2) && !has(11) && !minorThird;
  if (name.endsWith("maj7")) return has(4, 11) && !minorThird;
  if (name.endsWith("m9")) return has(3, 10, 2);
  if (name.endsWith("m7")) return has(3, 10);
  if (name.includes("13")) return has(4, 10, 9);
  if (/m$/.test(name) || name.includes("madd9")) return has(3);
  if (minorThird) return false;
  return true;
}

function honestSymbol(notes, rootPc) {
  const have = new Set(notes.map((midi) => (pcOf(midi) - rootPc + 12) % 12));
  const has = (...semis) => semis.every((semi) => have.has(semi));
  if (has(3, 10, 2)) return "m9";
  if (has(3, 10)) return "m7";
  if (has(4, 11)) return "maj7";
  if (has(4, 10, 9)) return "13";
  if (has(4, 10)) return "7";
  if (has(4, 9, 2)) return "6/9";
  if (has(4, 2)) return "add9";
  if (has(3, 2)) return "madd9";
  if (has(4, 9) && !has(10) && !has(11)) return "6";
  if (has(2) && !has(3) && !has(4)) return "sus2";
  if (has(9) && !has(3) && !has(4)) return "6";
  if (has(3)) return "m";
  return "";
}

function chordLabel(key, id) {
  const def = CHORDS[key.mode][id];
  if (!def) return id;
  const flat = id.startsWith("b") || preferFlat(key.pc);
  const root = spellPc(key.pc + def.root, flat);
  let name = `${root}${def.symbol || ""}`;
  if (def.bassSemi != null) name += `/${spellPc(key.pc + def.bassSemi, flat)}`;
  return name;
}

function chooseKey(mean) {
  const hueWarm = Math.cos(mean.hue * (Math.PI / 180));
  const warmth = mean.warmth + hueWarm * mean.saturation * 0.15;
  const bright = mean.brightness;
  if (mean.saturation < 0.08) {
    return bright >= 0.42
      ? { pc: 0, mode: "major", name: "C major" }
      : { pc: 9, mode: "minor", name: "A minor" };
  }
  if (warmth >= 0.045) {
    return bright >= 0.46
      ? { pc: 2, mode: "lydian", name: "D Lydian" }
      : { pc: 2, mode: "major", name: "D major" };
  }
  if (warmth <= -0.02) {
    return bright >= 0.4
      ? { pc: 9, mode: "dorian", name: "A Dorian" }
      : { pc: 9, mode: "minor", name: "A minor" };
  }
  if (warmth > 0.01) {
    return bright >= 0.38
      ? { pc: 7, mode: "major", name: "G major" }
      : { pc: 2, mode: "major", name: "D major" };
  }
  return bright >= 0.45
    ? { pc: 0, mode: "major", name: "C major" }
    : { pc: 9, mode: "minor", name: "A minor" };
}

function chooseTempo(style, motion) {
  if (style === "synthwave") return clamp(Math.round(85 + 25 * motion), 85, 110);
  if (style === "lofi") return Math.round(75 + 10 * motion);
  if (style === "arp") return Math.round(64 + 10 * motion);
  return Math.round(62 + 16 * motion);
}

// Ambient's bar length follows how busy the picture is: a calm clip holds a
// chord for about 8 s, a cut-heavy one for about 4 s. That length is also two
// bars, so a change is never quicker than two bars and never later than 8 s.
function ambientClock(analysis) {
  const motion = normMotion(analysis.mean.motion);
  const cutRate = analysis.cuts.length / Math.max(analysis.duration, 1);
  const activity = clamp(motion * 0.65 + Math.min(1, cutRate * 2.4) * 0.8, 0, 1);
  const twoBars = 8 - activity * 4;
  const bpm = Math.round((8 * 60) / twoBars);
  return { twoBars, bpm, motion };
}

function chordTimes(analysis, style, motion) {
  const duration = analysis.duration;
  const times = [0];
  if (style !== "ambient") {
    const bpm = chooseTempo(style, motion);
    const twoBars = (8 * 60) / bpm;
    let t = 0;
    while (t + twoBars <= duration - 0.55) {
      t += twoBars;
      times.push(t);
    }
    times.push(duration);
    return { bpm, times };
  }
  const clock = ambientClock(analysis);
  const events = analysis.shifts.length ? analysis.shifts : analysis.cuts;
  let t = 0;
  while (t + clock.twoBars <= duration - 0.55) {
    const grid = t + clock.twoBars;
    let next = grid;
    let bestD = 0.45;
    for (const ev of events) {
      const d = Math.abs(ev - grid);
      if (d < bestD && ev >= t + clock.twoBars * 0.85 && ev <= t + 8) {
        bestD = d;
        next = ev;
      }
    }
    if (next - t < clock.twoBars * 0.8 || next > duration - 0.55) break;
    times.push(next);
    t = next;
  }
  times.push(duration);
  return { bpm: clock.bpm, times };
}

function pickLoop(mode, mean) {
  const family = mean.brightness >= 0.4 ? "bright" : "dark";
  const loops = LOOPS[mode][family];
  const sat = normSat(mean.saturation);
  const idx = Math.min(loops.length - 1, Math.round(sat * (loops.length - 1)));
  return loops[idx];
}

// A very bright or very dark shot may swap one chord for its relative.
// The rest of the loop stays put, so the progression still has a destination.
function tintChord(dict, id, bright) {
  if (bright >= 0.62 && BRIGHTEN[id] && dict[BRIGHTEN[id]]) return BRIGHTEN[id];
  if (bright <= 0.2 && DARKEN[id] && dict[DARKEN[id]]) return DARKEN[id];
  return id;
}

const PAD_RANGES = [
  [40, 52],
  [48, 58],
  [54, 63],
  [58, 66],
  [62, 68],
];

const LOFI_RANGES = [
  [48, 57],
  [52, 60],
  [55, 64],
  [58, 66],
  [60, 67],
];

function pcOf(midi) {
  return ((midi % 12) + 12) % 12;
}

function nearestPc(pc, target, lo, hi) {
  const want = pcOf(pc);
  let best = null;
  let bestD = 1e9;
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  for (let m = a; m <= b; m += 1) {
    if (pcOf(m) !== want) continue;
    const d = Math.abs(m - target);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

function voiceChord(chord, tonicPc, prev, count, style) {
  const ranges = style === "lofi" ? LOFI_RANGES : PAD_RANGES;
  const pcs = [...new Set(chord.semis.map((semi) => pcOf(tonicPc + semi)))];
  const rootPc = pcOf(tonicPc + chord.root);
  const color = pcs.filter((pc) => pc !== rootPc);
  const rhodes = style === "lofi" && color.length >= 3 ? color : pcs;
  const candidates = [];
  for (let v = 0; v < count; v += 1) {
    const [lo, hi] = ranges[v];
    const center = prev && prev[v] != null ? prev[v] : (lo + hi) / 2;
    const allowed = style === "lofi" ? rhodes : (v === 0 ? [rootPc] : pcs);
    const opts = [];
    for (const pc of allowed) {
      for (let m = Math.round(center) - 8; m <= Math.round(center) + 8; m += 1) {
        if (m < lo || m > hi || pcOf(m) !== pc) continue;
        const dist = prev && prev[v] != null ? Math.abs(m - prev[v]) : Math.abs(m - center) * 0.2;
        opts.push({ m, dist });
      }
    }
    if (!opts.length) {
      const fallback = nearestPc(allowed[Math.min(v, allowed.length - 1)], center, lo, hi);
      opts.push({ m: fallback == null ? Math.round((lo + hi) / 2) : fallback, dist: 5 });
    }
    opts.sort((a, b) => a.dist - b.dist);
    candidates.push(opts.slice(0, 4));
  }

  let best = null;
  let bestCost = 1e9;
  const chosen = [];
  const walk = (index, cost) => {
    if (cost >= bestCost) return;
    if (index === count) {
      let c = cost;
      for (let i = 1; i < chosen.length; i += 1) {
        if (chosen[i] < chosen[0]) c += 4;
        for (let j = 0; j < i; j += 1) {
          const gap = Math.abs(chosen[i] - chosen[j]);
          if (gap === 0) c += 3;
          else if (gap === 1) c += 1.4;
          else if (gap > 16 && j > 0) c += 0.6;
        }
      }
      if (c < bestCost) {
        bestCost = c;
        best = chosen.slice();
      }
      return;
    }
    for (const opt of candidates[index]) {
      chosen.push(opt.m);
      walk(index + 1, cost + opt.dist);
      chosen.pop();
    }
  };
  walk(0, 0);

  if (prev) {
    for (let i = 1; i < best.length && i < prev.length; i += 1) {
      const leap = best[i] - prev[i];
      if (Math.abs(leap) <= 7) continue;
      const alt = leap > 0 ? best[i] - 12 : best[i] + 12;
      const [lo, hi] = ranges[i];
      if (alt >= lo && alt <= hi && Math.abs(alt - prev[i]) < Math.abs(leap)) best[i] = alt;
    }
  }
  return best;
}

function placePc(pc, target, lo, hi) {
  let best = null;
  let bestD = 1e9;
  for (let midi = Math.ceil(lo); midi <= Math.floor(hi); midi += 1) {
    if (pcOf(midi) !== pc) continue;
    const dist = Math.abs(midi - target);
    if (dist < bestD) {
      bestD = dist;
      best = midi;
    }
  }
  return best;
}

function foldPc(midi, lo, hi) {
  let m = Math.round(midi);
  let guard = 0;
  while (m > hi && guard < 6) {
    m -= 12;
    guard += 1;
  }
  while (m < lo && guard < 12) {
    m += 12;
    guard += 1;
  }
  if (m < lo || m > hi) return null;
  return m;
}

function paintColor(notes, def, tonicPc, prev, style) {
  const ranges = style === "lofi" ? LOFI_RANGES : PAD_RANGES;
  const spanLo = ranges[0][0];
  const spanHi = ranges[ranges.length - 1][1];
  const rel = def.semis.map((semi) => ((semi - def.root) % 12 + 12) % 12);
  const rootPc = pcOf(tonicPc + def.root);
  const need = [2, 3, 4, 6, 9, 10, 11].filter((semi) => rel.includes(semi)).map((semi) => pcOf(rootPc + semi));
  const chordPcs = [...new Set(def.semis.map((semi) => pcOf(tonicPc + semi)))];
  const voiced = [];
  for (const midi of notes) {
    const folded = foldPc(midi, spanLo, spanHi);
    if (folded != null) voiced.push(folded);
  }
  if (!voiced.length) return notes.slice();
  const count = (pc) => voiced.filter((midi) => pcOf(midi) === pc).length;
  const placeFresh = (pc, target) => {
    let best = null;
    let bestD = 1e9;
    for (let midi = spanLo; midi <= spanHi; midi += 1) {
      if (pcOf(midi) !== pc) continue;
      const dist = Math.abs(midi - target) + (voiced.includes(midi) ? 4 : 0);
      if (dist < bestD) {
        bestD = dist;
        best = midi;
      }
    }
    return best;
  };
  for (const pc of need) {
    if (count(pc) > 0) continue;
    const target = placeFresh(pc, 62);
    if (target == null) continue;
    let index = voiced.findIndex((midi, i) => !need.includes(pcOf(midi)) && voiced.some((other, j) => j !== i && other === midi));
    if (index < 0) {
      index = voiced.findIndex((midi, i) => {
        const pitch = pcOf(midi);
        return !need.includes(pitch) && voiced.some((other, j) => j !== i && pcOf(other) === pitch);
      });
    }
    if (index < 0) index = voiced.findIndex((midi) => !need.includes(pcOf(midi)));
    if (index < 0) index = voiced.findIndex((midi, i) => count(pcOf(midi)) > 1 && voiced.findIndex((other) => pcOf(other) === pcOf(midi)) !== i);
    if (index < 0) continue;
    voiced[index] = target;
  }
  if (prev && prev.length && voiced.length) {
    const top = voiced.reduce((best, midi, index) => (midi > voiced[best] ? index : best), 0);
    const prevFold = prev.map((midi) => foldPc(midi, spanLo, spanHi)).filter((midi) => midi != null);
    const prevTopPc = pcOf(Math.max(...(prevFold.length ? prevFold : prev)));
    if (pcOf(voiced[top]) === prevTopPc) {
      const old = voiced[top];
      const oldPc = pcOf(old);
      for (const pc of chordPcs) {
        if (pc === oldPc || pc === prevTopPc) continue;
        const alt = placeFresh(pc, old);
        if (alt == null || pcOf(alt) === prevTopPc) continue;
        voiced[top] = alt;
        if (need.includes(oldPc) && count(oldPc) === 0) {
          const spare = voiced.findIndex((midi, index) => index !== top && (!need.includes(pcOf(midi)) || count(pcOf(midi)) > 1));
          const restored = spare >= 0 ? placeFresh(oldPc, voiced[spare]) : null;
          if (restored == null) voiced[top] = old;
          else voiced[spare] = restored;
        }
        break;
      }
    }
  }
  return voiced.map((midi) => foldPc(midi, spanLo, spanHi) ?? midi);
}

function paintSixNine(notes, tonicPc, style) {
  const lo = style === "lofi" ? 48 : 40;
  const hi = style === "lofi" ? 67 : 68;
  const seventh = pcOf(tonicPc + 11);
  const pool = notes.filter((midi) => pcOf(midi) !== seventh);
  const voiced = pool.length >= 3 ? pool : notes.slice();
  for (const semi of [9, 2]) {
    const pc = pcOf(tonicPc + semi);
    if (voiced.some((midi) => pcOf(midi) === pc)) continue;
    const target = placePc(pc, 62, lo, hi);
    if (target == null) continue;
    let index = voiced.findIndex((midi, i) => voiced.some((other, j) => j !== i && pcOf(other) === pcOf(midi)));
    if (index < 0) index = voiced.length - 1;
    voiced[index] = target;
  }
  return voiced;
}

function chordHolds(bars, barLen, ambient) {
  if (!ambient) return Array.from({ length: bars }, () => 1);
  const holds = [];
  let left = bars;
  while (left > 0) {
    if (left === 3 && 3 * barLen <= 8.05) {
      holds.push(3);
      break;
    }
    if (left >= 2) {
      holds.push(2);
      left -= 2;
      continue;
    }
    if (holds.length && (holds[holds.length - 1] + 1) * barLen <= 8.05) holds[holds.length - 1] += 1;
    else if (holds.length && barLen < 3.9) holds[holds.length - 1] += 1;
    else holds.push(1);
    break;
  }
  return holds;
}

function rootCovered(style, section, keyPc, rootPc) {
  if (style === "synthwave") return Boolean(section && section.layers.includes("bass"));
  if (style === "arp") return true;
  if (style === "lofi") {
    if (section && section.layers.includes("bass")) return true;
    if (section && section.layers.includes("pedal") && rootPc === keyPc) return true;
    return false;
  }
  return Boolean(section && section.layers.includes("pedal") && rootPc === keyPc);
}

function cleanVoicing(notes, style, rootPc, covered, needPcs, spread) {
  const hi = (style === "lofi" ? 67 : style === "synthwave" ? 66 : 68) + (spread === "open" ? 5 : 0);
  const lo = style === "lofi" ? 48 : 40;
  const need = new Set(needPcs || []);
  let voiced = [];
  for (const midi of notes) {
    const rounded = Math.round(midi);
    if (rounded < lo || rounded > hi || voiced.includes(rounded)) continue;
    voiced.push(rounded);
  }
  const countPc = (pc) => voiced.filter((midi) => pcOf(midi) === pc).length;
  const place = (pc, target, min, max) => {
    let best = null;
    let bestD = 1e9;
    for (let midi = min; midi <= max; midi += 1) {
      if (pcOf(midi) !== pc || voiced.includes(midi)) continue;
      const dist = Math.abs(midi - target);
      if (dist < bestD) {
        bestD = dist;
        best = midi;
      }
    }
    return best;
  };
  for (const pc of need) {
    if (countPc(pc) > 0) continue;
    const at = place(pc, 64, Math.max(lo, 60), hi) ?? place(pc, 64, lo, hi);
    if (at != null) voiced.push(at);
  }
  if (!covered && rootPc != null && countPc(rootPc) === 0) {
    const at = place(rootPc, 52, lo, Math.min(hi, 59)) ?? place(rootPc, 52, lo, hi);
    if (at != null) voiced.push(at);
  }
  const rel = (midi) => (pcOf(midi) - rootPc + 12) % 12;
  const color = (midi) => [2, 6, 9, 10, 11].includes(rel(midi));
  let guard = 0;
  while (guard < 12) {
    guard += 1;
    voiced.sort((a, b) => a - b);
    let idx = -1;
    for (let i = 0; i < voiced.length - 1; i += 1) {
      const gap = voiced[i + 1] - voiced[i];
      if (voiced[i] < 60 && gap >= 1 && gap <= 2) {
        idx = i;
        break;
      }
    }
    if (idx < 0) break;
    const lower = voiced[idx];
    const upper = voiced[idx + 1];
    const lift = (midi) => {
      const raised = midi + 12;
      if (raised > hi || voiced.includes(raised)) return false;
      voiced[voiced.indexOf(midi)] = raised;
      return true;
    };
    if (color(upper) && lift(upper)) continue;
    if (color(lower) && lift(lower)) continue;
    if (lift(upper)) continue;
    if (lift(lower)) continue;
    const tuck = (midi) => {
      const dropped = midi - 12;
      if (dropped < lo || voiced.includes(dropped)) return false;
      const crowded = voiced.some((item) => {
        if (item === midi) return false;
        const gap = Math.abs(item - dropped);
        return gap >= 1 && gap <= 2 && (dropped < 60 || item < 60);
      });
      if (crowded) return false;
      voiced[voiced.indexOf(midi)] = dropped;
      return true;
    };
    if (color(upper) && tuck(upper)) continue;
    if (color(lower) && tuck(lower)) continue;
    const score = (midi) => {
      const interval = rel(midi);
      const wanted = need.has(pcOf(midi));
      if (interval === 0) return covered ? 0 : 4;
      if (!wanted && (interval === 2 || interval === 6 || interval === 9 || interval === 7)) return 0;
      if (interval === 7) return 1;
      if (interval === 2 || interval === 6 || interval === 9) return 2;
      if (interval === 10 || interval === 11) return 3;
      return 5;
    };
    const victim = score(upper) <= score(lower) ? upper : lower;
    if (voiced.length <= 3 && score(victim) >= 5) break;
    voiced = voiced.filter((item) => item !== victim);
  }
  if (spread === "open" && voiced.length >= 4) {
    voiced.sort((a, b) => a - b);
    const dropAt = voiced.length - 2;
    const dropped = voiced[dropAt] - 12;
    const crowded = voiced.some((item) => item !== voiced[dropAt] && Math.abs(item - dropped) <= 2);
    if (dropped >= lo && !voiced.includes(dropped) && !crowded) voiced[dropAt] = dropped;
  }
  voiced.sort((a, b) => a - b);
  return voiced;
}

function scheduleChords(analysis, key, style, genome) {
  const motion = normMotion(analysis.mean.motion);
  const dict = CHORDS[key.mode] || CHORDS.major;
  const bpm = genome?.bpm || (style === "ambient" ? ambientClock(analysis).bpm : chooseTempo(style, motion));
  const bar = genome?.meter?.barLen || (240 / bpm);
  const sections = planSections(analysis, regionMean, normMotion, bpm, style, genome?.meter, genome?.seed, genome);
  const prog = (genome?.progression?.ids || chooseProg(key.mode, style, analysis.mean)).slice();
  const has = (id) => Boolean(dict[id]);
  const chords = [];
  let prevNotes = null;
  const sounded = [];
  let aStart = null;
  const spread = genome?.register?.spread;
  for (const section of sections) {
    const holds = genome
      ? holdsFor(section.name, section.bars, bar, style, genome.harmonicRhythm, section.energy)
      : chordHolds(section.bars, bar, style === "ambient");
    const ids = sectionChordIds(section.name, holds.length, prog, has, section.bars, style, key.mode);
    if (section.name === "A" && ids.length) aStart = ids[0];
    if ((section.name === "B" || section.name === "build") && aStart && ids[0] === aStart) {
      const alt = prog.find((id) => id !== aStart && dict[id]);
      if (alt && ids.length > 2) ids[0] = alt;
    }
    if (genome?.borrowed && (section.name === genome.borrowed.section || (section.name !== "intro" && section.name !== "outro" && section.name !== "resolve"))) {
      const want = genome.borrowed.section;
      const plant = section.name === want || (!sections.some((item) => item.name === want) && section.name !== "intro");
      if (plant && dict[genome.borrowed.id] && ids.length > 2) {
        const at = Math.min(1, ids.length - 3);
        if (ids[at] !== genome.borrowed.id) ids[at] = genome.borrowed.id;
        genome.borrowed.section = section.name;
      }
    }
    let cursor = section.bar0;
    for (let i = 0; i < ids.length; i += 1) {
      const t0 = cursor * bar;
      cursor += holds[i] || 1;
      if (t0 >= analysis.duration - 0.04) break;
      let t1 = cursor * bar;
      if (i === ids.length - 1) t1 = section.t1;
      let id = ids[i];
      if (!dict[id]) id = prog.find((item) => dict[item]) || Object.keys(dict)[0];
      const lastOfPiece = section === sections[sections.length - 1] && i === ids.length - 1;
      let def = dict[id];
      const tonicChord = pcOf(key.pc + def.root) === key.pc;
      const count = Math.min(style === "lofi" ? 5 : style === "synthwave" ? 3 : 4, Math.max(3, def.semis.length));
      let notes = voiceChord(def, key.pc, prevNotes, count, style);
      if (style === "lofi") notes = paintColor(notes, def, key.pc, prevNotes, style);
      let name = chordLabel(key, id);
      if (section.name === "intro" && tonicChord && i === 0 && style !== "synthwave") {
        notes = paintSixNine(notes, key.pc, style);
        name = `${spellPc(key.pc, preferFlat(key.pc))}6/9`;
      }
      if (lastOfPiece && tonicChord) {
        const seventh = pcOf(key.pc + 11);
        const kept = notes.filter((midi) => pcOf(midi) !== seventh);
        if (kept.length >= 3) notes = kept;
      }
      const rootPc = pcOf(key.pc + def.root);
      const rels = def.semis.map((semi) => ((semi - def.root) % 12 + 12) % 12);
      let needSemis = [2, 3, 4, 6, 9, 10, 11].filter((semi) => rels.includes(semi));
      if (section.name === "intro" && tonicChord && i === 0) needSemis = [2, 4, 9];
      if (lastOfPiece && tonicChord) needSemis = needSemis.filter((semi) => semi !== 11);
      const need = needSemis.map((semi) => pcOf(rootPc + semi));
      const thirdRel = rels.includes(3) ? 3 : rels.includes(4) ? 4 : null;
      const swNeed = style === "synthwave" && thirdRel != null ? [pcOf(rootPc + thirdRel)] : [];
      notes = cleanVoicing(notes, style, rootPc, rootCovered(style, section, key.pc, rootPc), style === "lofi" ? need : swNeed, spread);
      notes.sort((a, b) => a - b);
      if (lastOfPiece && tonicChord) {
        const flat = preferFlat(key.pc);
        name = `${spellPc(key.pc, flat)}${honestSymbol(notes, rootPc)}`;
      } else if (!nameMatches(name, notes, rootPc)) {
        const flat = id.startsWith("b") || preferFlat(key.pc);
        name = `${spellPc(rootPc, flat)}${honestSymbol(notes, rootPc)}`;
      }
      chords.push({
        t0,
        t1: Math.min(t1, analysis.duration),
        id,
        notes,
        sat: normSat(regionMean(analysis, t0, Math.min(t1, analysis.duration), "saturation")),
        bright: regionMean(analysis, t0, Math.min(t1, analysis.duration), "brightness"),
        rootPc: pcOf(key.pc + def.root),
        bassPc: def.bassSemi != null ? pcOf(key.pc + def.bassSemi) : null,
        name,
      });
      sounded.push(id);
      prevNotes = notes;
    }
  }
  snapChordCuts(chords, analysis, 60 / bpm, style, sections);
  if (style === "synthwave") anchorFinalTonic(chords, bar, analysis.duration);
  return {
    bpm,
    motion,
    chords,
    loop: sounded,
    sections,
    meter: genome?.meter || null,
    motif: genome?.motif || null,
    register: genome?.register || null,
    seed: genome?.seed || 0,
    humanize: genome?.humanize || 0,
    energy: genome?.energy || [],
  };
}

// The bar grid can leave the last tonic as a short tail. Pull it back so it
// owns a full bar and the release still ends inside the clip.
function anchorFinalTonic(chords, bar, duration) {
  const last = chords[chords.length - 1];
  if (!last || last.t1 - last.t0 >= bar * 0.98) return;
  const prev = chords[chords.length - 2];
  let start = Math.max(0, duration - bar);
  if (prev && start < prev.t0 + 0.45) start = prev.t0 + 0.45;
  if (!(duration - start > last.t1 - last.t0 + 0.05)) return;
  if (start >= last.t0 - 0.02) return;
  if (prev && prev.t1 > start) prev.t1 = start;
  last.t0 = start;
}

function snapChordCuts(chords, analysis, beat, style, sections) {
  const cuts = analysis.cuts || [];
  if (!cuts.length || !(beat > 0)) return;
  const minLen = style === "ambient" ? 2.85 : Math.max(0.42, beat * 0.85);
  const sectionLast = new Set();
  for (const section of sections) {
    let last = null;
    for (const chord of chords) {
      if (chord.t0 >= section.t0 - 0.03 && chord.t1 <= section.t1 + 0.06) last = chord;
    }
    if (last) sectionLast.add(last);
  }
  for (let i = 0; i < chords.length - 1; i += 1) {
    if (sectionLast.has(chords[i + 1])) continue;
    const boundary = chords[i].t1;
    let near = null;
    let best = beat + 0.0001;
    for (const cut of cuts) {
      const d = Math.abs(cut - boundary);
      if (d <= beat && d < best) {
        best = d;
        near = cut;
      }
    }
    if (near == null) continue;
    const snapped = Math.round((Math.round(near / beat) * beat) * 1000) / 1000;
    if (Math.abs(snapped - boundary) < 0.015) continue;
    if (snapped - chords[i].t0 < minLen) continue;
    if (chords[i + 1].t1 - snapped < minLen) continue;
    const sec = sections.find((item) => boundary >= item.t0 - 0.03 && boundary <= item.t1 + 0.03);
    if (sec && (snapped < sec.t0 + 0.02 || snapped > sec.t1 - 0.02)) continue;
    chords[i].t1 = snapped;
    chords[i + 1].t0 = snapped;
  }
}

function chordAt(chords, t) {
  for (let i = chords.length - 1; i >= 0; i -= 1) {
    if (t >= chords[i].t0) return chords[i];
  }
  return chords[0];
}

function clashes(pc, tones) {
  return tones.some((tone) => pcOf(tone + 1) === pc);
}

function melodyMidi(chord, key, high, rng) {
  const tones = [...new Set(chord.notes.map((midi) => pcOf(midi)))];
  const penta = (PENTA[key.mode] || PENTA.minor).map((semi) => pcOf(key.pc + semi));
  const bag = [];
  for (const pc of tones) bag.push(pc, pc, pc);
  for (const pc of penta) {
    if (!tones.includes(pc) && !clashes(pc, tones)) bag.push(pc);
  }
  const pc = bag[Math.floor(rng() * bag.length) % bag.length];
  const lo = high ? 74 : 67;
  const hi = high ? 88 : 79;
  let midi = pc;
  while (midi < lo) midi += 12;
  while (midi > hi) midi -= 12;
  if (clashes(pcOf(midi), tones)) return chord.notes[chord.notes.length - 1];
  return midi;
}

function scheduleBells(analysis, key, style, rng, plan) {
  const notes = [];
  if (!plan.chords.length) return notes;
  if (style === "lofi") {
    const beat = 60 / plan.bpm;
    const bar = plan.meter?.barLen || beat * 4;
    for (let barStart = bar; barStart < analysis.duration - 1.2; barStart += bar * 2) {
      let mot = 0;
      for (let k = 0; k <= 4; k += 1) {
        mot = Math.max(mot, normMotion(frameAt(analysis, barStart + bar * (k / 4)).motion));
      }
      if (mot < 0.28 || rng() > 0.9) continue;
      const chord = chordAt(plan.chords, barStart + bar * 0.5);
      let t = barStart + bar * 0.5;
      for (let k = 0; k < 3; k += 1) {
        notes.push({
          t,
          midi: melodyMidi(chord, key, false, rng),
          dur: 0.3,
          vel: 0.055 + mot * 0.03,
          kind: "fill",
        });
        t += beat * 0.5;
      }
    }
    return notes;
  }
  if (style === "synthwave") return notes;
  let t = style === "arp" ? 2.4 : 3.4;
  while (t < analysis.duration - 1.4) {
    const mot = normMotion(frameAt(analysis, t).motion);
    // A calm picture still gets an occasional bell (about one every 6-8 s); motion brings them closer
    // together (down to about 3 s apart) and makes them more likely.
    const gap = 6.2 - mot * 3;
    if (rng() < 0.5 + mot * 0.45) {
      const chord = chordAt(plan.chords, t);
      notes.push({
        t,
        midi: melodyMidi(chord, key, true, rng),
        dur: 3.2 + rng() * 1.4,
        vel: 0.038 + mot * 0.022,
        kind: "bell",
      });
    }
    t += Math.max(3.1, gap);
  }
  return notes;
}

// --- rendering --------------------------------------------------------------

function addWavetable(L, R, spec) {
  const n = L.length;
  const i0 = clamp(Math.floor(spec.t0 * SR), 0, n);
  const relStart = clamp(Math.floor(spec.t1 * SR), i0, n);
  const relLen = Math.max(1, Math.round(spec.release * SR));
  const i1 = Math.min(n, relStart + relLen);
  const aN = Math.max(1, Math.round(spec.attack * SR));
  const table = spec.table;
  let phase = spec.phase0 || 0;
  const dPhase = spec.freq / SR;
  let z1 = 0;
  let z2 = 0;
  let hp = 0;
  let xPrev = 0;
  const hpA = Math.exp((-2 * Math.PI * (spec.hp || 90)) / SR);
  let coeff = 1 - Math.exp((-2 * Math.PI * spec.fc) / SR);
  let lfoPhase = spec.lfoPhase || 0;
  const lfoStep = (spec.lfoRate || 0.07) / SR;
  const wobbleRate = spec.wobble || 0.06;
  let wobblePhase = spec.wobblePhase || 0;
  let wobble = 1;
  let driftMul = 1;
  const drift = spec.drift || 0;
  for (let i = i0; i < i1; i += 1) {
    if (((i - i0) & 63) === 0) {
      driftMul = 1 + drift * Math.sin(wobblePhase);
      const depth = spec.lfoDepth ?? 0.14;
      const lfo = (1 - depth) + depth * (0.5 + 0.5 * Math.sin(lfoPhase));
      lfoPhase += lfoStep * 64;
      const fEnv = spec.fEnv ? 1 + spec.fEnv * Math.exp(-(i - i0) / ((spec.fDecay || 0.25) * SR)) : 1;
      const fc = Math.min(16000, spec.fc * lfo * fEnv);
      coeff = 1 - Math.exp((-2 * Math.PI * fc) / SR);
      const ampDepth = spec.ampDepth ?? 0.06;
      wobble = (1 - ampDepth) + ampDepth * (0.5 + 0.5 * Math.sin(wobblePhase));
      wobblePhase += 2 * Math.PI * wobbleRate * (64 / SR);
    }
    let env = 1;
    if (i < i0 + aN) env = Math.sin(((i - i0) / aN) * Math.PI * 0.5);
    else if (i >= relStart) env = Math.cos(Math.min(1, (i - relStart) / relLen) * Math.PI * 0.5);
    phase += dPhase * driftMul;
    if (phase >= 1) phase -= 1;
    const x = phase * TABLE;
    const idx = x | 0;
    let sample = table[idx] + (table[idx + 1] - table[idx]) * (x - idx);
    const hpOut = hpA * (hp + sample - xPrev);
    hp = hpOut;
    xPrev = sample;
    sample = hpOut;
    z1 += coeff * (sample - z1);
    z2 += coeff * (z1 - z2);
    const s = z2 * env * wobble * spec.gain;
    L[i] += s * spec.panL;
    R[i] += s * spec.panR;
  }
}

function addSine(L, R, spec) {
  const n = L.length;
  const i0 = clamp(Math.floor(spec.t0 * SR), 0, n);
  const relStart = clamp(Math.floor(spec.t1 * SR), i0, n);
  const relLen = Math.max(1, Math.round((spec.release ?? 0.4) * SR));
  const i1 = Math.min(n, relStart + relLen);
  const aN = Math.max(1, Math.round((spec.attack ?? 0.4) * SR));
  let phase = spec.phase0 || 0;
  const dPhase = spec.freq / SR;
  for (let i = i0; i < i1; i += 1) {
    let env = 1;
    if (i < i0 + aN) env = Math.sin(((i - i0) / aN) * Math.PI * 0.5);
    else if (i >= relStart) env = Math.cos(Math.min(1, (i - relStart) / relLen) * Math.PI * 0.5);
    phase += dPhase;
    if (phase >= 1) phase -= 1;
    const x = phase * TABLE;
    const idx = x | 0;
    const sample = SINE[idx] + (SINE[idx + 1] - SINE[idx]) * (x - idx);
    const s = sample * env * spec.gain;
    L[i] += s * spec.panL;
    R[i] += s * spec.panR;
  }
}

// Several slow pad sines in one pass. Samples are computed every 4 ticks and the
// gaps are linear fills. Chord tones stay under 1 kHz, so the fill stays smooth.
function addPadVoices(L, R, spec) {
  const voices = spec.voices || [];
  const nv = voices.length;
  if (!nv) return;
  const n = L.length;
  const i0 = clamp(Math.floor(spec.t0 * SR), 0, n);
  const relStart = clamp(Math.floor(spec.t1 * SR), i0, n);
  const relLen = Math.max(1, Math.round((spec.release ?? 0.4) * SR));
  const i1 = Math.min(n, relStart + relLen);
  const aN = Math.max(1, Math.round((spec.attack ?? 0.4) * SR));
  const stride = 4;
  const phases = new Float64Array(nv);
  const dPhase = new Float64Array(nv);
  const gains = new Float64Array(nv);
  const panL = new Float64Array(nv);
  const panR = new Float64Array(nv);
  for (let v = 0; v < nv; v += 1) {
    phases[v] = voices[v].phase0 || 0;
    dPhase[v] = (voices[v].freq / SR) * stride;
    gains[v] = voices[v].gain;
    panL[v] = voices[v].panL;
    panR[v] = voices[v].panR;
  }
  let prevL = 0;
  let prevR = 0;
  let prevI = -1;
  for (let i = i0; i < i1; i += stride) {
    const env = i < i0 + aN
      ? Math.sin(((i - i0) / aN) * Math.PI * 0.5)
      : i >= relStart
        ? Math.cos(Math.min(1, (i - relStart) / relLen) * Math.PI * 0.5)
        : 1;
    let l = 0;
    let r = 0;
    for (let v = 0; v < nv; v += 1) {
      let p = phases[v] + dPhase[v];
      if (p >= 1) p -= 1;
      phases[v] = p;
      const x = p * TABLE;
      const idx = x | 0;
      const s = (SINE[idx] + (SINE[idx + 1] - SINE[idx]) * (x - idx)) * env * gains[v];
      l += s * panL[v];
      r += s * panR[v];
    }
    L[i] += l;
    R[i] += r;
    if (prevI >= 0) {
      const span = i - prevI;
      for (let k = 1; k < span; k += 1) {
        const a = k / span;
        L[prevI + k] += prevL + (l - prevL) * a;
        R[prevI + k] += prevR + (r - prevR) * a;
      }
    }
    prevL = l;
    prevR = r;
    prevI = i;
  }
}

function addFm(L, R, spec) {
  const n = L.length;
  const i0 = clamp(Math.floor(spec.t0 * SR), 0, n);
  const relStart = clamp(Math.floor(spec.t1 * SR), i0, n);
  const relLen = Math.max(1, Math.round(spec.release * SR));
  const i1 = Math.min(n, relStart + relLen);
  const aN = Math.max(1, Math.round(spec.attack * SR));
  let car = 0.15; // not a zero-crossing start; the attack envelope opens from silence
  let mod = 0.4;
  const dCar = spec.freq / SR;
  const dMod = (spec.freq * (spec.ratio || 1)) / SR;
  const tineDecay = Math.exp(-1 / (0.45 * SR));
  const indexDecay = Math.exp(-1 / (0.22 * SR));
  let tineEnv = 1;
  let indexEnv = 1;
  let z1 = 0;
  let hp = 0;
  let prev = 0;
  const hpCut = spec.hp || 0;
  const hpA = hpCut > 0 ? Math.exp((-2 * Math.PI * hpCut) / SR) : 0;
  const coeff = 1 - Math.exp((-2 * Math.PI * spec.fc) / SR);
  const noiseSeed = (spec.seed | 0) || 1;
  const tremAmt = spec.trem || 0;
  const tremStep = ((spec.tremRate || 3.4) / SR) * Math.PI * 2;
  let tremPhase = ((spec.seed | 0) % 17) * 0.3;
  const indexPeak = spec.index ?? 1.1;
  const flutter = spec.flutter || 0;
  const flutterRate = (spec.flutterRate || 0.5) * Math.PI * 2;
  for (let i = i0; i < i1; i += 1) {
    let env = 1;
    if (i < i0 + aN) env = Math.sin(((i - i0) / aN) * Math.PI * 0.5);
    else if (i >= relStart) env = Math.cos(Math.min(1, (i - relStart) / relLen) * Math.PI * 0.5);
    tineEnv *= tineDecay;
    indexEnv *= indexDecay;
    const tine = 0.62 + 0.38 * tineEnv;
    const index = 0.35 + indexPeak * indexEnv;
    const flutterNow = flutter ? 1 + flutter * Math.sin(flutterRate * (i / SR)) : 1;
    mod += dMod * flutterNow;
    if (mod >= 1) mod -= 1;
    const mx = mod * TABLE;
    const mi = mx | 0;
    const m = (SINE[mi] + (SINE[mi + 1] - SINE[mi]) * (mx - mi)) * index;
    car += dCar * flutterNow;
    if (car >= 1) car -= 1;
    const ang = car * TABLE;
    let p = (ang + (m * TABLE) / (2 * Math.PI)) % TABLE;
    if (p < 0) p += TABLE;
    const pi = p | 0;
    let sample = SINE[pi] + (SINE[pi + 1] - SINE[pi]) * (p - pi);
    const age = i - i0;
    if (age < 180) {
      const hammer = Math.sin((age / 180) * Math.PI) * hashNoise(noiseSeed + age);
      sample += hammer * 0.035 * Math.exp(-age / 50);
    }
    if (hpCut > 0) {
      const out = hpA * (hp + sample - prev);
      hp = out;
      prev = sample;
      sample = out;
    }
    z1 += coeff * (sample - z1);
    tremPhase += tremStep;
    const trem = tremAmt ? 1 - tremAmt + tremAmt * (0.5 + 0.5 * Math.sin(tremPhase)) : 1;
    const s = z1 * env * tine * trem * spec.gain;
    L[i] += s * spec.panL;
    R[i] += s * spec.panR;
  }
}

function addBell(L, R, spec) {
  const partials = [
    { ratio: 1, amp: 1, decay: spec.dur * 1.15 },
    { ratio: 2, amp: 0.1, decay: spec.dur * 0.5 },
    { ratio: 3, amp: 0.035, decay: spec.dur * 0.28 },
  ];
  const n = L.length;
  const i0 = clamp(Math.floor(spec.t * SR), 0, n);
  const aN = Math.max(1, Math.round(0.04 * SR));
  const i1 = Math.min(n, i0 + Math.round((spec.dur + 0.05) * SR));
  const phases = partials.map((_, k) => (k + 1) * 0.17);
  const env = partials.map(() => 1);
  const decays = partials.map((p) => Math.exp(-1 / (Math.max(0.05, p.decay) * SR)));
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    const attack = age < aN ? Math.sin((age / aN) * Math.PI * 0.5) : 1;
    let sample = 0;
    for (let k = 0; k < partials.length; k += 1) {
      env[k] *= decays[k];
      phases[k] += (spec.freq * partials[k].ratio) / SR;
      if (phases[k] >= 1) phases[k] -= 1;
      const x = phases[k] * TABLE;
      const idx = x | 0;
      sample += (SINE[idx] + (SINE[idx + 1] - SINE[idx]) * (x - idx)) * partials[k].amp * env[k];
    }
    const s = sample * attack * spec.vel;
    L[i] += s * spec.panL;
    R[i] += s * spec.panR;
  }
}

function addPluck(L, R, spec) {
  const n = L.length;
  const i0 = clamp(Math.floor(spec.t * SR), 0, n);
  const aN = Math.max(1, Math.round(0.012 * SR));
  const relN = Math.max(1, Math.round(0.012 * SR));
  const i1 = Math.min(n, i0 + Math.round(spec.dur * SR));
  let phase = 0;
  let phase2 = 0.15;
  const d1 = spec.freq / SR;
  const d2 = (spec.freq * 2) / SR;
  const decay = Math.exp(-1 / (spec.dur * 0.42 * SR));
  const decay2 = Math.exp(-1 / (spec.dur * 0.16 * SR));
  let e1 = 1;
  let e2 = 1;
  let z1 = 0;
  let phase3 = 0.4;
  let phaseT = 0.07;
  const d3 = (spec.freq * 3) / SR;
  const dT = (spec.freq * 1.0021) / SR;
  let coeff = 1 - Math.exp((-2 * Math.PI * spec.fc) / SR);
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    if ((age & 63) === 0) coeff = 1 - Math.exp((-2 * Math.PI * Math.min(12000, spec.fc * (1 + 1.6 * e2))) / SR);
    const attack = age < aN ? age / aN : 1;
    const tail = i1 - i;
    const release = tail < relN ? tail / relN : 1;
    e1 *= decay;
    e2 *= decay2;
    phase += d1;
    phase2 += d2;
    if (phase >= 1) phase -= 1;
    if (phase2 >= 1) phase2 -= 1;
    const x1 = phase * TABLE;
    const x2 = phase2 * TABLE;
    const iA = x1 | 0;
    const iB = x2 | 0;
    const s1 = SINE[iA] + (SINE[iA + 1] - SINE[iA]) * (x1 - iA);
    const s2 = SINE[iB] + (SINE[iB + 1] - SINE[iB]) * (x2 - iB);
    phase3 += d3;
    phaseT += dT;
    if (phase3 >= 1) phase3 -= 1;
    if (phaseT >= 1) phaseT -= 1;
    const x3 = phase3 * TABLE;
    const xT = phaseT * TABLE;
    const iC = x3 | 0;
    const iT = xT | 0;
    const s3 = SINE[iC] + (SINE[iC + 1] - SINE[iC]) * (x3 - iC);
    const sT = SINE[iT] + (SINE[iT + 1] - SINE[iT]) * (xT - iT);
    const sample = (s1 * 0.78 + sT * 0.3) * e1 + s2 * 0.35 * e2 + s3 * 0.12 * e2 * e2;
    z1 += coeff * (sample - z1);
    const s = z1 * attack * release * spec.vel;
    L[i] += s * spec.panL;
    R[i] += s * spec.panR;
  }
}

function addKick(L, R, t, vel, click = true) {
  const n = L.length;
  const i0 = clamp(Math.floor(t * SR), 0, n);
  const i1 = Math.min(n, i0 + Math.round(0.36 * SR));
  const aN = Math.max(1, Math.round(0.005 * SR));
  let phase = 0;
  let clickPhase = 0;
  let fEnv = 1;
  let amp = 1;
  const fDecay = Math.exp(-1 / (0.055 * SR));
  const aDecay = Math.exp(-1 / (0.15 * SR));
  const f0 = 74;
  const f1 = 56;
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    const attack = age < aN ? age / aN : 1;
    fEnv *= fDecay;
    amp *= aDecay;
    const freq = f1 + (f0 - f1) * fEnv;
    phase += freq / SR;
    if (phase >= 1) phase -= 1;
    const x = phase * TABLE;
    const idx = x | 0;
    let sample = (SINE[idx] + (SINE[idx + 1] - SINE[idx]) * (x - idx)) * amp;
    if (click && age < 360) {
      clickPhase += 1600 / SR;
      if (clickPhase >= 1) clickPhase -= 1;
      const cx = clickPhase * TABLE;
      const ci = cx | 0;
      const click = SINE[ci] + (SINE[ci + 1] - SINE[ci]) * (cx - ci);
      sample += click * Math.exp(-age / 80) * 0.1;
    }
    const s = sample * attack * vel * 0.57;
    L[i] += s * 0.7;
    R[i] += s * 0.7;
  }
}

function addSnare(L, R, t, vel) {
  const n = L.length;
  const i0 = clamp(Math.floor(t * SR), 0, n);
  const i1 = Math.min(n, i0 + Math.round(0.2 * SR));
  const aN = Math.max(1, Math.round(0.004 * SR));
  let phase = 0;
  const dPhase = 200 / SR;
  let tone = 1;
  let noiseEnv = 1;
  const toneDecay = Math.exp(-1 / (0.09 * SR));
  const noiseDecay = Math.exp(-1 / (0.07 * SR));
  let lp = 0;
  const lpC = 1 - Math.exp((-2 * Math.PI * 4500) / SR);
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    const attack = age < aN ? age / aN : 1;
    tone *= toneDecay;
    noiseEnv *= noiseDecay;
    phase += dPhase;
    if (phase >= 1) phase -= 1;
    const x = phase * TABLE;
    const idx = x | 0;
    const sine = SINE[idx] + (SINE[idx + 1] - SINE[idx]) * (x - idx);
    const noise = hashNoise(i * 3 + 91);
    lp += lpC * (noise - lp);
    const sample = sine * tone * 0.55 + lp * noiseEnv * 0.28;
    const s = sample * attack * vel * 0.43;
    L[i] += s * 0.62;
    R[i] += s * 0.5;
  }
}

function addHat(L, R, t, vel) {
  const n = L.length;
  const i0 = clamp(Math.floor(t * SR), 0, n);
  const life = 0.02;
  const i1 = Math.min(n, i0 + Math.round(life * SR));
  const aN = 6;
  let hp = 0;
  let prev = 0;
  let lp = 0;
  const hpA = Math.exp((-2 * Math.PI * 6200) / SR);
  const lpC = 1 - Math.exp((-2 * Math.PI * 8600) / SR);
  const decay = Math.exp(-1 / (0.012 * SR));
  let env = 1;
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    const attack = age < aN ? age / aN : 1;
    env *= decay;
    const noise = hashNoise(i * 5 + 9);
    const high = hpA * (hp + noise - prev);
    hp = high;
    prev = noise;
    lp += lpC * (high - lp);
    const s = lp * env * attack * vel * 0.038;
    L[i] += s * 0.42;
    R[i] += s * 0.58;
  }
}

function addCrackle(L, R, duration, rng) {
  const n = L.length;
  const hpA = Math.exp((-2 * Math.PI * 1800) / SR);
  const lpC = 1 - Math.exp((-2 * Math.PI * 6500) / SR);
  let hpL = 0;
  let hpR = 0;
  let pL = 0;
  let pR = 0;
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < n; i += 1) {
    const nL = hashNoise(i + 1000);
    const nR = hashNoise(i + 50000);
    const oL = hpA * (hpL + nL - pL);
    const oR = hpA * (hpR + nR - pR);
    hpL = oL;
    hpR = oR;
    pL = nL;
    pR = nR;
    lpL += lpC * (oL - lpL);
    lpR += lpC * (oR - lpR);
    L[i] += lpL * 0.0014;
    R[i] += lpR * 0.0014;
  }
  const pops = Math.max(2, Math.round(duration / 3.2));
  for (let p = 0; p < pops; p += 1) {
    const t = rng() * Math.max(0.2, duration - 0.2);
    const i0 = clamp(Math.floor(t * SR), 0, n - 4);
    const amp = 0.012 + rng() * 0.012;
    const pan = rng() * 0.6 + 0.2;
    for (let k = 0; k < 3; k += 1) {
      const s = hashNoise(i0 + k + p * 17) * amp * (1 - k / 3);
      L[i0 + k] += s * pan;
      R[i0 + k] += s * (1 - pan);
    }
  }
}

function applySidechain(L, R, kicks) {
  const n = L.length;
  const times = kicks.map((kick) => kick.t).sort((a, b) => a - b);
  let hit = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    while (hit < times.length - 1 && times[hit + 1] < t - 0.02) hit += 1;
    let gain = 1;
    for (let k = hit; k < times.length && times[k] < t + 0.03; k += 1) {
      const dt = t - times[k];
      if (dt >= 0 && dt < 0.12) {
        const u = dt < 0.01 ? dt / 0.01 : 1 - (dt - 0.01) / 0.11;
        gain = Math.min(gain, 1 - 0.34 * clamp(u, 0, 1));
      }
    }
    L[i] *= gain;
    R[i] *= gain;
  }
}

function makeCombs(delays, feedback, damp) {
  return delays.map((len) => ({
    buf: new Float32Array(len),
    idx: 0,
    filter: 0,
    feedback,
    damp,
  }));
}

function combStep(comb, x) {
  const delayed = comb.buf[comb.idx];
  comb.filter = delayed * (1 - comb.damp) + comb.filter * comb.damp;
  comb.buf[comb.idx] = x + comb.filter * comb.feedback;
  comb.idx += 1;
  if (comb.idx >= comb.buf.length) comb.idx = 0;
  return delayed;
}

function allpassStep(ap, x) {
  const delayed = ap.buf[ap.idx];
  const y = -x + delayed;
  ap.buf[ap.idx] = x + delayed * 0.5;
  ap.idx += 1;
  if (ap.idx >= ap.buf.length) ap.idx = 0;
  return y;
}

const FREEVERB_COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const FREEVERB_ALLPASS = [556, 441, 341, 225];

function fftRadix(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (invert ? -1 : 1);
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j += 1) {
        const k = i + j + half;
        const vRe = re[k] * wRe - im[k] * wIm;
        const vIm = re[k] * wIm + im[k] * wRe;
        re[k] = re[i + j] - vRe;
        im[k] = im[i + j] - vIm;
        re[i + j] += vRe;
        im[i + j] += vIm;
        const nextRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextRe;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i += 1) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

const irReady = new Map();

function irPair(name, pcm) {
  if (irReady.has(name)) return irReady.get(name);
  const limit = 60000;
  const n48 = Math.min(pcm.length, limit);
  const n = n48 >> 1;
  const half = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pcm[i * 2];
    const b = pcm[i * 2 + 1] || 0;
    half[i] = (a + b) * 0.5;
    sum += (Math.abs(a) + Math.abs(b)) * 0.5;
  }
  const gain = sum > 1e-8 ? 1 / sum : 1;
  const fftN = 65536;
  const re = new Float64Array(fftN);
  const im = new Float64Array(fftN);
  for (let i = 0; i < n; i += 1) re[i] = half[i] * gain;
  fftRadix(re, im, false);
  const spec = { re, im };
  irReady.set(name, spec);
  return spec;
}

async function convolveChannel(x, spec, shouldStop) {
  const n = x.length;
  const block = 32768;
  const fftN = 65536;
  const out = new Float32Array(n);
  const re = new Float64Array(fftN);
  const im = new Float64Array(fftN);
  const Hr = spec.re;
  const Hi = spec.im;
  let blocks = 0;
  for (let b = 0; b < n; b += block) {
    if ((blocks & 7) === 0) {
      if (shouldStop && shouldStop()) {
        const err = new Error("Cancelled");
        err.cancelled = true;
        throw err;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    blocks += 1;
    re.fill(0);
    im.fill(0);
    const len = Math.min(block, n - b);
    for (let i = 0; i < len; i += 1) re[i] = x[b + i];
    fftRadix(re, im, false);
    for (let k = 0; k < fftN; k += 1) {
      const rr = re[k] * Hr[k] - im[k] * Hi[k];
      const ii = re[k] * Hi[k] + im[k] * Hr[k];
      re[k] = rr;
      im[k] = ii;
    }
    fftRadix(re, im, true);
    const write = Math.min(fftN, n - b);
    for (let i = 0; i < write; i += 1) out[b + i] += re[i];
  }
  return out;
}

async function applySpace(L, R, style, shouldStop) {
  const name = style === "ambient" || style === "synthwave" ? "hall" : style === "lofi" ? "room" : "hotel";
  const pcm = loadIr(name);
  if (!pcm || pcm.length < 32) {
    await applyReverb(L, R, style, shouldStop);
    return;
  }
  const spec = irPair(name, pcm);
  const wet = style === "lofi" ? 0.18 : style === "arp" ? 0.24 : style === "synthwave" ? 0.26 : 0.38;
  const n = L.length;
  const n24 = n >> 1;
  const mono = new Float32Array(n24);
  for (let i = 0; i < n24; i += 1) {
    const j = i << 1;
    mono[i] = (L[j] + L[j + 1] + R[j] + R[j + 1]) * 0.25;
  }
  const wet24 = await convolveChannel(mono, spec, shouldStop);
  const delay = Math.round(0.011 * SR);
  const coeff = 1 - Math.exp((-2 * Math.PI * 7000) / SR);
  let lpL = 0;
  let lpR = 0;
  const at = (index) => {
    if (index < 0) return wet24[0] || 0;
    const x = index * 0.5;
    const j = x | 0;
    const a = j < wet24.length ? wet24[j] : 0;
    const b = j + 1 < wet24.length ? wet24[j + 1] : a;
    return a + (b - a) * (x - j);
  };
  for (let i = 0; i < n; i += 1) {
    lpL += coeff * (at(i) - lpL);
    lpR += coeff * (at(i - delay) - lpR);
    L[i] += lpL * wet;
    R[i] += lpR * wet;
  }
}

// The reverb as a send bus: only what is sent gets room (no bass, little kick),
// and the mono IR return is split into two decorrelated sides for width.
async function spaceWet(sendL, sendR, style, shouldStop) {
  const n = sendL.length;
  const name = style === "ambient" || style === "synthwave" ? "hall" : style === "lofi" ? "room" : "hotel";
  const pcm = loadIr(name);
  if (!pcm || pcm.length < 32) {
    const wL = Float32Array.from(sendL);
    const wR = Float32Array.from(sendR);
    await applyReverb(wL, wR, style, shouldStop);
    for (let i = 0; i < n; i += 1) {
      wL[i] -= sendL[i];
      wR[i] -= sendR[i];
    }
    return { L: wL, R: wR };
  }
  const spec = irPair(name, pcm);
  const wet = (style === "lofi" ? 0.18 : style === "arp" ? 0.24 : style === "synthwave" ? 0.26 : 0.38) * 1.1;
  const n24 = n >> 1;
  const mono = new Float32Array(n24);
  for (let i = 0; i < n24; i += 1) {
    const j = i << 1;
    mono[i] = (sendL[j] + sendL[j + 1] + sendR[j] + sendR[j + 1]) * 0.25;
  }
  const wet24 = await convolveChannel(mono, spec, shouldStop);
  const pre = Math.round((style === "ambient" ? 0.028 : 0.016) * SR);
  const coeff = 1 - Math.exp((-2 * Math.PI * 7000) / SR);
  const base = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (i - pre) * 0.5;
    let v = 0;
    if (x >= 0) {
      const j = x | 0;
      const a = j < wet24.length ? wet24[j] : 0;
      const b = j + 1 < wet24.length ? wet24[j + 1] : a;
      v = a + (b - a) * (x - j);
    }
    lp += coeff * (v - lp);
    base[i] = lp * wet;
  }
  const late = new Float32Array(n);
  const d = Math.round(0.011 * SR);
  for (let i = d; i < n; i += 1) late[i] = base[i - d];
  const outL = decorrelate(base, [347, 113], 0.55);
  const outR = decorrelate(late, [419, 151], 0.55);
  // Keep a little of the coherent return so the tail stays centred and solid.
  for (let i = 0; i < n; i += 1) {
    outL[i] = outL[i] * 0.8 + base[i] * 0.35;
    outR[i] = outR[i] * 0.8 + late[i] * 0.35;
  }
  return { L: outL, R: outR };
}

const SEND_LEVELS = {
  ambient: { pad: 1, bass: 0, bell: 1, arp: 0.8, drum: 0.3, lead: 0.9, counter: 0.9 },
  lofi: { pad: 0.85, bass: 0, bell: 0.9, arp: 0.6, drum: 0.32, lead: 0.8, counter: 0.75 },
  arp: { pad: 0.9, bass: 0, bell: 1, arp: 0.75, drum: 0.2, lead: 0.85, counter: 0.8 },
  synthwave: { pad: 0.9, bass: 0, bell: 1, arp: 0.7, drum: 0.28, lead: 0.85, counter: 0.8 },
};

function delaySpec(style, bpm) {
  const beat = 60 / bpm;
  if (style === "synthwave") return { time: beat * 0.75, feedback: 0.38, level: 0.17, hp: 450, lp: 4800 };
  if (style === "arp") return { time: beat * 0.75, feedback: 0.3, level: 0.1, hp: 500, lp: 5200 };
  if (style === "lofi") return { time: beat * 0.5, feedback: 0.22, level: 0.08, hp: 400, lp: 3000 };
  return { time: Math.min(1.2, beat * 1.5), feedback: 0.42, level: 0.13, hp: 400, lp: 3600 };
}

// Per-stem tone and space before the sum (mc-mix-intent §5: low end belongs
// to the bass, sustained parts give way in the 200-500 Hz band).
function shapeStems(style, stems) {
  // Process only the stem's active span (plus a short tail for filter and
  // chorus ring-out); the silent rest of a sparse stem stays exactly zero.
  const run = (pair, fn) => {
    if (!pair) return;
    const [L, R] = pair;
    let first = -1;
    for (let i = 0; i < L.length; i += 1) {
      if (L[i] !== 0 || R[i] !== 0) { first = i; break; }
    }
    if (first < 0) return;
    let last = first;
    for (let i = L.length - 1; i > first; i -= 1) {
      if (L[i] !== 0 || R[i] !== 0) { last = i; break; }
    }
    const end = Math.min(L.length, last + Math.round(0.25 * SR));
    fn(L.subarray(first, end), R.subarray(first, end));
  };
  const lowCut = style === "ambient" ? 115 : 150;
  run(stems.pad, (L, R) => {
    eqPair(L, R, [["hp", lowCut], ["peak", 330, 0.9, -3.5]]);
    chorusPair(L, R, style === "ambient"
      ? { rate: 0.13, base: 0.013, depth: 0.004, mix: 0.45 }
      : style === "synthwave"
        ? { rate: 0.27, base: 0.011, depth: 0.0038, mix: 0.45 }
        : style === "lofi"
          ? { rate: 0.2, base: 0.012, depth: 0.0026, mix: 0.36 }
          : { rate: 0.18, base: 0.012, depth: 0.003, mix: 0.4 });
    widenPair(L, R, 1.5);
  });
  run(stems.counter, (L, R) => {
    eqPair(L, R, [["hp", 170]]);
    widenPair(L, R, 1.35);
  });
  run(stems.lead, (L, R) => eqPair(L, R, [["hp", 180]]));
  run(stems.bell, (L, R) => {
    eqPair(L, R, [["hp", 300]]);
    widenPair(L, R, 1.4);
  });
  run(stems.arp, (L, R) => {
    eqPair(L, R, [["hp", 190]]);
  });
  run(stems.bass, (L, R) => {
    eqPair(L, R, [["hp", 30]]);
    // Upper harmonics so a sine bass still reads on small speakers (mc-sound-design §6).
    saturatePair(L, R, 2.4, style === "ambient" ? 0.22 : 0.32);
    eqPair(L, R, [["lp", style === "synthwave" ? 2600 : style === "arp" ? 2000 : style === "lofi" ? 1600 : 1200]]);
  });
  run(stems.drum, (L, R) => {
    // (Sub-32 Hz rumble is already taken out by the master DC filter.)
    // Drum-bus glue: tame the spikiest hits so the kit sits instead of poking out.
    if (style === "lofi" || style === "synthwave") gluePair(L, R, { thresholdDb: -24, ratio: 2.4, attack: 0.004, release: 0.12 });
  });
}

async function applyReverb(L, R, style, shouldStop) {
  const scale = SR / 44100;
  const tuned = style === "lofi"
    ? { room: 0.28, damp: 0.72, wet: 0.07, pre: Math.round(0.012 * SR), wetFc: 7000 }
    : style === "arp"
      ? { room: 0.62, damp: 0.48, wet: 0.26, pre: Math.round(0.032 * SR), wetFc: 8000 }
      : style === "synthwave"
        ? { room: 0.58, damp: 0.4, wet: 0.22, pre: Math.round(0.028 * SR), wetFc: 9000 }
        : { room: 0.86, damp: 0.64, wet: 0.5, pre: Math.round(0.055 * SR), wetFc: 6200 };
  const combsL = makeCombs(FREEVERB_COMBS.map((d) => Math.round(d * scale)), tuned.room, tuned.damp);
  const combsR = makeCombs(FREEVERB_COMBS.map((d, i) => Math.round(d * scale) + 17 + i), tuned.room, tuned.damp);
  const apL = FREEVERB_ALLPASS.map((d) => ({ buf: new Float32Array(Math.round(d * scale)), idx: 0 }));
  const apR = FREEVERB_ALLPASS.map((d) => ({ buf: new Float32Array(Math.round(d * scale) + 7), idx: 0 }));
  const preL = new Float32Array(tuned.pre + 1);
  const preR = new Float32Array(tuned.pre + 1);
  let preIdx = 0;
  const wetC = 1 - Math.exp((-2 * Math.PI * tuned.wetFc) / SR);
  let wetLpL = 0;
  let wetLpR = 0;
  const n = L.length;
  for (let i = 0; i < n; i += 1) {
    if ((i & 32767) === 0) {
      if (shouldStop && shouldStop()) {
        const err = new Error("Cancelled");
        err.cancelled = true;
        throw err;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    const inL = L[i];
    const inR = R[i];
    const delayedL = preL[preIdx];
    const delayedR = preR[preIdx];
    preL[preIdx] = inL;
    preR[preIdx] = inR;
    preIdx += 1;
    if (preIdx >= preL.length) preIdx = 0;
    let wL = 0;
    let wR = 0;
    for (let c = 0; c < combsL.length; c += 1) {
      wL += combStep(combsL[c], delayedL);
      wR += combStep(combsR[c], delayedR);
    }
    wL *= 0.125;
    wR *= 0.125;
    for (let a = 0; a < apL.length; a += 1) {
      wL = allpassStep(apL[a], wL);
      wR = allpassStep(apR[a], wR);
    }
    wetLpL += wetC * (wL - wetLpL);
    wetLpR += wetC * (wR - wetLpR);
    L[i] = inL + wetLpL * tuned.wet;
    R[i] = inR + wetLpR * tuned.wet;
  }
}

function lowpassPair(L, R, fc) {
  const c = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let l1 = 0;
  let l2 = 0;
  let r1 = 0;
  let r2 = 0;
  for (let i = 0; i < L.length; i += 1) {
    l1 += c * (L[i] - l1);
    l2 += c * (l1 - l2);
    r1 += c * (R[i] - r1);
    r2 += c * (r1 - r2);
    L[i] = l2;
    R[i] = r2;
  }
}

function tapeWow(L, R) {
  const n = L.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const base = 0.0022 * SR;
  const depth = 0.00045 * SR;
  for (let i = 0; i < n; i += 1) {
    const d = base + depth * Math.sin((2 * Math.PI * 0.5 * i) / SR);
    const j = i - d;
    const i0 = j <= 0 ? 0 : Math.floor(j);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = j <= 0 ? 0 : j - i0;
    outL[i] = L[i0] * (1 - f) + L[i1] * f;
    outR[i] = R[i0] * (1 - f) + R[i1] * f;
  }
  L.set(outL);
  R.set(outR);
}

function softCompress(L, R) {
  const atk = Math.exp(-1 / (0.015 * SR));
  const rel = Math.exp(-1 / (0.16 * SR));
  const thresh = 0.22;
  const knee = 0.07;
  const ratio = 2.2;
  const kneeStart = thresh - knee;
  const kneeEnd = thresh + knee;
  // Quadratic meets unity gain and the hard-knee slope at both edges.
  const quad = (1 / ratio - 1) / (4 * knee);
  let env = 0;
  for (let i = 0; i < L.length; i += 1) {
    const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    env = x > env ? atk * env + (1 - atk) * x : rel * env + (1 - rel) * x;
    let gain = 1;
    if (env >= kneeEnd) {
      gain = (thresh + (env - thresh) / ratio) / env;
    } else if (env > kneeStart) {
      const u = env - kneeStart;
      const y = quad * u * u + u + kneeStart;
      gain = y / env;
    }
    L[i] *= gain;
    R[i] *= gain;
  }
}

// Macro dynamics (mc-arrangement-arch: the arc should be heard, not only
// seen in the layer plan): ride the whole mix a few dB with the bar energy,
// interpolated between bar centres, so the build and the climax open up and
// the intro and release sit back. The voice rides with it, so it stays on top.
function macroDynamics(L, R, energy, bar, style) {
  if (!energy || energy.length < 2 || !(bar > 0)) return;
  const range = style === "ambient" || style === "lofi" ? 4 : style === "arp" ? 3.5 : 3;
  const gains = energy.map((e) => 10 ** ((-range * (1 - clamp(e, 0, 1))) / 20));
  const n = L.length;
  const barN = bar * SR;
  for (let i = 0; i < n; i += 1) {
    const x = i / barN - 0.5;
    const a = clamp(Math.floor(x), 0, gains.length - 1);
    const b = clamp(a + 1, 0, gains.length - 1);
    const f = clamp(x - Math.floor(x), 0, 1);
    const w = f * f * (3 - 2 * f);
    const g = gains[a] * (1 - w) + gains[b] * w;
    L[i] *= g;
    R[i] *= g;
  }
}

function finishBuffer(L, R, analysis, style) {
  const n = L.length;
  const frames = analysis.frames;
  const fps = analysis.fps || ANALYZE_FPS;
  let prevL = 0;
  let prevR = 0;
  let hpL = 0;
  let hpR = 0;
  const dc = 0.995;
  for (let i = 0; i < n; i += 1) {
    let mot = 0;
    if (frames.length) {
      const x = (i / SR) * fps;
      const a = clamp(Math.floor(x), 0, frames.length - 1);
      const b = clamp(a + 1, 0, frames.length - 1);
      const f = x - Math.floor(x);
      mot = normMotion(frames[a].motion) * (1 - f) + normMotion(frames[b].motion) * f;
    }
    const swell = 0.94 + 0.06 * mot;
    const xL = L[i] * swell;
    const xR = R[i] * swell;
    hpL = dc * (hpL + xL - prevL);
    hpR = dc * (hpR + xR - prevR);
    prevL = xL;
    prevR = xR;
    L[i] = hpL;
    R[i] = hpR;
  }
  // Flat-passband roll-off (the old one-pole pair cost 2 dB an octave below it),
  // a broad low-mid trim and a little air (mc-mix-intent §4.1 frequency balance).
  const rolloff = style === "synthwave" ? 16000 : style === "lofi" ? 11000 : style === "arp" ? 14500 : 13000;
  const air = style === "synthwave" ? 2.5 : style === "arp" ? 3 : style === "lofi" ? 2.5 : 2.5;
  const mudCut = style === "arp" ? -4.5 : style === "synthwave" ? -2 : style === "ambient" ? -3.5 : -2.5;
  const scoop = style === "ambient" ? -3 : style === "arp" ? -3.5 : style === "lofi" ? -3.5 : -1.5;
  const warmth = style === "ambient" ? 1.5 : 0;
  eqPair(L, R, [["lp", rolloff], ["lowshelf", 120, 0.7, warmth], ["peak", 380, 0.6, mudCut], ["peak", 850, 0.8, scoop], ["highshelf", 5500, 0.7, air]]);
  if (style === "lofi") tapeWow(L, R);
  let peak = 1e-8;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const pre = 0.42 / peak;
  for (let i = 0; i < n; i += 1) {
    L[i] *= pre;
    R[i] *= pre;
  }
  // Mix-bus glue before the existing soft compressor.
  gluePair(L, R, { thresholdDb: -17, ratio: 1.45, attack: 0.03, release: 0.3 });
  softCompress(L, R);
  // Tape-style warmth where the style wants it.
  const drive = style === "lofi" ? 1.35 : style === "synthwave" ? 1.3 : 1.15;
  const norm = Math.tanh(drive);
  const fadeIn = Math.min(n, Math.round((style === "ambient" ? 0.12 : 0.03) * SR));
  const fadeOut = Math.min(n, Math.round((style === "ambient" ? 0.7 : 0.5) * SR));
  let outPeak = 1e-8;
  for (let i = 0; i < n; i += 1) {
    let sL = Math.tanh(L[i] * drive) / norm;
    let sR = Math.tanh(R[i] * drive) / norm;
    if (i < fadeIn) {
      const g = Math.sin((i / fadeIn) * Math.PI * 0.5);
      sL *= g;
      sR *= g;
    }
    if (i >= n - fadeOut) {
      const g = Math.cos(((i - (n - fadeOut)) / fadeOut) * Math.PI * 0.5);
      sL *= g;
      sR *= g;
    }
    L[i] = sL;
    R[i] = sR;
    outPeak = Math.max(outPeak, Math.abs(sL), Math.abs(sR));
  }
  const ceiling = 0.45 / outPeak;
  for (let i = 0; i < n; i += 1) {
    L[i] *= ceiling;
    R[i] *= ceiling;
  }
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

function stopped(shouldStop) {
  if (shouldStop && shouldStop()) {
    const err = new Error("Cancelled");
    err.cancelled = true;
    throw err;
  }
}

async function yieldNow() {
  await new Promise((resolve) => setImmediate(resolve));
}

// Same notes the renderer plays. Lyrics fitting calls this and does not synthesize.
export function arrangeScore(analysis, style) {
  const safeStyle = style === "lofi" || style === "arp" || style === "synthwave" ? style : "ambient";
  const genome = buildGenome(analysis, safeStyle);
  const fp = fingerprintOf(analysis);
  const seed = fp.seed;
  const rng = rngFor(seed, `${safeStyle}:bells`);
  const key = genome.key;
  const plan = scheduleChords(analysis, key, safeStyle, genome);
  const bells = scheduleBells(analysis, key, safeStyle, rng, plan);
  const lines = composeLines({ analysis, key, plan, seed, style: safeStyle });
  let bassline = [];
  const beats = plan.meter?.beats || 4;
  if (safeStyle === "lofi") bassline = walkBass(plan.chords, plan.bpm, key, plan.sections, beats);
  else if (safeStyle === "synthwave") bassline = pulseBass(plan.chords, plan.bpm, plan.sections, plan.meter);
  fixParallel(lines.lead, lines.counter, safeStyle === "synthwave" ? [] : bassline);
  settleStrong(lines.lead, lines.counter, plan.chords);
  keepContour(lines.lead, key, plan.chords, plan.meter?.barLen || (240 / plan.bpm), safeStyle);
  smoothLeaps(lines.lead);
  let clashes = clearClashes(lines.lead, lines.counter, plan.chords, bassline, key, safeStyle, plan.sections);
  const modulations = applyModulation({ safeStyle, key, plan, bells, lines, bassline, genome, duration: analysis.duration });
  if (modulations.length) {
    smoothLeaps(lines.lead);
    clashes = clearClashes(lines.lead, lines.counter, plan.chords, bassline, key, safeStyle, plan.sections);
  }
  for (const chord of plan.chords) chord.notes = openVoicing(chord.notes);
  return { safeStyle, seed, rng, key, plan, bells, lines, bassline, clashes, genome, modulations };
}

// Open the pad voicing (mc-orchestration §4.1, low-interval limits): close
// four-note shapes become drop-2, and nothing narrower than a fifth below G3 or
// a fourth below C4, so the 200-500 Hz band stays clear for the bass and voice.
function openVoicing(notes) {
  let v = [...new Set(notes)].sort((a, b) => a - b);
  if (v.length < 2) return v;
  if (v.length >= 4 && v[v.length - 1] - v[0] <= 12) {
    const i = v.length - 2;
    const dropped = v[i] - 12;
    if (dropped >= 47 && !v.includes(dropped)) {
      v.splice(i, 1);
      v.push(dropped);
      v.sort((a, b) => a - b);
    }
  }
  for (let guard = 0; guard < 6 && v.length >= 2; guard += 1) {
    const [a, b] = v;
    const need = a < 55 ? 7 : a < 60 ? 5 : 3;
    if (b - a >= need) break;
    if (a + 12 <= 86 && !v.includes(a + 12)) v[0] = a + 12;
    else if (b + 12 <= 86 && !v.includes(b + 12)) v[1] = b + 12;
    else v.shift();
    v = [...new Set(v)].sort((p, q) => p - q);
  }
  return v;
}

function foldMidi(midi, lo, hi) {
  let m = Math.round(midi);
  let guard = 0;
  while (m > hi && guard < 8) { m -= 12; guard += 1; }
  while (m < lo && guard < 16) { m += 12; guard += 1; }
  return m;
}

function shiftVoicing(notes, semis, lo, hi) {
  if (!notes.length) return notes;
  let voiced = notes.map((m) => m + semis);
  let guard = 0;
  while (Math.max(...voiced) > hi && guard < 5) { voiced = voiced.map((m) => m - 12); guard += 1; }
  while (Math.min(...voiced) < lo && guard < 10) { voiced = voiced.map((m) => m + 12); guard += 1; }
  return [...new Set(voiced.map((m) => foldMidi(m, lo, hi)))].sort((a, b) => a - b);
}

function trimAcross(note, t0) {
  const dur = note.dur || 0;
  if (!(note.t < t0 - 0.001)) return;
  const end = note.t + dur;
  if (end <= t0 - 0.012) return;
  const room = t0 - note.t - 0.025;
  if (room >= 0.05) {
    note.dur = Math.round(Math.min(dur, room) * 1000) / 1000;
    return;
  }
  note.t = Math.round(t0 * 1000) / 1000;
  note.dur = Math.round(Math.max(0.06, end - t0) * 1000) / 1000;
}

const MOD_SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

// Pick what kind of key change a scene change deserves (mc-modulation §4, §6):
// a lift at the climax, the relative key when the picture brightens or darkens,
// the dominant or subdominant for a plain change of scene, a step down for
// weight, and only rarely a chromatic mediant or the semitone "truck driver".
function chooseModKind(mod, key, genome, plan, style, duration) {
  const beat = 60 / plan.bpm;
  const bar = plan.meter?.barLen || beat * 4;
  const climaxT = genome?.climaxT ?? -99;
  const nearClimax = Math.abs(mod.t - climaxT) <= bar * 1.6 && climaxT >= duration * 0.45;
  const relativeOk = key.mode === "major" || key.mode === "minor";
  const bag = [];
  if (nearClimax) {
    bag.push(["lift-step", 2, "dominant", 3]);
    bag.push(["lift-third", 3, "dominant", 2]);
    bag.push(["truck", 1, "truck", style === "synthwave" ? 1.1 : 0.5]);
  }
  if (mod.brighter > 0) {
    if (relativeOk && key.mode === "minor") bag.push(["relative", 3, "pivot", 3.5]);
    bag.push(["up-step", 2, "dominant", 2]);
    bag.push(["dominant", 7, "pivot", 2]);
  } else if (mod.brighter < 0) {
    if (relativeOk && key.mode === "major") bag.push(["relative", -3, "pivot", 3.5]);
    bag.push(["down-step", -2, "pivot", 2]);
    bag.push(["subdominant", 5, "pivot", 2]);
  } else {
    bag.push(["dominant", 7, "pivot", 2]);
    bag.push(["subdominant", 5, "pivot", 2]);
    bag.push(["up-step", 2, "dominant", 1]);
    if (relativeOk) bag.push(["relative", key.mode === "major" ? -3 : 3, "pivot", 1.5]);
  }
  if (mod.score >= 1.1) bag.push(["mediant", mod.dir > 0 ? 4 : -4, "direct", style === "ambient" ? 1.2 : 0.45]);
  const total = bag.reduce((sum, item) => sum + item[3], 0);
  let x = (mod.pick ?? 0.5) * total;
  let chosen = bag[bag.length - 1];
  for (const item of bag) {
    x -= item[3];
    if (x <= 0) { chosen = item; break; }
  }
  let [kind, semis, method] = chosen;
  let t = mod.t;
  // A direct change wants a section seam; without one, announce it with a V7.
  if (method === "direct") {
    const seam = (plan.sections || []).map((section) => section.t0)
      .filter((t0) => t0 > bar && t0 < duration - bar)
      .sort((p, q) => Math.abs(p - t) - Math.abs(q - t))[0];
    if (seam != null && Math.abs(seam - t) <= bar * 1.01) t = seam;
    else method = "dominant";
  }
  if (method === "pivot" && (mod.flavour ?? 0) < 0.3) method = "dominant";
  const toMode = kind === "relative" ? (key.mode === "major" ? "minor" : "major") : key.mode;
  return { kind, semis, method, toMode, t };
}

function modScaleOf(pc, mode) {
  return (MOD_SCALES[mode] || MOD_SCALES[mode === "harmonicMinor" ? "minor" : "major"] || MOD_SCALES.major)
    .map((semi) => pcOf(pc + semi));
}

// Move a pitch k diatonic steps inside a scale; chromatic notes keep their offset.
function diatonicShift(midi, scale, k) {
  let offset = 0;
  while (offset < 11 && !scale.includes(pcOf(midi - offset))) offset += 1;
  const base = midi - offset;
  const ladder = [];
  for (let m = 0; m < 140; m += 1) if (scale.includes(pcOf(m))) ladder.push(m);
  const index = ladder.indexOf(base);
  const target = ladder[clamp(index + k, 0, ladder.length - 1)];
  return target + offset;
}

function prepVoicing(pcs, around, count) {
  const centre = around.length ? around.reduce((sum, m) => sum + m, 0) / around.length : 60;
  const lo = Math.max(45, Math.round(centre - 9));
  const out = [];
  const rootPc = pcs[0];
  let root = lo + pcOf(rootPc - lo);
  out.push(root);
  for (let i = 1; i < pcs.length; i += 1) {
    let m = root + pcOf(pcs[i] - root);
    if (m - out[out.length - 1] < 3 && i === 1) m += 12;
    out.push(m);
  }
  while (out.length < count) out.push(out[out.length - 4 >= 0 ? out.length - 4 : 0] + 12);
  return [...new Set(out)].sort((p, q) => p - q).slice(0, Math.max(3, count));
}

function prepChord(base, t0, t1, rootPc, quality, spell = null) {
  const pcs = quality === "7"
    ? [rootPc, rootPc + 4, rootPc + 7, rootPc + 10]
    : quality === "m7"
      ? [rootPc, rootPc + 3, rootPc + 7, rootPc + 10]
      : [rootPc, rootPc + 4, rootPc + 7, rootPc + 11];
  const notes = prepVoicing(pcs.map(pcOf), base.notes, base.notes.length);
  const flat = preferFlat(rootPc);
  return {
    ...base,
    t0,
    t1,
    id: quality === "7" ? "V7/new" : "pivot",
    notes,
    rootPc: pcOf(rootPc),
    bassPc: null,
    name: `${spell ? spell(rootPc) : spellPc(rootPc, flat)}${quality === "maj7" ? "maj7" : quality}`,
  };
}

function applyModulation(bundle) {
  const mod = bundle.genome?.modulation;
  if (!mod || !Number.isFinite(mod.t)) return [];
  const key = bundle.key;
  const style = bundle.safeStyle;
  const plan = bundle.plan;
  const duration = bundle.duration || plan.chords[plan.chords.length - 1]?.t1 || 0;
  const choice = chooseModKind(mod, key, bundle.genome, plan, style, duration);
  const t0 = choice.t;
  const semis = choice.semis;
  const toPc = pcOf(key.pc + semis);
  // Spell from the new key's signature: flats for F/Bb/Eb/Ab/Db (and their relatives), else sharps.
  const majorPc = choice.toMode === "minor" ? pcOf(toPc + 3) : toPc;
  const flatTo = [5, 10, 3, 8, 1].includes(majorPc);
  const spellTo = (pc) => (pcOf(pc) === 6 && !flatTo ? "F#" : spellPc(pc, flatTo));
  const title = { major: "major", minor: "minor", lydian: "Lydian", mixolydian: "Mixolydian", dorian: "Dorian", phrygian: "Phrygian", harmonicMinor: "harmonic minor" };
  const from = key.name;
  const to = `${spellTo(toPc)} ${title[choice.toMode] || choice.toMode}`;
  key.mod = { t: t0, semis, toPc, to, from, toMode: choice.toMode, kind: choice.kind, method: choice.method };
  const beat = 60 / plan.bpm;

  // Split the chord sounding across t0 so the change lands on the downbeat.
  const chords = plan.chords;
  for (let i = 0; i < chords.length; i += 1) {
    const c = chords[i];
    if (c.t0 < t0 - 0.01 && c.t1 > t0 + 0.01) {
      chords.splice(i + 1, 0, { ...c, t0, notes: c.notes.slice() });
      c.t1 = t0;
      break;
    }
  }

  const leadLo = style === "lofi" ? 71 : 69;
  const leadHi = style === "lofi" ? 83 : style === "synthwave" ? 86 : 88;
  for (const note of bundle.lines.lead) trimAcross(note, t0);
  for (const note of bundle.lines.counter) trimAcross(note, t0);
  for (const note of bundle.bassline) trimAcross(note, t0);
  for (const bell of bundle.bells) trimAcross(bell, t0);
  const after = (x) => x >= t0 - 0.001;
  if (choice.kind === "relative") {
    // Same notes, new centre: everything after the seam moves a third inside the scale.
    const scale = modScaleOf(key.pc, key.mode);
    const k = key.mode === "major" ? -2 : 2;
    const move = (midi, lo, hi) => foldMidi(diatonicShift(midi, scale, k), lo, hi);
    for (const note of bundle.lines.lead) if (after(note.t)) note.midi = move(note.midi, leadLo, leadHi);
    for (const note of bundle.lines.counter) if (after(note.t)) note.midi = move(note.midi, style === "synthwave" ? 52 : 50, 69);
    for (const note of bundle.bassline) if (after(note.t)) note.midi = bassMidiOf(pcOf(diatonicShift(note.midi, scale, k)));
    for (const chord of chords) {
      if (!after(chord.t0)) continue;
      const moved = chord.notes.map((m) => diatonicShift(m, scale, k));
      chord.notes = shiftVoicing(moved, 0, 40, 76);
      chord.rootPc = pcOf(diatonicShift(chord.rootPc + 60, scale, k));
      if (chord.bassPc != null) chord.bassPc = pcOf(diatonicShift(chord.bassPc + 60, scale, k));
      chord.name = `${spellTo(chord.rootPc)}${honestSymbol(chord.notes, chord.rootPc)}`;
    }
    for (const bell of bundle.bells) if (after(bell.t)) bell.midi = move(bell.midi, 72, 96);
  } else {
    for (const note of bundle.lines.lead) if (after(note.t)) note.midi = foldMidi(note.midi + semis, leadLo, leadHi);
    for (const note of bundle.lines.counter) if (after(note.t)) note.midi = foldMidi(note.midi + semis, style === "synthwave" ? 52 : 50, 69);
    for (const note of bundle.bassline) if (after(note.t)) note.midi = bassMidiOf(pcOf(note.midi + semis));
    for (const chord of chords) {
      if (!after(chord.t0)) continue;
      chord.notes = shiftVoicing(chord.notes, semis, 40, 76);
      chord.rootPc = pcOf(chord.rootPc + semis);
      if (chord.bassPc != null) chord.bassPc = pcOf(chord.bassPc + semis);
      const suf = String(chord.name || "").replace(/^[A-G](#|b)?/, "");
      chord.name = `${spellTo(chord.rootPc)}${suf}`;
    }
    for (const bell of bundle.bells) if (after(bell.t)) bell.midi = foldMidi(bell.midi + semis, 72, 96);
  }

  // Arrive on the new tonic (or its ii/IV entry) across the seam.
  const landIndex = chords.findIndex((c) => c.t0 >= t0 - 0.01);
  if (landIndex >= 0) {
    const land = chords[landIndex];
    const newScale = modScaleOf(toPc, choice.toMode);
    const okRoots = [toPc, newScale[1], newScale[3]];
    if (!okRoots.includes(land.rootPc)) {
      const barLen = plan.meter?.barLen || beat * 4;
      const end = Math.min(land.t1, t0 + barLen);
      if (land.t1 > end + 0.05) chords.splice(landIndex + 1, 0, { ...land, t0: end, notes: land.notes.slice() });
      const third = choice.toMode === "minor" || choice.toMode === "dorian" || choice.toMode === "phrygian" ? 3 : 4;
      const pcs = [toPc, pcOf(toPc + third), pcOf(toPc + 7), newScale[1]];
      const notes = prepVoicing(pcs, land.notes, land.notes.length);
      chords[landIndex] = { ...land, t0, t1: end, notes, rootPc: toPc, bassPc: null, id: "I/new",
        name: `${spellTo(toPc)}${honestSymbol(notes, toPc)}` };
      for (const note of bundle.bassline) {
        if (note.t < t0 - 0.001 || note.t >= end - 0.001) continue;
        const pc = pcOf(note.midi);
        if (Math.abs(note.t - t0) < 0.01 || ![toPc, pcOf(toPc + third), pcOf(toPc + 7)].includes(pc)) note.midi = bassMidiOf(toPc);
      }
    }
  }

  // Prepare it (mc-modulation §3): a V7 of the new key in the last beats, and for
  // a pivot, a chord both keys share just before that.
  const prep = [];
  const prevIndex = chords.findIndex((c) => c.t1 >= t0 - 0.01 && c.t0 < t0 - 0.01);
  if (prevIndex >= 0 && (choice.method === "dominant" || choice.method === "pivot")) {
    const c = chords[prevIndex];
    const room = t0 - c.t0;
    const vLen = Math.min(beat * 2, room <= beat * 1.5 ? room : room / 2);
    const domRoot = pcOf(toPc + 7);
    const pieces = [];
    if (choice.method === "pivot" && room >= beat * 3.5) {
      const oldScale = modScaleOf(key.pc, key.mode);
      const newScale = modScaleOf(toPc, choice.toMode);
      // ii of the new key if both keys contain it, else IV, else skip the pivot.
      const cands = [[newScale[1], choice.toMode === "minor" ? "m7" : "m7"], [newScale[3], choice.toMode === "minor" ? "m7" : "maj7"]];
      const fits = (root, q) => {
        const pcs = q === "m7" ? [0, 3, 7, 10] : [0, 4, 7, 11];
        return pcs.every((d) => oldScale.includes(pcOf(root + d)) && newScale.includes(pcOf(root + d)));
      };
      const pivot = cands.find(([root, q]) => fits(root, q));
      if (pivot) pieces.push([t0 - vLen * 2, t0 - vLen, pivot[0], pivot[1]]);
    }
    pieces.push([t0 - vLen, t0, domRoot, "7"]);
    const first = pieces[0][0];
    if (first > c.t0 + 0.05) {
      c.t1 = first;
      const made = pieces.map(([a, b, root, q]) => prepChord(c, a, b, root, q, spellTo));
      chords.splice(prevIndex + 1, 0, ...made);
      prep.push(...made.map((m) => m.name));
    } else {
      const made = pieces.slice(-1).map(([, b, root, q]) => prepChord(c, c.t0, b, root, q, spellTo));
      chords.splice(prevIndex, 1, ...made);
      prep.push(...made.map((m) => m.name));
    }
    // Walking/pulse bass follows the preparation roots.
    for (const note of bundle.bassline) {
      if (note.t < first - 0.001 || note.t >= t0 - 0.001) continue;
      const ch = chords.find((x) => note.t >= x.t0 - 0.001 && note.t < x.t1 - 0.001);
      if (ch && (ch.id === "V7/new" || ch.id === "pivot")) note.midi = bassMidiOf(ch.rootPc);
    }
  }
  return [{
    t: Math.round(t0 * 1000) / 1000,
    from,
    to,
    semis,
    kind: choice.kind,
    method: choice.method,
    prep,
  }];
}

export function fitLyrics(analysis, style, lyrics, oohaah) {
  const arranged = arrangeScore(analysis, style);
  const perf = planPerformance({
    lead: arranged.lines.lead,
    chords: arranged.plan.chords,
    bassline: arranged.bassline,
    key: arranged.key,
    sections: arranged.plan.sections,
    style: arranged.safeStyle,
    duration: analysis.duration,
    lyrics,
    lyricsOn: true,
    oohaah: Boolean(oohaah),
  });
  return {
    coverage: perf.coverage,
    unsungPct: perf.unsungPct,
    syllables: perf.syllables,
    sung: perf.sung,
    lines: perf.lines,
  };
}


// Lead-vocal placement (reviewer pass). The formant voice used to be summed at
// a fixed gain and sat level with, or under, the backing in the vocal band, so
// it read as one more synth. Now: presence EQ on the voice, the backing ducks
// about 3.5 dB while a lyric is sung, and the voice gain is set from the
// measured 200-3000 Hz energy so a sung lyric sits about 6 dB over the
// backing (a wordless choir about 1 dB under it, with a 1.5 dB duck). Most of the voice is added
// dry after the room so the consonants stay crisp.
const VOCAL_OVER_BACKING_DB = 6;
const CHOIR_UNDER_BACKING_DB = -1;
const CHOIR_DUCK_DB = 1.5;
const VOCAL_DUCK_DB = 3.5;

function biquadRun(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    let v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    if (v < 1e-20 && v > -1e-20) v = 0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

function biquad(type, f, q, gainDb = 0) {
  const w = (2 * Math.PI * f) / SR;
  const c = Math.cos(w);
  const a = Math.sin(w) / (2 * q);
  let b0; let b1; let b2; let a0; let a1; let a2;
  if (type === "peak") {
    const A = 10 ** (gainDb / 40);
    b0 = 1 + a * A; b1 = -2 * c; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * c; a2 = 1 - a / A;
  } else if (type === "hp") {
    b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a;
  } else {
    b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a;
  }
  return (x) => biquadRun(x, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function vocalBand(x) {
  const hp = biquad("hp", 200, 0.7071);
  const lp = biquad("lp", 3000, 0.7071);
  return lp(lp(hp(hp(x))));
}

// Intelligibility band (formants F2/F3 and consonants): where the voice must win.
function presenceBand(x) {
  const hp = biquad("hp", 900, 0.7071);
  const lp = biquad("lp", 4200, 0.7071);
  return lp(lp(hp(hp(x))));
}

// 900-4200 Hz RMS inside the windows only, measured at half rate (pairs
// averaged) with a 30 ms filter warm-up per window. Same answer as
// windowRms(presenceBand(mono)) to a fraction of a dB, for a fraction of the cost.
function presenceRmsFast(L, R, windows) {
  const sr = SR / 2;
  const coefs = (type, f) => {
    const w = (2 * Math.PI * f) / sr;
    const c = Math.cos(w);
    const a = Math.sin(w) / (2 * 0.7071);
    const a0 = 1 + a;
    return type === "hp"
      ? [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - a) / a0]
      : [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - a) / a0];
  };
  const [h0, h1, h2, h3, h4] = coefs("hp", 900);
  const [l0, l1, l2, l3, l4] = coefs("lp", 4200);
  let sum = 0;
  let count = 0;
  const warm = Math.round(0.03 * sr);
  const half = Math.floor(L.length / 2);
  for (const [t0, t1] of windows) {
    const a = Math.max(0, Math.floor(t0 * sr) - warm);
    const b = Math.min(half, Math.ceil(t1 * sr));
    if (b <= a) continue;
    let ax1 = 0; let ax2 = 0; let ay1 = 0; let ay2 = 0;
    let bx1 = 0; let bx2 = 0; let by1 = 0; let by2 = 0;
    let cx1 = 0; let cx2 = 0; let cy1 = 0; let cy2 = 0;
    let dx1 = 0; let dx2 = 0; let dy1 = 0; let dy2 = 0;
    const from = a === 0 ? 0 : a + warm;
    for (let j = a; j < b; j += 1) {
      const i2 = j * 2;
      const x = (L[i2] + R[i2] + L[i2 + 1] + R[i2 + 1]) * 0.25;
      const y1 = h0 * x + h1 * ax1 + h2 * ax2 - h3 * ay1 - h4 * ay2;
      ax2 = ax1; ax1 = x; ay2 = ay1; ay1 = y1;
      const y2 = h0 * y1 + h1 * bx1 + h2 * bx2 - h3 * by1 - h4 * by2;
      bx2 = bx1; bx1 = y1; by2 = by1; by1 = y2;
      const y3 = l0 * y2 + l1 * cx1 + l2 * cx2 - l3 * cy1 - l4 * cy2;
      cx2 = cx1; cx1 = y2; cy2 = cy1; cy1 = y3;
      const y4 = l0 * y3 + l1 * dx1 + l2 * dx2 - l3 * dy1 - l4 * dy2;
      dx2 = dx1; dx1 = y3; dy2 = dy1; dy1 = y4;
      if (j >= from) {
        sum += y4 * y4;
        count += 1;
      }
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function windowRms(x, windows) {
  let sum = 0;
  let count = 0;
  for (const [t0, t1] of windows) {
    const a = Math.max(0, Math.floor(t0 * SR));
    const b = Math.min(x.length, Math.ceil(t1 * SR));
    for (let i = a; i < b; i += 1) sum += x[i] * x[i];
    count += Math.max(0, b - a);
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function activityEnvelope(n, windows, attack, release) {
  const env = new Float32Array(n);
  for (const [t0, t1] of windows) {
    const a = Math.max(0, Math.floor((t0 - 0.05) * SR));
    const b = Math.min(n, Math.ceil((t1 + 0.1) * SR));
    for (let i = a; i < b; i += 1) env[i] = 1;
  }
  const up = 1 - Math.exp(-1 / (attack * SR));
  const down = 1 - Math.exp(-1 / (release * SR));
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    y += (env[i] > y ? up : down) * (env[i] - y);
    env[i] = y;
  }
  return env;
}

// muteVoiceForTest keeps the ducking but drops the voice, so a test can
// subtract two otherwise identical mixes. The server never sets it.
function vocalLift(L, R, voiceMix, perf, style) {
  const rows = perf.phonemes || [];
  const singer = rows.filter((row) => row.role === "singer").map((row) => [row.t, row.t1 ?? row.t + 0.3]);
  const choir = (perf.choir || []).map((note) => [note.t, note.t + note.dur]);
  const raw = (singer.length ? singer : choir).slice().sort((p, q) => p[0] - q[0]);
  // Phoneme rows overlap; merge them so each sample is measured once.
  const windows = [];
  for (const [t0, t1] of raw) {
    const last = windows[windows.length - 1];
    if (last && t0 <= last[1] + 0.02) last[1] = Math.max(last[1], t1);
    else windows.push([t0, t1]);
  }
  if (!windows.length || !(voiceMix.report.gain > 0)) return 1;
  // Saw-pad synthwave is dense in the presence band; the words need a bit more.
  const target = singer.length ? VOCAL_OVER_BACKING_DB + 3 + (style === "synthwave" ? 1.5 : 0) : CHOIR_UNDER_BACKING_DB + 3.5;
  const v = presenceRmsFast(voiceMix.dryL, voiceMix.dryR, windows);
  const b = presenceRmsFast(L, R, windows);
  if (!(v > 0) || !(b > 0)) return 1;
  const now = 20 * Math.log10(v / b);
  return Math.min(10 ** (12 / 20), Math.max(1, 10 ** ((target - now) / 20)));
}

function placeVocal(L, R, voiceL, voiceR, perf, alone, mute = false, bus = null) {
  const n = L.length;
  const rows = perf.phonemes || [];
  const singer = rows.filter((row) => row.role === "singer").map((row) => [row.t, row.t1 ?? row.t + 0.3]);
  const choir = (perf.choir || []).map((note) => [note.t, note.t + note.dur]);
  // Presence: trim the low end, lift the 2.5-3.5 kHz consonant band.
  const hp = biquad("hp", 140, 0.7071);
  const presence = biquad("peak", 3000, 0.9, 5);
  const body = biquad("peak", 1200, 0.8, 1.5);
  const vL = body(presence(hp(voiceL)));
  const vR = body(presence(hp(voiceR)));
  const duckTo = 10 ** (-VOCAL_DUCK_DB / 20);
  // Duck the backing wherever the voice sings: fully under lyrics, lightly
  // under a choir-only passage.
  const choirOnly = choir.filter(([t0, t1]) => !singer.some(([s0, s1]) => s0 < t1 && s1 > t0));
  const envSing = singer.length ? activityEnvelope(n, singer, 0.04, 0.25) : null;
  const envChoir = choirOnly.length ? activityEnvelope(n, choirOnly, 0.08, 0.3) : null;
  const choirTo = 10 ** (-CHOIR_DUCK_DB / 20);
  if (envSing || envChoir) {
    // A vocal pocket: the backing yields about 5 dB around 2.5 kHz while the words are sung.
    // Filtered only over the runs where a voice is active (20 ms warm-up each).
    const pocket = biquad("peak", 2500, 0.8, 9);
    const k = 0.45 / (10 ** (9 / 20) - 1);
    const envAt = (i) => Math.max(envSing ? envSing[i] : 0, envChoir ? envChoir[i] * 0.7 : 0);
    const warm = Math.round(0.02 * SR);
    let i = 0;
    while (i < n) {
      if (envAt(i) <= 1e-5) { i += 1; continue; }
      let j = i;
      while (j < n && envAt(j) > 1e-5) j += 1;
      const a = Math.max(0, i - warm);
      const segL = L.slice(a, j);
      const segR = R.slice(a, j);
      const bpL = pocket(segL);
      const bpR = pocket(segR);
      for (let x = i; x < j; x += 1) {
        const e = envAt(x) * k;
        L[x] -= (bpL[x - a] - segL[x - a]) * e;
        R[x] -= (bpR[x - a] - segR[x - a]) * e;
      }
      i = j;
    }
  }
  if (envSing || envChoir) {
    for (let i = 0; i < n; i += 1) {
      const a = envSing ? (1 - duckTo) * envSing[i] : 0;
      const b = envChoir ? (1 - choirTo) * envChoir[i] : 0;
      const g = 1 - Math.max(a, b);
      L[i] *= g;
      R[i] *= g;
      if (bus) {
        bus.sendL[i] *= g;
        bus.sendR[i] *= g;
        bus.dlyL[i] *= g;
        bus.dlyR[i] *= g;
      }
    }
  }
  const monoOf = (a, b) => {
    const m = new Float32Array(n);
    for (let i = 0; i < n; i += 1) m[i] = (a[i] + b[i]) * 0.5;
    return m;
  };
  const windows = singer.length ? singer : choir;
  const target = singer.length ? VOCAL_OVER_BACKING_DB : CHOIR_UNDER_BACKING_DB;
  const vBand = windowRms(vocalBand(monoOf(vL, vR)), windows);
  const bBand = windowRms(vocalBand(monoOf(L, R)), windows);
  const before = vBand > 0 && bBand > 0 ? 20 * Math.log10(vBand / bBand) : null;
  // 1.3 = the dry share (1.0) plus the part that feeds the room (0.3).
  let gain = before == null ? 1 : 10 ** ((target - before) / 20) / 1.3;
  gain = Math.max(0.25, Math.min(8, gain));
  const applied = mute ? 0 : gain;
  const send = 0.3 * applied;
  if (alone) {
    L.fill(0);
    R.fill(0);
    if (bus) {
      bus.sendL.fill(0);
      bus.sendR.fill(0);
      bus.dlyL.fill(0);
      bus.dlyR.fill(0);
    }
  }
  const roomL = bus ? bus.sendL : L;
  const roomR = bus ? bus.sendR : R;
  for (let i = 0; i < n; i += 1) {
    roomL[i] += vL[i] * send;
    roomR[i] += vR[i] * send;
  }
  const dryL = new Float32Array(n);
  const dryR = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    dryL[i] = vL[i] * applied;
    dryR[i] = vR[i] * applied;
  }
  return {
    dryL,
    dryR,
    report: {
      role: singer.length ? "lyrics" : "choir",
      bandBeforeDb: before == null ? null : Math.round(before * 10) / 10,
      targetDb: target,
      gain: Math.round(gain * 1000) / 1000,
      duckDb: singer.length ? VOCAL_DUCK_DB : CHOIR_DUCK_DB,
    },
  };
}

export async function renderMusic({ analysis, style, outFile, shouldStop, stem = null, lyrics = "", lyricsOn = false, oohaah = false, muteVoiceForTest = false }) {
  stopped(shouldStop);
  const arranged = arrangeScore(analysis, style);
  const { safeStyle, seed, rng, key, plan, bells, lines, bassline, clashes, genome } = arranged;
  const n = Math.max(1, Math.round(analysis.duration * SR));
  const padL = new Float32Array(n);
  const padR = new Float32Array(n);
  const bassL = new Float32Array(n);
  const bassR = new Float32Array(n);
  const bellL = new Float32Array(n);
  const bellR = new Float32Array(n);
  const arpL = new Float32Array(n);
  const arpR = new Float32Array(n);
  const drumL = new Float32Array(n);
  const drumR = new Float32Array(n);
  const leadL = new Float32Array(n);
  const leadR = new Float32Array(n);
  const counterL = new Float32Array(n);
  const counterR = new Float32Array(n);

  const lastChord = plan.chords[plan.chords.length - 1];
  for (const chord of plan.chords) {
    stopped(shouldStop);
    const envT1 = chord === lastChord
      ? Math.max(chord.t0 + 0.5, analysis.duration - (safeStyle === "ambient" ? 1.8 : 1.15))
      : chord.t1;
    const section = sectionAt(plan.sections, chord.t0);
    const eBar = energyAtBar(plan, chord.t0);
    const bed = (section ? 0.62 + section.energy * 0.5 : 1) * (0.82 + 0.28 * eBar);
    const padName = genome?.palette?.pad || defaultPad(safeStyle);
    const bassName = genome?.palette?.bass || defaultBass(safeStyle);
    if (!section || section.layers.includes("pad")) {
      if (padName === "rhodes") layRhodes(padL, padR, chord, plan.bpm, seed, bed, plan.meter?.barLen);
      else if (padName === "sine-choir") {
        const choirGain = 0.038 * (0.8 + 0.35 * eBar);
        addPadVoices(padL, padR, {
          t0: chord.t0,
          t1: envT1,
          attack: 1.1,
          release: 1.4,
          voices: chord.notes.map((midi, voice) => {
            const [panL, panR] = panGains((voice % 2 === 0 ? -1 : 1) * 0.18);
            return { freq: midiFreq(midi), gain: choirGain, panL, panR };
          }),
        });
      } else if (padName === "saw-pad") {
        const filtered = section && (section.name === "intro" || section.name === "breakdown");
        laySawPad(padL, padR, chord, envT1, filtered);
      } else if (padName === "wavetable-saw") {
        const fc = 520 + chord.sat * 1400;
        const table = chord.sat > 0.62 ? SAW_BRIGHT : SAW_SOFT;
        chord.notes.forEach((midi, voice) => {
          const freq = midiFreq(midi);
          const [panL, panR] = panGains((voice % 2 === 0 ? -1 : 1) * (0.16 + voice * 0.05));
          const voiceGain = 0.11 / Math.sqrt(chord.notes.length);
          const detunes = [-9, -3, 4, 11];
          const weights = [0.55, 0.85, 1, 0.45];
          for (let d = 0; d < detunes.length; d += 1) {
            addWavetable(padL, padR, {
              t0: chord.t0,
              t1: envT1,
              freq: freq * 2 ** (detunes[d] / 1200),
              gain: voiceGain * weights[d] * (0.85 + 0.25 * eBar),
              panL,
              panR,
              attack: 1.9,
              release: 2.6,
              fc,
              table,
              hp: voice === 0 ? 80 : 140,
              lfoRate: 0.06,
              lfoDepth: 0.62,
              lfoPhase: voice * 0.15 + d * 0.08,
              wobble: 0.05,
              ampDepth: 0.1,
              wobblePhase: d * 1.2 + voice,
              drift: 0.0035,
              fEnv: 0.5,
              fDecay: 1.4,
            });
          }
        });
      } else layPadAlt(padL, padR, chord, envT1, padName);
    }
    if (bassName === "sine-pedal" || (bassName === "none-with-low-pad" && safeStyle === "ambient")) {
      const low = Math.min(...chord.notes);
      // "none-with-low-pad" keeps only a soft sub under the pad.
      const subOnly = bassName === "none-with-low-pad";
      const pedal = section && section.layers.includes("pedal");
      const localPc = keyAt(key, chord.t0).pc;
      // Root (or tonic pedal) in the low octave, so ambient has real weight under 90 Hz.
      void low;
      const bassMidi = pedal ? bassMidiOf(localPc) : bassMidiOf(chord.rootPc);
      addSine(bassL, bassR, {
        t0: chord.t0,
        t1: envT1,
        freq: midiFreq(bassMidi),
        gain: (pedal ? 0.07 : 0.06) * (subOnly ? 0.6 : 1) * (0.35 + 0.95 * eBar * eBar),
        panL: 0.707,
        panR: 0.707,
        attack: 2.1,
        release: 2.4,
      });
      bassline.push({
        t: Math.round(chord.t0 * 1000) / 1000,
        midi: bassMidi,
        dur: Math.round((envT1 - chord.t0) * 1000) / 1000,
        degree: pedal ? "pedal" : "root",
      });
    } else if (bassName === "root-sustain") {
      layBass(bassL, bassR, chord, envT1, safeStyle);
      bassline.push({
        t: Math.round(chord.t0 * 1000) / 1000,
        midi: bassMidiOf(chord.rootPc),
        dur: Math.round((envT1 - chord.t0) * 1000) / 1000,
        degree: "root",
      });
    } else if (bassName === "pluck-bass" && safeStyle === "arp") {
      const midi = bassMidiOf(chord.rootPc);
      addPluck(bassL, bassR, {
        t: chord.t0, freq: midiFreq(midi), dur: Math.min(0.55, envT1 - chord.t0),
        vel: 0.2, fc: 320, panL: 0.707, panR: 0.707,
      });
      bassline.push({
        t: Math.round(chord.t0 * 1000) / 1000, midi,
        dur: Math.round(Math.min(0.4, envT1 - chord.t0) * 1000) / 1000, degree: "root",
      });
    } else if (bassName === "sub-pulse") {
      const beat = 60 / plan.bpm;
      const midi = bassMidiOf(chord.rootPc);
      for (let t = chord.t0; t < envT1 - 0.05; t += beat) {
        addSine(bassL, bassR, {
          t0: t, t1: t + Math.min(0.18, beat * 0.7), freq: midiFreq(midi), gain: 0.16,
          panL: 0.707, panR: 0.707, attack: 0.008, release: 0.06,
        });
      }
      bassline.push({
        t: Math.round(chord.t0 * 1000) / 1000, midi,
        dur: Math.round((envT1 - chord.t0) * 1000) / 1000, degree: "root",
      });
    } else if (bassName === "sub-sustain") {
      const midi = bassMidiOf(chord.rootPc);
      addSine(bassL, bassR, {
        t0: chord.t0, t1: envT1, freq: midiFreq(midi), gain: 0.14,
        panL: 0.707, panR: 0.707, attack: 0.12, release: 0.3,
      });
      addSine(bassL, bassR, {
        t0: chord.t0, t1: envT1, freq: midiFreq(midi) * 0.5, gain: 0.06,
        panL: 0.707, panR: 0.707, attack: 0.16, release: 0.3,
      });
      bassline.push({
        t: Math.round(chord.t0 * 1000) / 1000, midi,
        dur: Math.round((envT1 - chord.t0) * 1000) / 1000, degree: "root",
      });
    }
    await yieldNow();
  }

  // Air layer: two detuned, wide, slowly filtered voices an octave over the top
  // of the chord, only where the section has energy, so the density follows it.
  for (const chord of plan.chords) {
    const section = sectionAt(plan.sections, chord.t0);
    if (section && !section.layers.includes("pad")) continue;
    const eBar = energyAtBar(plan, chord.t0);
    const lift = Math.max(section ? section.energy : 0.5, eBar);
    if (lift < 0.5) continue;
    const t1 = chord === lastChord ? Math.max(chord.t0 + 0.5, analysis.duration - 1.4) : chord.t1;
    layAirPad(padL, padR, chord, t1, safeStyle, (lift - 0.35) * (safeStyle === "ambient" ? 0.8 : 1.15));
  }
  {
    // Reverse swell into each section that lifts, on the next chord's top notes.
    const beat = 60 / plan.bpm;
    for (let i = 1; i < plan.sections.length; i += 1) {
      const sec = plan.sections[i];
      const prev = plan.sections[i - 1];
      if (sec.t0 < 1.2 || sec.t0 > analysis.duration - 0.6) continue;
      if ((sec.energy ?? 0) + 0.001 < (prev.energy ?? 0)) continue;
      const next = chordAt(plan.chords, sec.t0 + 0.01);
      if (!next) continue;
      const len = Math.min(1.6, Math.max(0.6, beat * 2));
      addPadVoices(bellL, bellR, {
        t0: sec.t0 - len,
        t1: sec.t0,
        attack: len * 0.96,
        release: 0.05,
        voices: next.notes.slice(-3).map((midi, v) => {
          const [panL, panR] = panGains(v % 2 ? 0.55 : -0.55);
          return { freq: midiFreq(Math.min(96, midi + 12)), gain: 0.014, panL, panR };
        }),
      });
    }
    // A low impact on the climax downbeat (not in ambient, where it would intrude).
    const climaxT = genome?.climaxT;
    if (safeStyle !== "ambient" && climaxT != null && climaxT > analysis.duration * 0.35 && climaxT < analysis.duration - 1) {
      const bar = plan.meter?.barLen || beat * 4;
      const at = Math.round(climaxT / bar) * bar;
      const chord = chordAt(plan.chords, at + 0.01);
      if (chord) {
        const midi = bassMidiOf(chord.rootPc) - 12 >= 26 ? bassMidiOf(chord.rootPc) - 12 : bassMidiOf(chord.rootPc);
        addSine(bassL, bassR, {
          t0: at, t1: at + 0.06, freq: midiFreq(midi), gain: 0.075, panL: 0.707, panR: 0.707, attack: 0.004, release: 1.1,
        });
      }
    }
  }

  let groove = [];
  let arpNotes = [];
  if (safeStyle === "arp") arpNotes = layArp(arpL, arpR, plan);
  if (safeStyle === "ambient") {
    sharedBreathe(padL, padR, 0.045, 0.5);
    for (const chord of plan.chords) {
      const section = sectionAt(plan.sections, chord.t0);
      if (!section || !section.layers.includes("shimmer")) continue;
      const top = Math.max(...chord.notes);
      const held = chord === lastChord
        ? Math.max(chord.t0 + 0.4, analysis.duration - 1.6)
        : chord.t1;
      addSine(padL, padR, {
        t0: chord.t0,
        t1: held,
        freq: midiFreq(Math.min(84, top + 12)),
        gain: 0.016,
        panL: 0.62,
        panR: 0.78,
        attack: 2.4,
        release: 2.8,
      });
    }
    for (const section of plan.sections) {
      if (section.name === "intro") continue;
      if ((genome?.palette?.bass || defaultBass(safeStyle)) !== "sine-pedal") continue;
      addSine(bassL, bassR, {
        t0: section.t0,
        t1: section.t0 + 0.35,
        freq: midiFreq(keyAt(key, section.t0).pc + 36),
        gain: 0.05,
        panL: 0.707,
        panR: 0.707,
        attack: 0.45,
        release: 1.3,
      });
    }
    for (const t of glintTimes(plan, analysis.duration)) {
      const chord = chordAt(plan.chords, t);
      const midi = Math.min(96, Math.max(...chord.notes) + 12);
      const [panL, panR] = panGains(((midi % 5) - 2) * 0.2);
      if (!playNote(bellL, bellR, "celesta", {
        midi, t0: t, t1: t + 0.05, gain: 0.07, panL, panR, attack: 0.008, release: 1.1,
      })) {
        addPluck(bellL, bellR, {
          t, freq: midiFreq(midi), dur: 1.4, vel: 0.05, fc: 2800, panL, panR,
        });
      }
    }
  }

  const leadName = genome?.palette?.lead || defaultLead(safeStyle);
  const bassName = genome?.palette?.bass || defaultBass(safeStyle);
  const drumName = genome?.palette?.drums || defaultDrums(safeStyle);
  const texture = genome?.palette?.texture || "none";
  accentCuts(bells, bassL, bassR, analysis, plan, safeStyle);
  layTexture(padL, padR, texture, analysis.duration, rng);

  for (const bell of bells) {
    const [panL, panR] = panGains(((bell.midi % 5) - 2) * 0.22);
    if (bell.kind === "fill") {
      addFm(bellL, bellR, {
        t0: bell.t,
        t1: bell.t + 0.05,
        freq: midiFreq(bell.midi),
        gain: bell.vel,
        panL,
        panR,
        attack: 0.01,
        release: 0.28,
        fc: 1600,
        hp: 200,
        index: 0.7,
        seed: seed + bell.midi,
      });
    } else {
      addBell(bellL, bellR, { ...bell, freq: midiFreq(bell.midi), panL, panR });
    }
  }

  layLine(leadL, leadR, lines.lead, safeStyle, "lead", plan.bpm, leadName, plan);
  layLine(counterL, counterR, lines.counter, safeStyle, "counter", plan.bpm, null, plan);

  if (safeStyle === "lofi") {
    groove = buildGroove(analysis.duration, plan.bpm, rng, plan.sections, plan.meter, genome?.humanize);
    groove = shapeEnergy(groove, plan, analysis.duration, genome?.climaxT);
    groove = addCutDrums(groove, analysis.cuts || [], 60 / plan.bpm, analysis.duration, safeStyle);
    if (bassName === "walk-upright") renderWalk(bassL, bassR, bassline);
    else if (bassName === "sub-sine-2feel") laySubTwoFeel(bassL, bassR, bassline, plan);
    else if (bassName === "pluck-bass") layPluckBass(bassL, bassR, bassline);
    const kicks = groove.filter((event) => event.kind === "kick");
    applySidechain(padL, padR, kicks);
    applySidechain(bassL, bassR, kicks);
    shortPlate(padL, padR);
    if (drumName !== "none") layDrumPalette(drumL, drumR, groove, drumName, analysis.duration, plan);
    if (drumName === "dusty-samples") lowpassPair(drumL, drumR, 6800);
    else if (drumName === "brush-rim") lowpassPair(drumL, drumR, 5600);
  }

  if (safeStyle === "synthwave") {
    const machineMeter = drumName === "linn-halftime"
      ? { ...plan.meter, halfTime: true }
      : plan.meter;
    groove = buildMachine(analysis.duration, plan.bpm, plan.sections, machineMeter);
    if (drumName === "909-four-on-floor") groove = fourOnFloor(groove, plan, analysis.duration);
    groove = shapeEnergy(groove, plan, analysis.duration, genome?.climaxT);
    groove = addCutDrums(groove, analysis.cuts || [], 60 / plan.bpm, analysis.duration, safeStyle);
    if (bassName === "pulse-8ths" || bassName === "octave-bass") layPulseBass(bassL, bassR, bassline);
    if (bassName === "octave-bass") {
      for (const note of bassline) {
        addSine(bassL, bassR, {
          t0: note.t, t1: note.t + note.dur, freq: midiFreq(Math.max(28, note.midi - 12)),
          gain: 0.05, panL: 0.707, panR: 0.707, attack: 0.01, release: 0.05,
        });
      }
    }
    arpNotes = layWaveArp(arpL, arpR, plan);
    pingPong(arpL, arpR, plan.bpm);
    const kicks = groove.filter((event) => event.kind === "kick");
    applySidechain(padL, padR, kicks);
    applySidechain(bassL, bassR, kicks);
    if (drumName !== "none") layDrumPalette(drumL, drumR, groove, drumName === "linn-halftime" || drumName === "909-four-on-floor" ? "gated-80s" : drumName, analysis.duration, plan);
  }

  if (safeStyle === "arp") {
    pingPong(arpL, arpR, plan.bpm);
    if (drumName === "pulse-tick") layPulse(drumL, drumR, plan);
    else if (drumName === "shaker-only") layShakers(drumL, drumR, plan);
    else if (drumName === "soft-808") laySoft808(drumL, drumR, plan);
  }
  if (safeStyle === "ambient") {
    if (drumName === "heartbeat") layHeart(padL, padR, plan);
    else if (drumName === "soft-toms") laySoftToms(drumL, drumR, plan);
  }

  const transitions = [];
  const barLen = plan.meter?.barLen || (240 / plan.bpm);
  for (let i = 1; i < plan.sections.length; i += 1) {
    const boundary = plan.sections[i].t0;
    if (boundary < 0.4 || boundary > analysis.duration - 0.4) continue;
    if (safeStyle === "lofi" || safeStyle === "synthwave") {
      transitions.push({ t: boundary, kind: "fill" });
    } else {
      transitions.push({ t: boundary, kind: "riser" });
      const leadIn = Math.min(1.15, Math.max(0.7, barLen * 0.75));
      const start = Math.max(0, boundary - leadIn);
      if (!playNote(bellL, bellR, "cym", {
        midi: 60, t0: start, t1: boundary, gain: 0.05, panL: 0.6, panR: 0.6, attack: 0.02, release: 0.012,
      })) addRiser(bellL, bellR, boundary, leadIn);
    }
  }

  // A climax lift is an arrangement event too (mc-modulation §6.2): swell into it and hit the downbeat.
  for (const mod of arranged.modulations || []) {
    if (!/^(lift|truck)/.test(mod.kind || "")) continue;
    const leadIn = Math.min(1.6, Math.max(0.8, barLen));
    addRiser(bellL, bellR, mod.t, leadIn);
    if (safeStyle !== "ambient") addCrash(drumL, drumR, mod.t, 0.42);
    transitions.push({ t: mod.t, kind: "lift" });
  }

  let perf = null;
  let voiceL = null;
  let voiceR = null;
  const singLyrics = Boolean(lyricsOn) && String(lyrics || "").trim().length > 0;
  if (singLyrics || oohaah) {
    perf = planPerformance({
      lead: lines.lead,
      chords: plan.chords,
      bassline,
      key,
      sections: plan.sections,
      style: safeStyle,
      duration: analysis.duration,
      lyrics,
      lyricsOn: singLyrics,
      oohaah: Boolean(oohaah),
    });
    if (perf.events.length) {
      voiceL = new Float32Array(n);
      voiceR = new Float32Array(n);
      await renderVoice(voiceL, voiceR, perf, seed, shouldStop);
    }
  }

  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const gains = stemGains(safeStyle, stem);
  // Lyrics take the melody. The lead instrument drops 6 dB in the full mix only.
  if (singLyrics && perf && perf.sung > 0 && (!stem || stem === "vocal")) gains.lead *= 0.5;
  shapeStems(safeStyle, {
    pad: [padL, padR], bass: [bassL, bassR], bell: [bellL, bellR], arp: [arpL, arpR],
    drum: [drumL, drumR], lead: [leadL, leadR], counter: [counterL, counterR],
  });
  mixInto(L, R, padL, padR, gains.pad);
  mixInto(L, R, bassL, bassR, gains.bass);
  mixInto(L, R, bellL, bellR, gains.bell);
  mixInto(L, R, arpL, arpR, gains.arp);
  mixInto(L, R, drumL, drumR, gains.drum);
  mixInto(L, R, leadL, leadR, gains.lead);
  mixInto(L, R, counterL, counterR, gains.counter);
  const fullMix = !stem || stem === "vocal";
  let bus = null;
  if (fullMix) {
    const sends = SEND_LEVELS[safeStyle];
    bus = { sendL: new Float32Array(n), sendR: new Float32Array(n), dlyL: new Float32Array(n), dlyR: new Float32Array(n) };
    mixInto(bus.sendL, bus.sendR, padL, padR, gains.pad * sends.pad);
    mixInto(bus.sendL, bus.sendR, bellL, bellR, gains.bell * sends.bell);
    mixInto(bus.sendL, bus.sendR, arpL, arpR, gains.arp * sends.arp);
    mixInto(bus.sendL, bus.sendR, drumL, drumR, gains.drum * sends.drum);
    mixInto(bus.sendL, bus.sendR, leadL, leadR, gains.lead * sends.lead);
    mixInto(bus.sendL, bus.sendR, counterL, counterR, gains.counter * sends.counter);
    mixInto(bus.dlyL, bus.dlyR, leadL, leadR, gains.lead);
    mixInto(bus.dlyL, bus.dlyR, bellL, bellR, gains.bell * 0.5);
    mixInto(bus.dlyL, bus.dlyR, counterL, counterR, gains.counter * 0.25);
  }
  let voiceMix = null;
  if (voiceL && (!stem || stem === "vocal")) {
    voiceMix = placeVocal(L, R, voiceL, voiceR, perf, stem === "vocal", muteVoiceForTest, bus);
  } else if (voiceL && stem === "voice") {
    mixInto(L, R, voiceL, voiceR, 1);
  }

  stopped(shouldStop);
  if (fullMix) {
    eqPair(bus.sendL, bus.sendR, [["hp", 220], ["lp", 9000]]);
    const wet = await spaceWet(bus.sendL, bus.sendR, safeStyle, shouldStop);
    addInto(L, R, wet.L, wet.R, 1);
    pingPongSend(bus.dlyL, bus.dlyR, L, R, delaySpec(safeStyle, plan.bpm));
    if (voiceMix) {
      // Re-check the voice against the finished backing (room, delay, air
      // layers included) and only ever raise it back to its target.
      const lift = vocalLift(L, R, voiceMix, perf, safeStyle);
      voiceMix.report.liftDb = Math.round(20 * Math.log10(lift) * 10) / 10;
      mixInto(L, R, voiceMix.dryL, voiceMix.dryR, lift);
    }
    macroDynamics(L, R, plan.energy, plan.meter?.barLen || 240 / plan.bpm, safeStyle);
    finishBuffer(L, R, analysis, safeStyle);
  } else {
    fadeEdges(L, R, safeStyle === "ambient" ? 0.05 : 0.01);
  }
  stopped(shouldStop);
  writeWav(outFile, L, R);
  const motif = plan.motif || { degrees: [], steps: [], durs: [] };
  return {
    key: key.name,
    fingerprint: genome?.fingerprint || fingerprintOf(analysis).hex,
    mode: key.mode === "harmonicMinor" ? "harmonic minor" : key.mode,
    scale: key.scaleLabel || key.mode,
    meter: plan.meter?.name || "4/4",
    feel: plan.meter?.feel || "straight",
    swing: plan.meter?.swing ?? 0,
    palette: genome?.palette || null,
    progression: genome?.progression || null,
    harmonicRhythm: genome?.harmonicRhythm || null,
    motif: { degrees: motif.degrees, steps: motif.steps, durs: motif.durs },
    modulations: arranged.modulations || [],
    climaxT: genome?.climaxT ?? null,
    energy: genome?.energy || plan.energy || [],
    bpm: plan.bpm,
    loop: plan.loop,
    chords: plan.chords.map((chord) => ({
      t: Math.round(chord.t0 * 1000) / 1000,
      t1: Math.round(chord.t1 * 1000) / 1000,
      id: chord.id,
      name: chord.name,
      notes: chord.notes,
      rootPc: chord.rootPc,
    })),
    sections: plan.sections,
    lead: lines.lead,
    counter: lines.counter,
    transitions,
    bells: bells.map((bell) => ({ t: Math.round(bell.t * 100) / 100, midi: bell.midi, kind: bell.kind })),
    drums: groove.filter((event) => event.kind !== "hat" && event.kind !== "open" && event.kind !== "shaker").map((event) => ({
      t: Math.round(event.t * 1000) / 1000,
      kind: event.kind,
      vel: event.vel,
      fill: Boolean(event.fill),
      midi: event.midi,
    })),
    hats: groove.filter((event) => event.kind === "hat" || event.kind === "open").map((event) => ({
      t: Math.round(event.t * 1000) / 1000,
      kind: event.kind,
      vel: event.vel,
    })),
    bassline,
    arpNotes,
    clashes,
    choir: perf ? perf.choir : [],
    phonemes: perf ? perf.phonemes : [],
    voiceClashes: perf ? perf.voiceClashes : [],
    voiceMix: voiceMix ? voiceMix.report : null,
    lyricsFit: perf ? {
      coverage: perf.coverage,
      unsungPct: perf.unsungPct,
      syllables: perf.syllables,
      sung: perf.sung,
    } : null,
    samples: n,
  };
}

function mixInto(L, R, srcL, srcR, gain) {
  if (!gain) return;
  for (let i = 0; i < L.length; i += 1) {
    L[i] += srcL[i] * gain;
    R[i] += srcR[i] * gain;
  }
}

function stemGains(style, stem) {
  const all = style === "lofi"
    ? { pad: 1, bass: 1, bell: 1, arp: 0, drum: 1, lead: 1, counter: 1 }
    : style === "arp"
      ? { pad: 1, bass: 0.8, bell: 0.7, arp: 1, drum: 1, lead: 1, counter: 1 }
      : style === "synthwave"
        ? { pad: 0.92, bass: 1, bell: 0, arp: 0.88, drum: 0.58, lead: 1, counter: 0.7 }
        : { pad: 1, bass: 1.4, bell: 0.85, arp: 0, drum: 0, lead: 1, counter: 1 };
  if (!stem) return all;
  const only = { pad: 0, bass: 0, bell: 0, arp: 0, drum: 0, lead: 0, counter: 0 };
  if (stem === "keys") only.pad = all.pad;
  else if (stem === "bass") only.bass = all.bass;
  else if (stem === "bells") only.bell = all.bell;
  else if (stem === "arp") only.arp = all.arp;
  else if (stem === "drums") only.drum = all.drum;
  else if (stem === "lead") only.lead = all.lead;
  else if (stem === "counter") only.counter = all.counter;
  else if (stem === "bed") {
    only.pad = all.pad;
    only.lead = all.lead;
  } else if (stem === "voice") {
    /* The voice buffer is mixed on its own, already at mix level. */
  } else return all;
  return only;
}

function slapDelay(L, R, seconds, mix) {
  const n = L.length;
  const d = Math.max(1, Math.round(seconds * SR));
  if (d >= n) return;
  const srcL = L.slice();
  const srcR = R.slice();
  for (let i = d; i < n; i += 1) {
    L[i] += srcL[i - d] * mix;
    R[i] += srcR[i - d] * mix * 0.7;
  }
}

function addPortaSaw(L, R, spec) {
  const n = L.length;
  const i0 = clamp(Math.floor(spec.t0 * SR), 0, n);
  const relStart = clamp(Math.floor(spec.t1 * SR), i0, n);
  const relLen = Math.max(1, Math.round((spec.release || 0.18) * SR));
  const i1 = Math.min(n, relStart + relLen);
  const aN = Math.max(1, Math.round((spec.attack || 0.02) * SR));
  const glideN = Math.max(1, Math.round((spec.glide || 0) * SR));
  const table = spec.table || SAW_BRIGHT;
  const coeff = 1 - Math.exp((-2 * Math.PI * (spec.fc || 1800)) / SR);
  const f0 = spec.fromFreq || spec.freq;
  const f1 = spec.freq;
  let phase = spec.phase0 || 0;
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    let env = 1;
    if (age < aN) env = Math.sin((age / aN) * Math.PI * 0.5);
    else if (i >= relStart) env = Math.cos(Math.min(1, (i - relStart) / relLen) * Math.PI * 0.5);
    const u = spec.glide ? Math.min(1, age / glideN) : 1;
    phase += (f0 + (f1 - f0) * u) / SR;
    if (phase >= 1) phase -= 1;
    const x = phase * TABLE;
    const idx = x | 0;
    const sample = table[idx] + (table[idx + 1] - table[idx]) * (x - idx);
    z1 += coeff * (sample - z1);
    z2 += coeff * (z1 - z2);
    z3 += coeff * (z2 - z3);
    const s = z3 * env * spec.gain;
    L[i] += s * spec.panL;
    R[i] += s * spec.panR;
  }
}

function layLine(L, R, notes, style, which, bpm, timbre, plan) {
  const leadGain = style === "ambient" ? 0.128 : style === "lofi" ? 0.245 : style === "synthwave" ? 0.125 : 0.13;
  const counterGain = style === "lofi" ? 0.315 : style === "arp" ? 0.16 : style === "synthwave" ? 0.1 : 0.09;
  const gain0 = which === "lead" ? leadGain : counterGain;
  let prevMidi = null;
  let prevEnd = -1;
  const bar = plan?.meter?.barLen || (bpm ? (60 / bpm) * 4 : 2);
  for (const note of notes) {
    if (which === "counter" && plan) {
      const e = energyAtBar(plan, note.t);
      const pos = ((note.t % bar) + bar) % bar;
      if (e < 0.32 && pos > bar * 0.14) continue;
    }
    const gain = gain0 * (which === "counter" && plan ? (0.75 + 0.4 * energyAtBar(plan, note.t)) : 1);
    const [panL, panR] = panGains(which === "lead" ? 0.16 : -0.28);
    const t1 = note.t + note.dur;
    const freq = midiFreq(note.midi);
    if (which === "lead" && timbre && timbre !== defaultLead(style)) {
      layLeadAlt(L, R, note, style, timbre, gain, panL, panR, prevMidi, prevEnd);
      prevMidi = note.midi;
      prevEnd = t1;
      continue;
    }
    if (style === "lofi" && which === "lead") {
      const played = playNote(L, R, "ep", {
        midi: note.midi,
        t0: note.t,
        t1,
        gain,
        panL,
        panR,
        attack: 0.012,
        release: 0.2,
        trem: 0.24,
        tremRate: 5.4,
      });
      addSine(L, R, {
        t0: note.t,
        t1: note.t + Math.min(note.dur, 0.16),
        freq: freq * 2,
        gain: gain * 0.045,
        panL,
        panR,
        attack: 0.02,
        release: 0.08,
      });
      if (!played) {
        addSine(L, R, { t0: note.t, t1, freq, gain, panL, panR, attack: 0.02, release: 0.16 });
        addFm(L, R, {
          t0: note.t, t1: note.t + Math.min(note.dur, 0.35), freq, gain: gain * 0.35,
          panL, panR, attack: 0.01, release: 0.12, fc: 2200, index: 0.7, ratio: 1,
        });
      }
    } else if (style === "lofi" && which === "counter") {
      addSine(L, R, {
        t0: note.t, t1, freq, gain: gain * 0.34, panL, panR, attack: 0.05, release: 0.14,
      });
      if (!playNote(L, R, "mute", {
        midi: note.midi, t0: note.t, t1, gain, panL, panR, attack: 0.012, release: 0.16,
      })) {
        addSine(L, R, { t0: note.t, t1, freq, gain: gain * 0.7, panL, panR, attack: 0.02, release: 0.12 });
      }
    } else if (style === "ambient" && which === "lead") {
      playNote(L, R, "celesta", {
        midi: note.midi, t0: note.t, t1: note.t + Math.min(0.12, note.dur), gain: gain * 0.9,
        panL, panR, attack: 0.02, release: 0.9,
      });
      addWavetable(L, R, {
        t0: note.t, t1, freq, gain: gain * 0.7, panL, panR,
        attack: 0.32, release: 0.6, fc: 2000, table: TRI, hp: 180,
        lfoDepth: 0, ampDepth: 0,
      });
      const [dL, dR] = panGains(0.42);
      addWavetable(L, R, {
        t0: note.t, t1, freq: freq * 2 ** (6 / 1200), gain: gain * 0.32, panL: dL, panR: dR,
        attack: 0.45, release: 0.65, fc: 1700, table: TRI, hp: 200,
        lfoDepth: 0, ampDepth: 0,
      });
      addFm(L, R, {
        t0: note.t, t1: note.t + Math.min(note.dur, 0.55), freq, gain: gain * 0.28,
        panL, panR, attack: 0.04, release: 0.35, fc: 2800, hp: 300, index: 1.15, ratio: 2.4, seed: note.midi * 17,
      });
    } else if (style === "ambient" && which === "counter") {
      addWavetable(L, R, {
        t0: note.t, t1, freq, gain, panL, panR,
        attack: 0.16, release: 0.4, fc: 1400, table: TRI, hp: 140,
        lfoDepth: 0, ampDepth: 0,
      });
    } else if (style === "arp" && which === "lead") {
      addWavetable(L, R, {
        t0: note.t, t1, freq, gain: gain * 1.35, panL, panR,
        attack: 0.03, release: 0.28, fc: 1600, table: SQUARE_SOFT, hp: 160,
        lfoDepth: 0.05, ampDepth: 0,
      });
    } else if (style === "arp" && which === "counter") {
      addWavetable(L, R, {
        t0: note.t, t1, freq, gain, panL, panR,
        attack: 0.06, release: 0.22, fc: 1100, table: TRI, hp: 120,
        lfoDepth: 0, ampDepth: 0,
      });
    } else if (style === "synthwave" && which === "lead") {
      const close = prevMidi != null && note.t - prevEnd < 0.09;
      const from = close ? midiFreq(prevMidi) : freq;
      const glide = close ? 0.045 : 0;
      addPortaSaw(L, R, {
        t0: note.t, t1, freq, fromFreq: from, glide, gain, panL, panR,
        attack: 0.035, release: 0.2, fc: 2200, table: SAW_BRIGHT, phase0: 0.5,
      });
      const [dL, dR] = panGains(-0.22);
      addPortaSaw(L, R, {
        t0: note.t, t1, freq: freq * 2 ** (-7 / 1200), fromFreq: from * 2 ** (-7 / 1200), glide,
        gain: gain * 0.62, panL: dL, panR: dR,
        attack: 0.04, release: 0.22, fc: 1900, table: SAW_BRIGHT, phase0: 0.5,
      });
    } else if (style === "synthwave" && which === "counter") {
      addWavetable(L, R, {
        t0: note.t, t1, freq, gain, panL, panR,
        attack: 0.28, release: 0.45, fc: 780, table: SAW_SOFT, hp: 140,
        lfoDepth: 0.08, ampDepth: 0.02,
      });
      const [dL, dR] = panGains(0.35);
      addWavetable(L, R, {
        t0: note.t, t1, freq: freq * 2 ** (7 / 1200), gain: gain * 0.55, panL: dL, panR: dR,
        attack: 0.34, release: 0.5, fc: 640, table: SAW_SOFT, hp: 160,
        lfoDepth: 0, ampDepth: 0,
      });
    } else {
      addSine(L, R, { t0: note.t, t1, freq, gain, panL, panR, attack: 0.03, release: 0.18 });
    }
    prevMidi = note.midi;
    prevEnd = t1;
  }
  if (which === "lead" && bpm && (style === "arp" || style === "synthwave")) {
    slapDelay(L, R, (60 / bpm) * (style === "synthwave" ? 0.5 : 0.375), style === "synthwave" ? 0.28 : 0.2);
  }
}

function laySawPad(L, R, chord, t1, filtered) {
  const fc = filtered ? 620 + chord.sat * 280 : 1500 + chord.sat * 1200;
  const detunes = [-14, -7, 0, 8, 15];
  const weights = [0.4, 0.72, 1, 0.74, 0.38];
  const voiceGain = 0.072 / Math.sqrt(Math.max(1, chord.notes.length));
  chord.notes.forEach((midi, voice) => {
    const freq = midiFreq(midi);
    for (let d = 0; d < detunes.length; d += 1) {
      const [panL, panR] = panGains((d - 2) * 0.2 + (voice % 2 === 0 ? -0.05 : 0.05));
      addWavetable(L, R, {
        t0: chord.t0,
        t1,
        freq: freq * 2 ** (detunes[d] / 1200),
        gain: voiceGain * weights[d],
        panL,
        panR,
        attack: filtered ? 1.1 : 0.62,
        release: 0.5,
        fc,
        table: SAW_SOFT,
        hp: 65,
        lfoRate: 0.07,
        lfoDepth: filtered ? 0.45 : 0.22,
        lfoPhase: voice * 0.3 + d * 0.17,
        wobble: 0.035,
        ampDepth: 0.03,
        wobblePhase: d * 0.4,
        drift: 0.0015,
      });
    }
  });
}

function layPulseBass(L, R, notes) {
  for (const note of notes) {
    const freq = midiFreq(note.midi);
    addWavetable(L, R, {
      t0: note.t,
      t1: note.t + note.dur,
      freq,
      gain: note.degree === "held" ? 0.1 : note.degree === "octave" ? 0.12 : 0.15,
      panL: 0.707,
      panR: 0.707,
      attack: note.degree === "held" ? 0.08 : 0.006,
      release: note.degree === "held" ? 0.28 : 0.045,
      fc: note.degree === "held" ? 140 : 220,
      table: SAW_BRIGHT,
      hp: 32,
      lfoDepth: 0,
      ampDepth: 0,
    });
    addSine(L, R, {
      t0: note.t,
      t1: note.t + (note.degree === "held" ? note.dur : Math.min(note.dur, 0.16)),
      freq: freq * 0.5,
      gain: note.degree === "held" ? 0.04 : 0.055,
      panL: 0.707,
      panR: 0.707,
      attack: note.degree === "held" ? 0.06 : 0.004,
      release: note.degree === "held" ? 0.2 : 0.04,
    });
  }
}

function layWaveArp(L, R, plan) {
  const beat = 60 / plan.bpm;
  const stepsPerBeat = plan.meter?.stepsPerBeat || 4;
  const step = beat / stepsPerBeat;
  const played = [];
  for (const chord of plan.chords) {
    const section = sectionAt(plan.sections, chord.t0);
    if (!section || !section.layers.includes("arp")) continue;
    const filtered = section.name === "intro" || section.name === "breakdown";
    const tones = chord.notes.slice().sort((a, b) => a - b);
    if (!tones.length) continue;
    const seq = tones.map((midi) => {
      let m = midi;
      while (m < 60) m += 12;
      while (m > 71) m -= 12;
      return m;
    });
    let i = 0;
    for (let t = chord.t0; t < chord.t1 - step * 0.3; t += step) {
      const shuffle = plan.meter?.feel === "shuffle" && i % 2 === 1 ? (plan.meter.swing || 0.12) * step * 0.45 : 0;
      const when = t + shuffle;
      const midi = seq[i % seq.length];
      const [panL, panR] = panGains(i % 2 === 0 ? -0.48 : 0.48);
      const downbeat = i % stepsPerBeat === 0;
      const eStep = energyAtBar(plan, when);
      if (eStep < 0.28 && !downbeat) { i += 1; continue; }
      addWavetable(L, R, {
        t0: when,
        t1: when + step * 0.8,
        freq: midiFreq(midi),
        gain: (filtered ? 0.016 : 0.055) * (downbeat ? 1.12 : 0.82) * (0.7 + 0.45 * eStep),
        panL,
        panR,
        attack: 0.003,
        release: 0.05,
        fc: filtered ? 700 : 2600 + chord.sat * 700,
        table: SQUARE_SOFT,
        hp: 200,
        lfoDepth: 0,
        ampDepth: 0,
      });
      played.push({ t: Math.round(when * 1000) / 1000, midi, section: section.name });
      i += 1;
    }
  }
  return played;
}

function addGateSnare(L, R, t, vel) {
  addSnare(L, R, t, vel * 0.9);
  const n = L.length;
  const taps = [0.024, 0.05, 0.078, 0.11, 0.145];
  for (let k = 0; k < taps.length; k += 1) {
    const i0 = clamp(Math.floor((t + taps[k]) * SR), 0, n);
    const i1 = Math.min(n, i0 + Math.round(0.04 * SR));
    const amp = vel * 0.14 * (1 - k / taps.length);
    const hpA = Math.exp((-2 * Math.PI * 1600) / SR);
    const decay = Math.exp(-1 / (0.028 * SR));
    let hp = 0;
    let prev = 0;
    let env = 1;
    const pan = k % 2 === 0 ? 0.32 : 0.68;
    for (let i = i0; i < i1; i += 1) {
      env *= decay;
      const noise = hashNoise(i * 3 + k * 19 + 5);
      const high = hpA * (hp + noise - prev);
      hp = high;
      prev = noise;
      const s = high * env * amp;
      L[i] += s * pan;
      R[i] += s * (1 - pan);
    }
  }
}

function addTom(L, R, t, midi, vel) {
  const n = L.length;
  const i0 = clamp(Math.floor(t * SR), 0, n);
  const i1 = Math.min(n, i0 + Math.round(0.26 * SR));
  const f0 = midiFreq(midi);
  const decay = Math.exp(-1 / (0.11 * SR));
  const fDecay = Math.exp(-1 / (0.07 * SR));
  let phase = 0;
  let env = 1;
  let fEnv = 1;
  for (let i = i0; i < i1; i += 1) {
    env *= decay;
    fEnv *= fDecay;
    phase += (f0 * (1 + 0.4 * fEnv)) / SR;
    if (phase >= 1) phase -= 1;
    const x = phase * TABLE;
    const idx = x | 0;
    const sine = SINE[idx] + (SINE[idx + 1] - SINE[idx]) * (x - idx);
    const s = sine * env * vel * 0.32;
    L[i] += s * 0.46;
    R[i] += s * 0.6;
  }
}

function addClap(L, R, t, vel) {
  const n = L.length;
  const bursts = [0, 0.011, 0.023];
  for (let b = 0; b < bursts.length; b += 1) {
    const i0 = clamp(Math.floor((t + bursts[b]) * SR), 0, n);
    const i1 = Math.min(n, i0 + Math.round(0.035 * SR));
    const hpA = Math.exp((-2 * Math.PI * 1000) / SR);
    const decay = Math.exp(-1 / (0.016 * SR));
    let env = 1;
    let hp = 0;
    let prev = 0;
    for (let i = i0; i < i1; i += 1) {
      env *= decay;
      const noise = hashNoise(i * 7 + b * 13 + 2);
      const band = hpA * (hp + noise - prev);
      hp = band;
      prev = noise;
      const s = band * env * vel * 0.18;
      L[i] += s * 0.38;
      R[i] += s * 0.62;
    }
  }
}

function addCrash(L, R, t, vel) {
  const n = L.length;
  const i0 = clamp(Math.floor(t * SR), 0, n);
  const i1 = Math.min(n, i0 + Math.round(0.5 * SR));
  const hpA = Math.exp((-2 * Math.PI * 1600) / SR);
  const attack = Math.max(1, Math.round(0.014 * SR));
  let hp = 0;
  let prev = 0;
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    const env = age < attack
      ? Math.sin((age / attack) * Math.PI * 0.5)
      : Math.exp(-(age - attack) / (0.14 * SR));
    const noise = hashNoise(i * 5 + 11);
    const high = hpA * (hp + noise - prev);
    hp = high;
    prev = noise;
    const s = high * env * vel * 0.28;
    L[i] += s * 0.42;
    R[i] += s * 0.64;
  }
}

function layMachine(L, R, events) {
  for (const event of events) {
    if (event.kind === "kick") addKick(L, R, event.t, event.vel * (event.build ? 0.62 : 0.78), !event.build);
    else if (event.kind === "snare") addGateSnare(L, R, event.t, event.vel);
    else if (event.kind === "hat") addHat(L, R, event.t, event.vel * 0.85);
    else if (event.kind === "clap") addClap(L, R, event.t, event.vel);
    else if (event.kind === "tom") addTom(L, R, event.t, event.midi || 47, event.vel);
    else if (event.kind === "crash") addCrash(L, R, event.t, event.vel);
  }
}

function buildMachine(duration, bpm, sections, meter) {
  const beat = 60 / bpm;
  const beatsPerBar = meter?.beats || 4;
  const barLen = meter?.barLen || beat * beatsPerBar;
  const halfTime = Boolean(meter?.halfTime);
  const events = [];
  const at = (barIndex, beatInBar) => Math.round((barIndex * barLen + beatInBar * beat) * 1000) / 1000;
  for (const section of sections) {
    const half = halfTime || section.name === "build" || section.name === "outro" || section.name === "resolve";
    const intro = section.name === "intro";
    const breakdown = section.name === "breakdown";
    const back = half ? [Math.min(2, beatsPerBar - 1)] : (beatsPerBar === 4 ? [1, 3] : [beatsPerBar - 1]);
    const kicks = half ? [0, Math.min(2, beatsPerBar - 1)] : [...Array(beatsPerBar).keys()];
    for (let bar = 0; bar < section.bars; bar += 1) {
      const barIndex = section.bar0 + bar;
      if (intro || (breakdown && bar === section.bars - 1)) {
        if (intro && bar !== section.bars - 1) continue;
        const rise = Math.max(4, beatsPerBar * 2);
        for (let s = 0; s < rise; s += 1) {
          const t = at(barIndex, (s * beatsPerBar) / rise);
          if (t >= duration - 0.05 || t >= section.t1 - 0.03) break;
          events.push({ t, kind: "kick", vel: Math.round((0.26 + 0.07 * s) * 100) / 100, build: true });
        }
        continue;
      }
      if (breakdown) {
        const t = at(barIndex, back[0]);
        if (t < section.t1 - 0.02 && t < duration - 0.02) {
          events.push({ t, kind: "snare", vel: 0.46 });
        }
        continue;
      }
      if (!section.layers.includes("drums")) continue;
      for (const b of kicks) {
        const t = at(barIndex, b);
        if (t >= section.t1 - 0.02 || t >= duration - 0.02) continue;
        events.push({ t, kind: "kick", vel: b === 0 ? 1 : 0.9 });
      }
      for (const b of back) {
        const t = at(barIndex, b);
        if (t >= section.t1 - 0.02 || t >= duration - 0.02) continue;
        events.push({ t, kind: "snare", vel: 0.9 });
        events.push({ t, kind: "clap", vel: 0.26 });
      }
      const hatN = half ? beatsPerBar * 2 : beatsPerBar * 4;
      for (let s = 0; s < hatN; s += 1) {
        let beatPos = (s * beatsPerBar) / hatN;
        if (meter?.feel === "shuffle" && s % 2 === 1) beatPos += (meter.swing || 0.12) * 0.12;
        const t = at(barIndex, beatPos);
        if (t >= section.t1 - 0.02 || t >= duration - 0.02) continue;
        const accent = s % (half ? 2 : 4) === 0;
        events.push({ t, kind: "hat", vel: accent ? 0.4 : 0.22 });
      }
    }
  }
  const stepsPerBeat = meter?.sub === 3 ? 3 : 4;
  const sixteenth = beat / stepsPerBeat;
  for (let i = 1; i < sections.length; i += 1) {
    const boundary = sections[i].t0;
    if (boundary < 0.4 || boundary > duration - 0.25) continue;
    const mode = (i * 3 + 1) % 5;
    const beats = mode === 2 ? 1 : Math.min(2, beatsPerBar);
    const snareRoll = mode === 1 || mode === 4;
    const start = boundary - beats * beat;
    const steps = beats * stepsPerBeat;
    const tomPitches = beats === 1 ? [74, 67, 62, 55] : [76, 72, 69, 65, 62, 57, 53, 48];
    for (let k = 0; k < steps; k += 1) {
      const t = Math.round((start + k * sixteenth) * 1000) / 1000;
      if (t < 0.05 || t >= boundary - sixteenth * 0.45 || t >= duration - 0.05) continue;
      if (snareRoll) {
        const vel = Math.round((0.3 + (k / Math.max(1, steps - 1)) * 0.42) * 100) / 100;
        events.push({ t, kind: "snare", vel, fill: true });
      } else {
        events.push({
          t,
          kind: "tom",
          midi: tomPitches[Math.min(tomPitches.length - 1, k)],
          vel: 0.58,
          fill: true,
        });
      }
    }
    const thin = sections[i].name === "breakdown" || sections[i].name === "outro" || sections[i].name === "resolve";
    if (boundary < duration - 0.08) {
      events.push({
        t: Math.round(boundary * 1000) / 1000,
        kind: "crash",
        vel: thin ? 0.2 : 0.46,
        fill: true,
      });
    }
  }
  return events;
}

function renderWalk(L, R, notes) {
  const sampled = bankReady("bass");
  for (const note of notes) {
    const long = note.degree === "pedal";
    if (sampled && playNote(L, R, "bass", {
      midi: note.midi,
      t0: note.t,
      t1: note.t + (long ? note.dur * 0.8 : Math.min(note.dur, 0.34)),
      gain: long ? 0.28 : 0.34,
      panL: 0.707,
      panR: 0.707,
      attack: 0.012,
      release: long ? 0.4 : 0.16,
    })) continue;
    addSine(L, R, {
      t0: note.t,
      t1: note.t + (long ? note.dur : Math.min(note.dur, 0.28)),
      freq: midiFreq(note.midi),
      gain: long ? 0.16 : 0.22,
      panL: 0.707,
      panR: 0.707,
      attack: 0.014,
      release: long ? 0.4 : 0.18,
    });
    if (!long) {
      addSine(L, R, {
        t0: note.t,
        t1: note.t + 0.1,
        freq: midiFreq(note.midi) * 3,
        gain: 0.03,
        panL: 0.707,
        panR: 0.707,
        attack: 0.01,
        release: 0.08,
      });
    }
  }
}

function layPulse(L, R, plan) {
  const beat = 60 / plan.bpm;
  for (const section of plan.sections) {
    if (!section.layers.includes("pulse")) continue;
    for (let t = section.t0; t < section.t1 - 0.05; t += beat) {
      addKick(L, R, t, 0.15);
    }
  }
}

function layHeart(L, R, plan) {
  const beat = 60 / plan.bpm;
  const bar = plan.meter?.barLen || beat * 4;
  for (const section of plan.sections) {
    if (!section.layers.includes("heart")) continue;
    for (let t = section.t0; t < section.t1 - 0.08; t += bar) {
      addKick(L, R, t, 0.07);
      addKick(L, R, t + beat * 0.55, 0.045);
    }
  }
}

function addWind(L, R, duration) {
  const n = Math.min(L.length, Math.round(duration * SR));
  let hp = 0;
  let prev = 0;
  let bp = 0;
  let hpA = 0.9;
  let lpC = 0.1;
  for (let i = 0; i < n; i += 1) {
    if ((i & 63) === 0) {
      const fc = 420 + 900 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 0.05 * i) / SR));
      hpA = Math.exp((-2 * Math.PI * fc) / SR);
      lpC = 1 - Math.exp((-2 * Math.PI * (fc + 700)) / SR);
    }
    const noise = hashNoise(i + 404);
    const high = hpA * (hp + noise - prev);
    hp = high;
    prev = noise;
    bp += lpC * (high - bp);
    const s = bp * 0.012;
    L[i] += s * 0.65;
    R[i] += s * 0.75;
  }
}

function addRiser(L, R, t1, seconds) {
  const n = L.length;
  const i1 = clamp(Math.floor(t1 * SR), 0, n);
  const i0 = clamp(i1 - Math.floor(seconds * SR), 0, n);
  let hp = 0;
  let prev = 0;
  let bp = 0;
  const span = Math.max(1, i1 - i0);
  for (let i = i0; i < i1; i += 1) {
    const u = (i - i0) / span;
    const fc = 200 + u * u * 4200;
    const hpA = Math.exp((-2 * Math.PI * fc) / SR);
    const noise = hashNoise(i + 17);
    const high = hpA * (hp + noise - prev);
    hp = high;
    prev = noise;
    const lpC = 1 - Math.exp((-2 * Math.PI * (fc + 500)) / SR);
    bp += lpC * (high - bp);
    const env = Math.sin(u * Math.PI * 0.5) * 0.045;
    L[i] += bp * env * 0.55;
    R[i] += bp * env * 0.6;
  }
}

function sharedBreathe(L, R, rate, depth) {
  const n = L.length;
  for (let i = 0; i < n; i += 1) {
    const g = 1 - depth + depth * (0.5 + 0.5 * Math.sin((2 * Math.PI * rate * i) / SR));
    L[i] *= g;
    R[i] *= g;
  }
}

function fadeEdges(L, R, seconds) {
  const n = Math.min(L.length, Math.round(seconds * SR));
  for (let i = 0; i < n; i += 1) {
    const g = Math.sin((i / n) * Math.PI * 0.5);
    L[i] *= g;
    R[i] *= g;
    L[L.length - 1 - i] *= g;
    R[R.length - 1 - i] *= g;
  }
}

function bassMidiOf(rootPc) {
  let midi = rootPc + 36;
  while (midi > 43) midi -= 12;
  while (midi < 31) midi += 12;
  return midi;
}

function layBass(L, R, chord, t1, style) {
  const midi = bassMidiOf(chord.rootPc);
  const freq = midiFreq(midi);
  const gain = style === "lofi" ? 0.12 : 0.1;
  addSine(L, R, {
    t0: chord.t0,
    t1,
    freq,
    gain,
    panL: 0.707,
    panR: 0.707,
    attack: style === "lofi" ? 0.03 : 0.5,
    release: style === "lofi" ? 0.18 : 0.8,
  });
  addSine(L, R, {
    t0: chord.t0,
    t1,
    freq: freq * 3,
    gain: gain * 0.12,
    panL: 0.707,
    panR: 0.707,
    attack: style === "lofi" ? 0.02 : 0.4,
    release: style === "lofi" ? 0.12 : 0.5,
  });
}

function layRhodes(L, R, chord, bpm, seed, gainMul = 1, barLen = 0) {
  const beat = 60 / bpm;
  const bar = barLen > 0 ? barLen : beat * 4;
  const sampled = bankReady("ep");
  for (let barStart = chord.t0; barStart < chord.t1 - 0.05; barStart += bar) {
    const barEnd = Math.min(chord.t1, barStart + bar);
    chord.notes.forEach((midi, voice) => {
      const strum = voice * 0.008;
      const human = ((seed + voice * 13) % 5) * 0.0016;
      const pan = Math.sin(barStart * 0.4 + voice * 0.8) * 0.28;
      const [panL, panR] = panGains(pan);
      if (sampled) {
        playNote(L, R, "ep", {
          midi,
          t0: barStart + strum + human,
          t1: barEnd,
          gain: 0.2 * gainMul,
          panL,
          panR,
          attack: 0.018,
          release: 0.85,
          vibrato: 0.003,
          vibratoRate: 0.5,
          trem: 0.16,
          tremRate: 3.1,
        });
        const t = barStart + beat * 2;
        if (t < chord.t1 - 0.08) {
          playNote(L, R, "ep", {
            midi,
            t0: t + human,
            t1: t + beat * 0.45,
            gain: 0.07 * gainMul,
            panL,
            panR,
            attack: 0.01,
            release: 0.4,
            trem: 0.08,
            tremRate: 3.1,
          });
        }
        return;
      }
      const spec = {
        freq: midiFreq(midi),
        panL,
        panR,
        fc: 1100 + chord.sat * 700,
        hp: 160,
        index: 0.7,
        trem: 0.1,
        tremRate: 3.2,
        flutter: 0.003,
        flutterRate: 0.5,
        seed: seed + midi * 3 + voice,
      };
      addFm(L, R, {
        ...spec,
        t0: barStart + strum + human,
        t1: barEnd,
        gain: 0.17 * gainMul,
        attack: 0.03,
        release: 1.15,
      });
      [0, bar * 0.5].forEach((offset, hitIndex) => {
        const t = barStart + offset;
        if (t >= chord.t1 - 0.08) return;
        const vel = hitIndex === 0 ? 0.62 : 0.4;
        addFm(L, R, {
          ...spec,
          t0: t + strum * 0.6 + human,
          t1: t + beat * 0.35,
          gain: 0.11 * vel * gainMul,
          attack: 0.012,
          release: 0.85,
          seed: seed + midi + hitIndex * 17,
        });
      });
    });
  }
}

function arpPattern(chord, sectionName) {
  const tones = new Set(chord.notes.map((midi) => pcOf(midi)));
  const minor = tones.has(pcOf(chord.rootPc + 3));
  const degrees = [0, 7, 12, minor ? 15 : 16];
  let base = chord.rootPc + 60;
  while (base < 60) base += 12;
  while (base > 72) base -= 12;
  const up = degrees.map((degree) => base + degree);
  const name = sectionName || "A";
  if (name === "intro" || name === "outro" || name === "resolve") return [up[0], up[2]];
  if (name === "breakdown") return [up[0], up[1], up[2], up[1]];
  if (name === "A" || name === "A'") return up;
  return up.concat(up.slice(1, -1).reverse());
}

function layArp(L, R, plan) {
  const beat = 60 / plan.bpm;
  const meter = plan.meter || { name: "4/4", beats: 4, swing: 0.14, sub: 2 };
  const off = 0.5 * (1 + (meter.feel === "swing" ? meter.swing || 0 : 0));
  const played = [];
  for (const chord of plan.chords) {
    const section = sectionAt(plan.sections, chord.t0);
    const name = section ? section.name : "A";
    if (!section || !section.layers.includes("arp")) continue;
    const seq = arpPattern(chord, name);
    if (!seq.length) continue;
    const sparse = name === "intro" || name === "outro" || name === "resolve" || name === "breakdown";
    const sixteenths = name === "B" && meter.name === "4/4";
    const triplet = meter.name === "6/8" || meter.sub === 3;
    let step = 0;
    let t = chord.t0;
    while (t < chord.t1 - 0.08) {
      const midi = seq[step % seq.length];
      const span = Math.max(3, meter.beats || 4);
      const [panL, panR] = panGains(((step % span) - (span - 1) / 2) * 0.16);
      const downbeat = step % seq.length === 0;
      const eStep = energyAtBar(plan, t);
      const dur = sixteenths || triplet ? beat * 0.7 : beat * (sparse ? 2.2 : 1.7);
      if (eStep < 0.28 && !downbeat) {
        if (sparse) t += beat * Math.min(2, meter.beats || 2);
        else if (triplet) t += beat / 3;
        else if (meter.name === "3/4") t += beat * 0.5;
        else if (sixteenths) t += beat * 0.5;
        else t += beat * (step % 2 === 1 ? (1 - off) : off);
        step += 1;
        continue;
      }
      addPluck(L, R, {
        t,
        freq: midiFreq(Math.min(84, midi)),
        dur,
        vel: (downbeat ? 0.16 : 0.11) * (0.9 + chord.sat * 0.15) * (sparse ? 0.8 : 1) * (0.72 + 0.4 * eStep),
        fc: 1100 + chord.sat * 500,
        panL,
        panR,
      });
      played.push({ t: Math.round(t * 1000) / 1000, midi, section: name });
      if (sparse) t += beat * Math.min(2, meter.beats || 2);
      else if (triplet) t += beat / 3;
      else if (meter.name === "3/4") t += beat * 0.5;
      else if (sixteenths) t += beat * 0.5;
      else {
        const odd = step % 2 === 1;
        t += odd ? beat * (1 - off) : beat * off;
      }
      step += 1;
    }
  }
  return played;
}

function pingPong(L, R, bpm) {
  const n = L.length;
  const delay = Math.max(1, Math.round((60 / bpm) * 0.75 * SR));
  const dL = new Float32Array(delay);
  const dR = new Float32Array(delay);
  const fb = 0.34;
  let iL = 0;
  let iR = 0;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const wetL = dL[iL];
    const wetR = dR[iR];
    outL[i] = L[i] + wetR * 0.42;
    outR[i] = R[i] + wetL * 0.42;
    dL[iL] = L[i] * 0.65 + wetR * fb;
    dR[iR] = wetL * fb;
    iL += 1;
    if (iL >= delay) iL = 0;
    iR += 1;
    if (iR >= delay) iR = 0;
  }
  L.set(outL);
  R.set(outR);
}

function addOpenHat(L, R, t, vel) {
  const n = L.length;
  const i0 = clamp(Math.floor(t * SR), 0, n);
  const i1 = Math.min(n, i0 + Math.round(0.16 * SR));
  let hp = 0;
  let prev = 0;
  let lp = 0;
  const hpA = Math.exp((-2 * Math.PI * 5200) / SR);
  const lpC = 1 - Math.exp((-2 * Math.PI * 9000) / SR);
  const decay = Math.exp(-1 / (0.07 * SR));
  let env = 1;
  for (let i = i0; i < i1; i += 1) {
    const age = i - i0;
    const attack = age < 8 ? age / 8 : 1;
    env *= decay;
    const noise = hashNoise(i * 5 + 21);
    const high = hpA * (hp + noise - prev);
    hp = high;
    prev = noise;
    lp += lpC * (high - lp);
    const s = lp * env * attack * vel * 0.05;
    L[i] += s * 0.4;
    R[i] += s * 0.62;
  }
}

function addRim(L, R, t, vel) {
  const n = L.length;
  const i0 = clamp(Math.floor(t * SR), 0, n);
  const i1 = Math.min(n, i0 + Math.round(0.05 * SR));
  let phase = 0;
  const decay = Math.exp(-1 / (0.02 * SR));
  let env = 1;
  for (let i = i0; i < i1; i += 1) {
    env *= decay;
    phase += 880 / SR;
    if (phase >= 1) phase -= 1;
    const x = phase * TABLE;
    const idx = x | 0;
    const sine = SINE[idx] + (SINE[idx + 1] - SINE[idx]) * (x - idx);
    const s = (sine * 0.4 + hashNoise(i * 9 + 4) * 0.25) * env * vel * 0.16;
    L[i] += s * 0.35;
    R[i] += s * 0.55;
  }
}

function hitSample(L, R, bank, event, gain, release, lowpass) {
  return playNote(L, R, bank, {
    midi: 60,
    robin: event.robin || 0,
    t0: Math.max(0, event.t),
    t1: Math.max(0, event.t) + 0.008,
    gain,
    attack: 0.001,
    release,
    panL: bank === "snare" || bank === "hat" ? 0.46 : 0.66,
    panR: bank === "snare" || bank === "hat" ? 0.6 : 0.7,
    lowpass,
  });
}

function playDrum(L, R, event) {
  const t = Math.max(0, event.t);
  const vel = event.vel;
  const quiet = vel < 0.45;
  if (event.kind === "kick") {
    if (!hitSample(L, R, "kick", event, 0.97 * vel, 0.28, 0)) addKick(L, R, t, vel);
  } else if (event.kind === "snare") {
    if (!hitSample(L, R, "snare", event, 0.72 * vel, 0.2, quiet ? 6200 : 0)) addSnare(L, R, t, vel);
  } else if (event.kind === "open") {
    if (!hitSample(L, R, "open", event, 0.51 * vel, 0.55, 0)) addOpenHat(L, R, t, vel);
  } else if (event.kind === "rim") {
    if (!hitSample(L, R, "rim", event, 0.63 * vel, 0.08, quiet ? 5000 : 0)) addRim(L, R, t, vel);
  } else if (event.kind === "shaker") {
    hitSample(L, R, "shaker", event, 0.25 * vel, 0.12, quiet ? 4800 : 7000);
  } else if (!hitSample(L, R, "hat", event, (event.quiet ? 0.21 : 0.34) * vel, 0.06, quiet ? 5000 : 8500)) {
    addHat(L, R, t, vel);
  }
}

function layDrums(L, R, events, duration) {
  for (const event of events) {
    if (event.t > duration - 0.02) continue;
    playDrum(L, R, event);
  }
}

function eighthTime(barStart, beat, index) {
  const pair = Math.floor(index / 2);
  const odd = index % 2;
  return barStart + pair * beat + (odd ? beat * 0.58 : 0);
}

function buildGroove(duration, bpm, rng, sections, meter, humanize = 0.008) {
  const beat = 60 / bpm;
  const m = meter || { name: "4/4", beats: 4, sub: 2, barLen: beat * 4, feel: "swing", swing: 0.16, halfTime: false, stepsPerBeat: 4 };
  const bar = m.barLen || beat * (m.beats || 4);
  const humanAmt = humanize > 0 ? humanize : 0.008;
  const off = m.sub === 3 ? 2 / 3 : 0.5 * (1 + (m.swing || 0));
  const events = [];
  const boundaryAt = (t) => (sections || []).find((item, index) => index > 0 && Math.abs(item.t0 - t) < 0.004);
  const push = (t, kind, vel, fill, robin) => {
    if (t >= 0 && t < duration - 0.02) events.push({ t, kind, vel: +vel.toFixed(3), fill: Boolean(fill), robin });
  };
  const backbeats = () => {
    if (m.halfTime && m.beats >= 4) return [2];
    if (m.name === "3/4") return [2];
    if (m.name === "6/8") return [1];
    if (m.beats === 4) return [1, 3];
    return [Math.max(0, m.beats - 1)];
  };
  for (let barIndex = 0; ; barIndex += 1) {
    const barStart = barIndex * bar;
    if (barStart >= duration - 0.03) break;
    const section = sectionAt(sections, barStart + 0.001);
    const name = section ? section.name : "A";
    const here = boundaryAt(barStart);
    const next = boundaryAt(barStart + bar);
    const prev = here ? sections[sections.indexOf(here) - 1] : null;
    const hasDrums = Boolean(section && section.layers.includes("drums"));
    const prevDrums = Boolean(prev && prev.layers.includes("drums"));
    const lastOfSection = section && section.bar0 + section.bars - 1 === barIndex;
    if (here && prevDrums) {
      push(barStart, "kick", 1, false, barIndex);
      push(barStart, "open", 0.62, false, barIndex);
    }
    if (hasDrums) {
      if (!(here && prevDrums)) push(barStart, "kick", 0.94, false, barIndex * 2);
      if (!m.halfTime && m.beats === 4 && barIndex % 2 === 0 && !next) {
        push(barStart + beat * off, "kick", 0.4, false, barIndex * 2 + 3);
      }
      for (const b of backbeats()) {
        if (b === 0) continue;
        push(barStart + b * beat, next ? "snare" : "snare", next && b === backbeats()[0] ? 0.7 : 0.84, false, barIndex * 4 + b);
      }
      if (m.name === "3/4") push(barStart + beat, "rim", 0.34, false, barIndex + 7);
      if (next) {
        const fillFrom = Math.max(1, m.beats - 2);
        let n = 0;
        for (let b = fillFrom; b < m.beats; b += 1) {
          const slices = m.sub === 3 ? 3 : 2;
          for (let s = 0; s < slices; s += 1) {
            const pos = b + s / slices;
            push(barStart + pos * beat, "snare", 0.4 + n * 0.12, true, barIndex * 8 + n);
            n += 1;
          }
        }
      }
      const hatCount = m.sub === 3 ? m.beats * 2 : m.beats * 2;
      for (let h = 0; h < hatCount; h += 1) {
        if (h === 0 && here && prevDrums) continue;
        let when;
        if (m.sub === 3) {
          const group = Math.floor(h / 2);
          const which = h % 2;
          when = barStart + group * beat + (which ? beat * (2 / 3) : 0);
        } else {
          const onBeat = h % 2 === 0;
          when = barStart + Math.floor(h / 2) * beat + (onBeat ? 0 : beat * off);
        }
        const onGrid = m.sub === 3 ? h % 2 === 0 : h % 2 === 0;
        const human = onGrid ? 0 : (rng() - 0.5) * humanAmt;
        const open = !next && lastOfSection && (name === "B" || name === "A'") && h === hatCount - 1;
        push(when + human, open ? "open" : "hat", open ? 0.34 : 0.2, false, barIndex * 8 + h);
      }
      if (name === "B") {
        const shakerN = m.sub === 3 ? m.beats * 2 : m.beats;
        for (let h = 0; h < shakerN; h += 1) {
          const when = m.sub === 3
            ? barStart + Math.floor(h / 2) * beat + (h % 2 ? beat * (2 / 3) : 0)
            : barStart + h * beat + beat * off * 0.5;
          push(when, "shaker", 0.16, false, h);
        }
      }
    } else if (section && section.layers.includes("rim")) {
      for (const b of backbeats()) push(barStart + b * beat, "rim", b === backbeats()[0] ? 0.48 : 0.36, false, barIndex + b);
    } else if (name === "intro" && next) {
      push(barStart + (m.beats - 1) * beat, "hat", 0.16, false, 0);
    }
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

function layBassGroove(L, R, chords, events) {
  const notes = [];
  const kicks = events.filter((event) => event.kind === "kick");
  for (const chord of chords) {
    const inChord = kicks.filter((kick) => kick.t >= chord.t0 - 0.03 && kick.t < chord.t1 - 0.03);
    const next = chords.find((item) => item.t0 > chord.t0 + 0.05);
    inChord.forEach((kick, index) => {
    const root = bassMidiOf(chord.rootPc);
    const last = index === inChord.length - 1;
    let midi = root;
    let degree = "root";
    // A chromatic approach only right before the change (within about a beat), so it leads straight into the
    // next root instead of hanging against the current chord.
    if (last && next && next.rootPc !== chord.rootPc && next.t0 - kick.t < 0.9) {
      let approach = bassMidiOf(next.rootPc) - 1;
      while (approach > 43) approach -= 12;
      while (approach < 31) approach += 12;
      midi = approach;
      degree = "approach";
    } else if (kick.vel < 0.7) {
      let fifth = root + 7;
      while (fifth > 43) fifth -= 12;
      midi = fifth;
      degree = "fifth";
    }
    const freq = midiFreq(midi);
    const gain = 0.26 * (0.72 + kick.vel * 0.4);
    addSine(L, R, {
      t0: kick.t,
      t1: kick.t + 0.16,
      freq,
      gain,
      panL: 0.707,
      panR: 0.707,
      attack: 0.016,
      release: 0.24,
    });
    addSine(L, R, {
      t0: kick.t,
      t1: kick.t + 0.1,
      freq: freq * 3,
      gain: gain * 0.14,
      panL: 0.707,
      panR: 0.707,
      attack: 0.012,
      release: 0.12,
    });
    notes.push({
      t: Math.round(kick.t * 1000) / 1000,
      midi,
      degree,
      vel: kick.vel,
    });
    });
  }
  return notes;
}

function shortPlate(L, R) {
  const n = L.length;
  const taps = [0.031, 0.047, 0.073].map((seconds) => Math.round(seconds * SR));
  const bufL = taps.map((len) => new Float32Array(len));
  const bufR = taps.map((len) => new Float32Array(len + 13));
  const iL = taps.map(() => 0);
  const iR = taps.map(() => 0);
  const fb = 0.34;
  const wet = 0.22;
  const lpC = 1 - Math.exp((-2 * Math.PI * 3400) / SR);
  let lpL = 0;
  let lpR = 0;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let wL = 0;
    let wR = 0;
    for (let k = 0; k < taps.length; k += 1) {
      wL += bufL[k][iL[k]];
      wR += bufR[k][iR[k]];
    }
    wL /= taps.length;
    wR /= taps.length;
    lpL += lpC * (wL - lpL);
    lpR += lpC * (wR - lpR);
    for (let k = 0; k < taps.length; k += 1) {
      bufL[k][iL[k]] = L[i] + lpR * fb;
      bufR[k][iR[k]] = R[i] + lpL * fb;
      iL[k] += 1;
      if (iL[k] >= bufL[k].length) iL[k] = 0;
      iR[k] += 1;
      if (iR[k] >= bufR[k].length) iR[k] = 0;
    }
    outL[i] = L[i] + lpL * wet;
    outR[i] = R[i] + lpR * wet;
  }
  L.set(outL);
  R.set(outR);
}

function addHiss(L, R) {
  const n = L.length;
  const hpA = Math.exp((-2 * Math.PI * 500) / SR);
  const lpC = 1 - Math.exp((-2 * Math.PI * 4800) / SR);
  let hpL = 0;
  let hpR = 0;
  let pL = 0;
  let pR = 0;
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < n; i += 1) {
    const nL = hashNoise(i + 7);
    const nR = hashNoise(i + 90001);
    const oL = hpA * (hpL + nL - pL);
    const oR = hpA * (hpR + nR - pR);
    hpL = oL;
    hpR = oR;
    pL = nL;
    pR = nR;
    lpL += lpC * (oL - lpL);
    lpR += lpC * (oR - lpR);
    L[i] += lpL * 0.0032;
    R[i] += lpR * 0.0032;
  }
}

function defaultLead(style) {
  if (style === "lofi") return "ep-tine";
  if (style === "arp") return "soft-square";
  if (style === "synthwave") return "saw-lead";
  return "celesta-bell";
}

function defaultPad(style) {
  if (style === "lofi") return "rhodes";
  if (style === "arp") return "sine-choir";
  if (style === "synthwave") return "saw-pad";
  return "wavetable-saw";
}

function defaultBass(style) {
  if (style === "lofi") return "walk-upright";
  if (style === "arp") return "root-sustain";
  if (style === "synthwave") return "pulse-8ths";
  return "sine-pedal";
}

function defaultDrums(style) {
  if (style === "lofi") return "dusty-samples";
  if (style === "arp") return "pulse-tick";
  if (style === "synthwave") return "gated-80s";
  return "heartbeat";
}

function energyAtBar(plan, t) {
  const bar = plan?.meter?.barLen || (plan?.bpm ? (60 / plan.bpm) * (plan?.meter?.beats || 4) : 2);
  const i = Math.max(0, Math.floor((t + 0.0001) / Math.max(0.05, bar)));
  const e = plan?.energy?.[i];
  return Number.isFinite(e) ? e : 0.55;
}

function layLeadAlt(L, R, note, style, timbre, gain, panL, panR, prevMidi, prevEnd) {
  const t1 = note.t + note.dur;
  const freq = midiFreq(note.midi);
  if (timbre === "fm-vibes") {
    addFm(L, R, {
      t0: note.t, t1, freq, gain: gain * 0.95, panL, panR,
      attack: 0.015, release: 0.35, fc: 2400, hp: 180, index: 1.15, ratio: 1,
      trem: 0.18, tremRate: 5.2, seed: note.midi * 3,
    });
  } else if (timbre === "glass-fm") {
    addFm(L, R, {
      t0: note.t, t1: note.t + Math.min(note.dur, 0.7), freq, gain: gain * 0.7, panL, panR,
      attack: 0.02, release: 0.4, fc: 3200, hp: 240, index: 1.65, ratio: 2.6, seed: note.midi * 9,
    });
    addWavetable(L, R, {
      t0: note.t, t1, freq, gain: gain * 0.28, panL, panR,
      attack: 0.08, release: 0.3, fc: 1800, table: TRI, hp: 200, lfoDepth: 0, ampDepth: 0, fEnv: 0.8, fDecay: 0.3,
    });
  } else if (timbre === "soft-ep") {
    if (!playNote(L, R, "ep", {
      midi: note.midi, t0: note.t, t1, gain: gain * (style === "lofi" ? 1 : 0.75),
      panL, panR, attack: 0.012, release: 0.22, trem: 0.16, tremRate: 4.6,
    })) {
      addFm(L, R, {
        t0: note.t, t1, freq, gain: gain * 0.7, panL, panR,
        attack: 0.02, release: 0.2, fc: 2000, index: 0.8, ratio: 1, seed: note.midi,
      });
    }
  } else if (timbre === "muted-guitar") {
    if (!playNote(L, R, "mute", {
      midi: note.midi, t0: note.t, t1, gain: gain * 0.9, panL, panR, attack: 0.008, release: 0.18,
    })) {
      addPluck(L, R, { t: note.t, freq, dur: Math.min(note.dur, 0.9), vel: gain * 1.15, fc: 1600, panL, panR });
    }
  } else if (timbre === "soft-square") {
    addWavetable(L, R, {
      t0: note.t, t1, freq, gain: gain * (style === "arp" ? 1.35 : 1.05), panL, panR,
      attack: 0.03, release: 0.28, fc: 1500, table: SQUARE_SOFT, hp: 160, lfoDepth: 0.05, ampDepth: 0, fEnv: 1.3, fDecay: 0.16,
    });
  } else if (timbre === "marimba-fm") {
    addFm(L, R, {
      t0: note.t, t1: note.t + Math.min(note.dur, 0.4), freq, gain: gain * 0.82, panL, panR,
      attack: 0.006, release: 0.16, fc: 2100, hp: 140, index: 1.4, ratio: 3.4, seed: note.midi * 5,
    });
  } else if (timbre === "pluck") {
    addPluck(L, R, {
      t: note.t, freq, dur: Math.max(0.16, Math.min(note.dur, 1.1)), vel: gain * 1.2, fc: 1700, panL, panR,
    });
  } else if (timbre === "sync-brass" || timbre === "saw-lead") {
    const close = prevMidi != null && note.t - prevEnd < 0.09;
    const from = close ? midiFreq(prevMidi) : freq;
    addPortaSaw(L, R, {
      t0: note.t, t1, freq, fromFreq: from, glide: close ? 0.05 : 0,
      gain: gain * (timbre === "sync-brass" ? 0.9 : 1), panL, panR,
      attack: timbre === "sync-brass" ? 0.07 : 0.035, release: 0.2,
      fc: timbre === "sync-brass" ? 1050 : 2200, table: SAW_BRIGHT, phase0: 0.5,
    });
  } else if (timbre === "dx-bell") {
    addBell(L, R, { t: note.t, freq, dur: Math.min(note.dur, 0.85), vel: gain * 0.4, panL, panR });
    addFm(L, R, {
      t0: note.t, t1: note.t + Math.min(note.dur, 0.45), freq, gain: gain * 0.38, panL, panR,
      attack: 0.01, release: 0.22, fc: 2800, hp: 260, index: 1.55, ratio: 3.5, seed: note.midi,
    });
  } else {
    playNote(L, R, "celesta", {
      midi: note.midi, t0: note.t, t1: note.t + Math.min(0.12, note.dur), gain: gain * 0.85,
      panL, panR, attack: 0.015, release: 0.8,
    });
    addWavetable(L, R, {
      t0: note.t, t1, freq, gain: gain * 0.55, panL, panR,
      attack: 0.2, release: 0.45, fc: 1900, table: TRI, hp: 180, lfoDepth: 0, ampDepth: 0, fEnv: 0.7, fDecay: 0.4,
    });
  }
}

function layAirPad(L, R, chord, t1, style, amount) {
  if (!(amount > 0)) return;
  // A detuned, wide pair an octave over the top voice (the pad chorus adds the rest).
  const top = (chord.notes || []).slice().sort((a, b) => a - b).slice(-1).map((m) => m + 12).filter((m) => m <= 91);
  top.forEach((midi, v) => {
    const pairs = [[-7, -0.7], [6, 0.7]];
    for (const [cents, pan] of pairs) {
      const [panL, panR] = panGains(pan * (v ? 1 : 0.8));
      addWavetable(L, R, {
        t0: chord.t0, t1, freq: midiFreq(midi) * 2 ** (cents / 1200), gain: 0.0125 * amount, panL, panR,
        attack: 1.3, release: 1.8, fc: style === "lofi" ? 1700 : 2700, table: SAW_SOFT, hp: 400,
        lfoRate: 0.09, lfoDepth: 0.45, lfoPhase: v * 1.3 + (cents > 0 ? 0.9 : 0), wobble: 0.04,
        ampDepth: 0.12, wobblePhase: v + cents, drift: 0.002,
      });
    }
  });
}

function layPadAlt(L, R, chord, t1, name) {
  const notes = (chord.notes || []).slice().sort((a, b) => a - b).slice(-3);
  if (!notes.length) return;
  if (name === "glass-fm-pad") {
    addPadVoices(L, R, {
      t0: chord.t0,
      t1,
      attack: 1.2,
      release: 1.5,
      voices: notes.map((midi, voice) => {
        const [panL, panR] = panGains((voice % 2 ? 1 : -1) * 0.16);
        return { freq: midiFreq(midi), gain: 0.032, panL, panR };
      }),
    });
    const top = notes[notes.length - 1];
    const [panL, panR] = panGains(0.2);
    addFm(L, R, {
      t0: chord.t0, t1: Math.min(t1, chord.t0 + 0.42), freq: midiFreq(top), gain: 0.02, panL, panR,
      attack: 0.05, release: 0.36, fc: 2200, hp: 180, index: 1.15, ratio: 2.4, seed: top,
    });
    return;
  }
  if (name === "string-ensemble" || name === "warm-strings") {
    const all = (chord.notes || []).slice().sort((a, b) => a - b);
    const picked = [...new Set(all.slice(-4))];
    const detunes = name === "warm-strings" ? [-6, 5] : [-9, 8];
    const gain = (name === "warm-strings" ? 0.028 : 0.022) * Math.sqrt(2 / Math.max(2, picked.length));
    const voices = [];
    picked.forEach((midi, voice) => {
      detunes.forEach((cents, d) => {
        const [panL, panR] = panGains((d === 0 ? -1 : 1) * (0.3 + voice * 0.1));
        voices.push({
          freq: midiFreq(midi) * 2 ** (cents / 1200),
          gain,
          panL,
          panR,
        });
      });
    });
    addPadVoices(L, R, {
      t0: chord.t0,
      t1,
      attack: name === "warm-strings" ? 0.7 : 1.05,
      release: name === "warm-strings" ? 0.85 : 0.9,
      voices,
    });
    return;
  }
  if (name === "muted-organ") {
    notes.forEach((midi, voice) => {
      const [panL, panR] = panGains(voice % 2 ? 0.1 : -0.1);
      const freq = midiFreq(midi);
      addSine(L, R, { t0: chord.t0, t1, freq, gain: 0.042, panL, panR, attack: 0.06, release: 0.18 });
      addSine(L, R, { t0: chord.t0, t1, freq: freq * 2, gain: 0.016, panL, panR, attack: 0.05, release: 0.14 });
    });
    return;
  }
  if (name === "pwm-square") {
    notes.forEach((midi, voice) => {
      const [panL, panR] = panGains(voice % 2 ? 0.2 : -0.2);
      addWavetable(L, R, {
        t0: chord.t0, t1, freq: midiFreq(midi), gain: 0.042 / Math.sqrt(notes.length), panL, panR,
        attack: 0.35, release: 0.4, fc: 1100, table: SQUARE_SOFT, hp: 80, fEnv: 0.7, fDecay: 0.9,
        lfoRate: 0.22, lfoDepth: 0.32, lfoPhase: voice, wobble: 0.015, ampDepth: 0.04, wobblePhase: 0.2, drift: 0.001,
      });
    });
  }
}

function laySubTwoFeel(L, R, notes, plan) {
  const beat = 60 / plan.bpm;
  const bar = plan.meter?.barLen || beat * 4;
  for (const note of notes) {
    if (note.degree === "pedal") {
      addSine(L, R, {
        t0: note.t, t1: note.t + note.dur, freq: midiFreq(note.midi), gain: 0.16,
        panL: 0.707, panR: 0.707, attack: 0.04, release: 0.2,
      });
      continue;
    }
    const pos = ((note.t % bar) + bar) % bar;
    const beatIndex = Math.round(pos / beat);
    if (beatIndex % 2 !== 0) continue;
    addSine(L, R, {
      t0: note.t, t1: note.t + Math.min(note.dur, beat * 0.85), freq: midiFreq(note.midi), gain: 0.2,
      panL: 0.707, panR: 0.707, attack: 0.015, release: 0.1,
    });
  }
}

function layPluckBass(L, R, notes) {
  for (const note of notes) {
    addPluck(L, R, {
      t: note.t, freq: midiFreq(note.midi), dur: Math.min(0.42, note.dur + 0.08),
      vel: 0.22, fc: 300, panL: 0.707, panR: 0.707,
    });
    addSine(L, R, {
      t0: note.t, t1: note.t + Math.min(0.16, note.dur), freq: midiFreq(Math.max(24, note.midi - 12)),
      gain: 0.055, panL: 0.707, panR: 0.707, attack: 0.008, release: 0.08,
    });
  }
}

function laySynthKit(L, R, events, mul) {
  for (const event of events) {
    const vel = event.vel * mul;
    if (event.kind === "kick") addKick(L, R, event.t, vel * 0.85, mul > 0.7);
    else if (event.kind === "snare" || event.kind === "clap") addSnare(L, R, event.t, vel * 0.72);
    else if (event.kind === "rim") addRim(L, R, event.t, vel * 0.6);
    else if (event.kind === "open") addOpenHat(L, R, event.t, vel * 0.5);
    else if (event.kind === "crash") addCrash(L, R, event.t, vel * 0.55);
    else if (event.kind === "tom") addTom(L, R, event.t, event.midi || 47, vel);
    else addHat(L, R, event.t, vel * 0.4);
  }
}

function layDrumPalette(L, R, events, name, duration) {
  if (!name || name === "none") return;
  if (name === "brush-rim") {
    const brushed = events.map((event) => {
      if (event.kind === "snare") return { ...event, kind: "rim", vel: Math.min(0.5, event.vel * 0.7) };
      if (event.kind === "hat" || event.kind === "open") return { ...event, vel: event.vel * 0.65 };
      return event;
    });
    layDrums(L, R, brushed, duration);
    return;
  }
  if (name === "synth-808") {
    laySynthKit(L, R, events, 1);
    return;
  }
  if (name === "gated-80s") {
    layMachine(L, R, events);
    return;
  }
  layDrums(L, R, events, duration);
}

function shapeEnergy(events, plan, duration, climaxT) {
  const bar = plan?.meter?.barLen || (60 / plan.bpm) * (plan?.meter?.beats || 4);
  const beat = 60 / plan.bpm;
  const out = [];
  for (const event of events) {
    const e = energyAtBar(plan, event.t);
    if (e < 0.2 && event.kind !== "kick") continue;
    if (e < 0.36 && (event.kind === "hat" || event.kind === "shaker" || event.kind === "open")) {
      const pos = ((event.t / beat) % 1 + 1) % 1;
      if (pos > 0.08 && pos < 0.9) continue;
    }
    let vel = event.vel * (0.64 + 0.5 * e);
    if (climaxT != null && Math.abs(event.t - climaxT) < bar) vel *= 1.08;
    out.push({ ...event, vel: +Math.min(1, vel).toFixed(3) });
  }
  for (let t0 = 0; t0 < duration - 0.05; t0 += bar) {
    if (energyAtBar(plan, t0 + 0.01) < 0.78) continue;
    const section = sectionAt(plan.sections, t0 + 0.01);
    if (!section || !(section.layers.includes("drums") || section.layers.includes("pulse"))) continue;
    if (!out.some((event) => event.t >= t0 && event.t < t0 + bar)) continue;
    const step = beat / 4;
    for (let h = 0; h < bar - step * 0.4; h += step) {
      const when = Math.round((t0 + h) * 1000) / 1000;
      if (when >= duration - 0.04) continue;
      if (out.some((event) => Math.abs(event.t - when) < step * 0.35 && (event.kind === "hat" || event.kind === "open" || event.kind === "kick"))) continue;
      out.push({ t: when, kind: "hat", vel: 0.12, fill: false, robin: 2 });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function addCutDrums(events, cuts, beat, duration, style) {
  if (style === "ambient" || style === "arp" || !(beat > 0)) return events;
  for (const cut of cuts) {
    const t = Math.round((Math.round(cut / beat) * beat) * 1000) / 1000;
    if (t < 0.05 || t > duration - 0.08) continue;
    const kind = style === "synthwave" ? "crash" : "kick";
    if (events.some((event) => Math.abs(event.t - t) < 0.035 && (event.kind === kind || event.kind === "kick" || event.kind === "crash"))) continue;
    events.push({ t, kind, vel: 0.68, fill: true, robin: 3 });
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

function fourOnFloor(events, plan, duration) {
  const beat = 60 / plan.bpm;
  for (let t = 0; t < duration - 0.05; t += beat) {
    const when = Math.round(t * 1000) / 1000;
    const section = sectionAt(plan.sections, when);
    if (!section || !section.layers.includes("drums")) continue;
    if (events.some((event) => event.kind === "kick" && Math.abs(event.t - when) < 0.03)) continue;
    events.push({ t: when, kind: "kick", vel: 0.78, fill: false, robin: 1 });
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

function layShakers(L, R, plan) {
  const beat = 60 / plan.bpm;
  for (const section of plan.sections) {
    if (!section.layers.includes("pulse")) continue;
    for (let t = section.t0; t < section.t1 - 0.05; t += beat / 2) {
      const e = energyAtBar(plan, t);
      if (e < 0.22) continue;
      if (!hitSample(L, R, "shaker", { t, robin: Math.floor(t * 3) % 4 }, 0.4 * e, 0.12, 6200)) {
        addHat(L, R, t, 0.12 * e);
      }
    }
  }
}

function laySoft808(L, R, plan) {
  const beat = 60 / plan.bpm;
  for (const section of plan.sections) {
    if (!section.layers.includes("pulse")) continue;
    for (let t = section.t0; t < section.t1 - 0.05; t += beat) {
      const e = energyAtBar(plan, t);
      if (e < 0.2) continue;
      addKick(L, R, t, 0.16 * (0.55 + e), false);
      if (e >= 0.35) addHat(L, R, t + beat * 0.5, 0.07 * e);
    }
  }
}

function laySoftToms(L, R, plan) {
  const bar = plan.meter?.barLen || (60 / plan.bpm) * (plan.meter?.beats || 4);
  for (const section of plan.sections) {
    if (!section.layers.includes("heart") && section.name !== "B") continue;
    for (let t = section.t0; t < section.t1 - 0.08; t += bar) {
      const e = 0.45 + 0.55 * energyAtBar(plan, t);
      addTom(L, R, t, 50, 0.18 * e);
      addTom(L, R, t + bar * 0.66, 43, 0.12 * e);
    }
  }
}

function layTexture(L, R, name, duration, rng) {
  if (name === "vinyl-crackle") addCrackle(L, R, duration, rng);
  else if (name === "tape-hiss") addHiss(L, R);
  else if (name === "wind") addWind(L, R, duration);
  else if (name === "rain") addRain(L, R, duration);
  else if (name === "shimmer") addShimmerBed(L, R, duration);
}

function addRain(L, R, duration) {
  const n = Math.min(L.length, Math.round(duration * SR));
  const hpA = Math.exp((-2 * Math.PI * 2400) / SR);
  const lpC = 1 - Math.exp((-2 * Math.PI * 7200) / SR);
  let hpL = 0;
  let hpR = 0;
  let pL = 0;
  let pR = 0;
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < n; i += 1) {
    const nL = hashNoise(i + 17);
    const nR = hashNoise(i + 8100);
    const oL = hpA * (hpL + nL - pL);
    const oR = hpA * (hpR + nR - pR);
    hpL = oL;
    hpR = oR;
    pL = nL;
    pR = nR;
    lpL += lpC * (oL - lpL);
    lpR += lpC * (oR - lpR);
    L[i] += lpL * 0.0036;
    R[i] += lpR * 0.0036;
  }
  const drops = Math.max(3, Math.round(duration / 0.47));
  for (let d = 0; d < drops; d += 1) {
    const t = (d * 0.47 + ((d * 13) % 7) * 0.02) % Math.max(0.3, duration - 0.05);
    const i0 = clamp(Math.floor(t * SR), 0, Math.max(0, n - 8));
    for (let k = 0; k < 6; k += 1) {
      const s = hashNoise(i0 + k * 3 + d * 19) * 0.018 * (1 - k / 6);
      L[i0 + k] += s;
      R[i0 + k] += s * 0.75;
    }
  }
}

function addShimmerBed(L, R, duration) {
  const n = Math.min(L.length, Math.round(duration * SR));
  const hpA = Math.exp((-2 * Math.PI * 4000) / SR);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i += 1) {
    const noise = hashNoise(i + 333);
    const out = hpA * (hp + noise - prev);
    hp = out;
    prev = noise;
    const trem = 0.65 + 0.35 * Math.sin((i / SR) * 0.35 * Math.PI * 2);
    const s = out * 0.0022 * trem;
    L[i] += s * 0.65;
    R[i] += s;
  }
}

function accentCuts(bells, bassL, bassR, analysis, plan, style) {
  const beat = 60 / plan.bpm;
  if (!(beat > 0)) return;
  for (const cut of analysis.cuts || []) {
    const t = Math.round((Math.round(cut / beat) * beat) * 1000) / 1000;
    if (t < 0.08 || t > analysis.duration - 0.15) continue;
    if (style === "lofi" || style === "synthwave") continue;
    const chord = chordAt(plan.chords, t);
    if (!chord?.notes?.length) continue;
    if (style === "ambient") {
      if (bells.some((bell) => Math.abs(bell.t - t) < 0.08)) continue;
      bells.push({ t, midi: Math.min(96, Math.max(...chord.notes) + 12), vel: 0.048, dur: 0.4, kind: "fill" });
    } else {
      addSine(bassL, bassR, {
        t0: Math.max(0, t - 0.06), t1: t + 0.26, freq: midiFreq(bassMidiOf(chord.rootPc)), gain: 0.09,
        panL: 0.707, panR: 0.707, attack: 0.07, release: 0.16,
      });
    }
  }
}
