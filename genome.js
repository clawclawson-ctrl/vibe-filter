// Video -> musical genome. Pure: no I/O, no Math.random, no Date.
// The seed is the picture only. Style picks which labelled RNG stream to read.
//
// Grid: meter.sub is 2 (simple) or 3 (compound). Steps per beat are sub*2
// (16ths) in simple meters and sub (8ths) in compound meters. BPM is the beat
// (a dotted quarter in 6/8 and 12/8). barLen = beats * 60 / bpm.

const MOTION_LO = 0.012;
const MOTION_HI = 0.14;
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const MODE_RANK = ["lydian", "major", "mixolydian", "dorian", "minor", "harmonicMinor", "phrygian"];
const MODE_TITLE = {
  major: "major",
  minor: "minor",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  dorian: "Dorian",
  phrygian: "Phrygian",
  harmonicMinor: "harmonic minor",
};

const POOLS = {
  major: [
    ["royal", ["IV", "V", "iii", "vi"]],
    ["canon", ["I", "V", "vi", "iii", "IV", "I", "IV", "V"]],
    ["komuro", ["vi", "IV", "V", "I"]],
    ["marusa", ["IV", "III7", "vi", "I"]],
    ["1564", ["I", "V", "vi", "IV"]],
    ["1625", ["I", "vi", "ii", "V"]],
    ["2516", ["ii", "V", "I", "vi"]],
    ["6251", ["vi", "ii", "V", "I"]],
    ["desc7", ["IV", "iii", "ii", "I"]],
    ["slash", ["I", "V/V", "IV", "Vsus"]],
    ["pedal", ["I", "IV", "I", "V"]],
    ["doo", ["I", "vi", "IV", "V"]],
    ["borrow", ["I", "bVII", "IV", "I"]],
    ["color", ["I", "bVI", "bVII", "I"]],
  ],
  minor: [
    ["andalusian", ["i", "bVII", "bVI", "V"]],
    ["komuro", ["i", "bVI", "bIII", "bVII"]],
    ["sensitive", ["i", "iv", "V", "i"]],
    ["1625", ["i", "bVI", "ii", "V"]],
    ["ivV", ["i", "iv", "bVII", "V"]],
    ["aeolian", ["i", "bVII", "bVI", "iv"]],
    ["canon", ["i", "V", "bVI", "bIII", "iv", "i", "iv", "V"]],
    ["deceptive", ["i", "iv", "V", "bVI"]],
    ["pedal", ["i", "iv", "i", "V"]],
    ["pop", ["i", "bVI", "bIII", "bVII"]],
    ["lament", ["i", "bVI", "iv", "V"]],
    ["plagal", ["i", "iv", "bVII", "i"]],
  ],
  mixolydian: [
    ["bVII", ["I", "bVII", "IV", "I"]],
    ["v", ["I", "v", "IV", "I"]],
    ["mix", ["I", "bVII", "IV", "v"]],
    ["royal", ["IV", "v", "iii", "vi"]],
    ["1564", ["I", "v", "vi", "IV"]],
    ["1625", ["I", "vi", "ii", "v"]],
    ["pedal", ["I", "IV", "I", "bVII"]],
    ["doo", ["I", "vi", "IV", "bVII"]],
    ["desc", ["IV", "iii", "ii", "I"]],
    ["color", ["I", "bVI", "bVII", "I"]],
    ["slash", ["I", "Vsus", "IV", "bVII"]],
    ["turn", ["vi", "IV", "bVII", "I"]],
  ],
  dorian: [
    ["iIV", ["i", "IV", "i", "IV"]],
    ["ii", ["i", "ii", "bVII", "IV"]],
    ["loop", ["i", "bVII", "IV", "i"]],
    ["v", ["i", "v", "IV", "i"]],
    ["pedal", ["i", "IV", "i", "bVII"]],
    ["color", ["i", "bVI", "bVII", "i"]],
    ["bII", ["i", "bII", "IV", "i"]],
    ["vi", ["i", "vi", "IV", "bVII"]],
    ["plagal", ["i", "IV", "bVII", "i"]],
    ["turn", ["i", "bVII", "ii", "IV"]],
    ["long", ["i", "IV", "bVII", "IV", "i"]],
    ["modal", ["i", "ii", "IV", "i"]],
  ],
  lydian: [
    ["III", ["I", "II", "vii", "I"]],
    ["bright", ["I", "II", "V", "I"]],
    ["vi", ["I", "II", "vi", "V"]],
    ["turn", ["vi", "II", "V", "I"]],
    ["pedal", ["I", "II", "I", "V"]],
    ["iii", ["I", "iii", "II", "V"]],
    ["color", ["I", "bVII", "II", "I"]],
    ["canon", ["I", "V", "vi", "iii", "II", "I"]],
    ["slash", ["I", "V/V", "II", "Vsus"]],
    ["desc", ["II", "vii", "V", "I"]],
    ["borrow", ["I", "iv", "II", "I"]],
    ["open", ["I", "V", "II", "vi"]],
  ],
  phrygian: [
    ["bII", ["i", "bII", "bVII", "i"]],
    ["andalusian", ["i", "bVII", "bVI", "bII"]],
    ["loop", ["i", "bII", "iv", "bII"]],
    ["v", ["i", "bII", "v", "i"]],
    ["pedal", ["i", "bII", "i", "bVII"]],
    ["color", ["i", "bVI", "bII", "i"]],
    ["bIII", ["i", "bIII", "bII", "i"]],
    ["plagal", ["i", "iv", "bII", "i"]],
    ["turn", ["i", "bVII", "bII", "i"]],
    ["long", ["i", "bII", "bVII", "bVI", "i"]],
    ["modal", ["i", "bII", "iv", "bVII"]],
    ["drone", ["i", "i", "bII", "i"]],
  ],
  harmonicMinor: [
    ["V7", ["i", "iv", "V7", "i"]],
    ["sensitive", ["i", "VI", "iv", "V7"]],
    ["andalusian", ["i", "bVII", "bVI", "V"]],
    ["viio", ["i", "viio", "V7", "i"]],
    ["canon", ["i", "V", "bVI", "bIII", "iv", "V7"]],
    ["pedal", ["i", "iv", "i", "V7"]],
    ["deceptive", ["i", "iv", "V7", "bVI"]],
    ["ii", ["i", "ii", "V7", "i"]],
    ["color", ["i", "bII", "V7", "i"]],
    ["plagal", ["i", "iv", "bVI", "V"]],
    ["turn", ["i", "bVI", "iv", "V7"]],
    ["long", ["i", "iv", "bVI", "V7", "i"]],
  ],
};

const FUNC = {
  major: { T: ["I", "vi", "iii"], S: ["ii", "IV"], D: ["V", "Vsus", "vii"] },
  minor: { T: ["i", "bVI", "bIII"], S: ["iv", "ii"], D: ["V", "bVII"] },
  mixolydian: { T: ["I", "vi", "iii"], S: ["IV", "ii"], D: ["bVII", "v", "Vsus"] },
  dorian: { T: ["i", "bIII", "vi"], S: ["ii", "IV"], D: ["bVII", "v"] },
  lydian: { T: ["I", "iii", "vi"], S: ["II", "vii"], D: ["V", "Vsus"] },
  phrygian: { T: ["i", "bIII"], S: ["iv", "bVI"], D: ["bII", "bVII"] },
  harmonicMinor: { T: ["i", "bVI", "bIII"], S: ["iv", "ii"], D: ["V7", "V", "viio"] },
};

const PARALLEL = {
  major: ["I", "bIII", "bVI", "bVII"],
  minor: ["i", "bIII", "bVI", "bVII"],
  mixolydian: ["I", "bIII", "bVII", "IV"],
  dorian: ["i", "bIII", "bVII", "IV"],
  lydian: ["I", "II", "bIII", "V"],
  phrygian: ["i", "bII", "bIII", "bVII"],
  harmonicMinor: ["i", "bIII", "bVI", "V7"],
};

const BORROW = {
  major: ["iv", "bVII", "bVI", "bII"],
  minor: ["IV", "I", "bII"],
  mixolydian: ["iv", "bVI", "bII"],
  dorian: ["bVI", "bII", "iv"],
  lydian: ["iv", "bVII", "bVI"],
  phrygian: ["Vsus", "bVI"],
  harmonicMinor: ["bVII", "bII"],
};

const PALETTE = {
  ambient: {
    lead: ["celesta-bell", "fm-vibes", "glass-fm", "soft-ep"],
    pad: ["wavetable-saw", "glass-fm-pad", "string-ensemble"],
    bass: ["sine-pedal", "none-with-low-pad"],
    drums: ["heartbeat", "soft-toms", "none"],
    texture: ["wind", "rain", "shimmer", "none"],
  },
  lofi: {
    lead: ["ep-tine", "muted-guitar", "fm-vibes", "soft-square"],
    pad: ["rhodes", "warm-strings", "muted-organ"],
    bass: ["walk-upright", "sub-sine-2feel", "pluck-bass"],
    drums: ["dusty-samples", "brush-rim", "synth-808"],
    texture: ["vinyl-crackle", "tape-hiss", "rain", "none"],
  },
  arp: {
    lead: ["soft-square", "marimba-fm", "pluck", "celesta-bell"],
    pad: ["sine-choir", "glass-fm-pad", "string-ensemble"],
    bass: ["root-sustain", "pluck-bass", "sub-pulse"],
    drums: ["pulse-tick", "shaker-only", "soft-808"],
    texture: ["shimmer", "tape-hiss", "none"],
  },
  synthwave: {
    lead: ["saw-lead", "sync-brass", "soft-square", "dx-bell"],
    pad: ["saw-pad", "string-ensemble", "pwm-square"],
    bass: ["pulse-8ths", "octave-bass", "sub-sustain"],
    drums: ["gated-80s", "909-four-on-floor", "linn-halftime"],
    texture: ["tape-hiss", "shimmer", "none"],
  },
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function pcOf(n) {
  return ((n % 12) + 12) % 12;
}

export function hash32(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(seed, label) {
  return mulberry32(hash32(`${seed >>> 0}|${label}`));
}

function normMotion(m) {
  return clamp((m - MOTION_LO) / (MOTION_HI - MOTION_LO), 0, 1);
}

function usesFlat(pc) {
  return [1, 3, 5, 6, 8, 10].includes(pcOf(pc));
}

function spell(pc) {
  const n = pcOf(pc);
  return (usesFlat(n) ? FLAT : SHARP)[n];
}

// 64-bit dHash: luma, block-average to 9x8, left>right sets the bit.
// Bits 0..31 are `lo`, bits 32..63 are `hi` (uint32 pair [hi, lo]).
export function dHashFrame(frame, width = 64, height = 36) {
  const cols = 9;
  const rows = 8;
  const acc = new Float64Array(cols * rows);
  const cnt = new Float64Array(cols * rows);
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(rows - 1, (y * rows / height) | 0);
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(cols - 1, (x * cols / width) | 0);
      const o = (y * width + x) * 3;
      const luma = frame[o] * 0.299 + frame[o + 1] * 0.587 + frame[o + 2] * 0.114;
      const i = gy * cols + gx;
      acc[i] += luma;
      cnt[i] += 1;
    }
  }
  let lo = 0;
  let hi = 0;
  let bit = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const left = acc[r * cols + c] / (cnt[r * cols + c] || 1);
      const right = acc[r * cols + c + 1] / (cnt[r * cols + c + 1] || 1);
      if (left > right) {
        if (bit < 32) lo = (lo | (1 << bit)) >>> 0;
        else hi = (hi | (1 << (bit - 32))) >>> 0;
      }
      bit += 1;
    }
  }
  return [hi >>> 0, lo >>> 0];
}

export function fingerprintOf(analysis) {
  const hashes = analysis?.hashes || [];
  const n = hashes.length;
  const parts = [];
  for (let i = 0; i < 16; i += 1) {
    const idx = n ? Math.min(n - 1, Math.round((i * (n - 1)) / 15)) : 0;
    const pair = hashes[idx] || [0, 0];
    parts.push((pair[0] >>> 0).toString(16), (pair[1] >>> 0).toString(16));
  }
  const m = analysis?.mean || {};
  const q = (v, s) => Math.round((Number(v) || 0) * s);
  parts.push(
    q(m.brightness, 100),
    q(m.saturation, 100),
    q(m.warmth, 100),
    q(m.motion, 100),
    q(m.hue, 1),
    (analysis?.cuts || []).length,
    Math.round((analysis?.duration || 0) * 10),
  );
  const seed = hash32(parts.join("|"));
  const seed2 = hash32(`${seed}|fp2`);
  const hex = seed.toString(16).padStart(8, "0") + (seed2 >>> 0).toString(16).padStart(8, "0");
  return { seed, hex };
}

function dominantHue(frames) {
  let x = 0;
  let y = 0;
  let w = 0;
  for (const frame of frames || []) {
    const sat = Math.max(0, frame.saturation || 0);
    if (sat < 0.02) continue;
    const a = (frame.hue || 0) * Math.PI / 180;
    x += Math.cos(a) * sat;
    y += Math.sin(a) * sat;
    w += sat;
  }
  if (w < 1e-4) return null;
  let deg = Math.atan2(y, x) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function smoothness(frames) {
  if (!frames || frames.length < 3) return 0.5;
  let sum = 0;
  for (let i = 1; i < frames.length; i += 1) {
    sum += Math.abs((frames[i].motion || 0) - (frames[i - 1].motion || 0));
  }
  return 1 - clamp(sum / (frames.length - 1) / 0.04, 0, 1);
}

function pickWeighted(rng, pairs) {
  const sum = pairs.reduce((acc, pair) => acc + pair[1], 0);
  let x = rng() * sum;
  for (const [name, weight] of pairs) {
    x -= weight;
    if (x <= 0) return name;
  }
  return pairs[pairs.length - 1][0];
}

function chooseTonic(analysis, rng) {
  const sat = analysis.mean?.saturation || 0;
  if (sat < 0.08) return Math.floor(rng() * 12);
  const hue = dominantHue(analysis.frames);
  const base = hue == null ? Math.floor(rng() * 12) : Math.round(hue / 30) % 12;
  const roll = rng();
  const offset = roll < 0.55 ? 0 : roll < 0.78 ? 1 : -1;
  return FIFTHS[(base + offset + 12) % 12];
}

function allowedModes(style, analysis) {
  const bright = (analysis.mean?.brightness || 0) >= 0.42 || (analysis.mean?.warmth || 0) > 0.02;
  if (style === "ambient") return ["lydian", "major", "mixolydian", "dorian", "minor", "phrygian"];
  if (style === "lofi") return ["major", "mixolydian", "dorian", "minor", "harmonicMinor"];
  if (style === "arp") return ["lydian", "major", "dorian", "minor", "harmonicMinor", "phrygian"];
  const dark = ["minor", "dorian", "harmonicMinor", "phrygian"];
  return bright ? dark.concat(["mixolydian", "lydian"]) : dark;
}

function chooseMode(style, analysis, rng) {
  const allowed = allowedModes(style, analysis);
  const ordered = MODE_RANK.filter((mode) => allowed.includes(mode));
  const bright = clamp(analysis.mean?.brightness || 0.4, 0, 1);
  const warm = clamp(((analysis.mean?.warmth || 0) + 0.08) / 0.16, 0, 1);
  const sat = clamp((analysis.mean?.saturation || 0) / 0.45, 0, 1);
  const score = clamp(bright * 0.5 + warm * 0.3 + sat * 0.2, 0, 1);
  let rank = (1 - score) * (ordered.length - 1);
  rank += (rng() - 0.5) * 2;
  const mode = ordered[clamp(Math.round(rank), 0, ordered.length - 1)];
  const pentatonic = (style === "ambient" || style === "lofi") && rng() < 0.42;
  const minorP = mode === "minor" || mode === "dorian" || mode === "phrygian" || mode === "harmonicMinor";
  const scaleLabel = pentatonic ? (minorP ? "minor pentatonic" : "major pentatonic") : MODE_TITLE[mode];
  return { mode, pentatonic, scaleLabel };
}

function activityOf(analysis) {
  const motion = normMotion(analysis.mean?.motion || 0);
  const dur = Math.max(analysis.duration || 1, 0.5);
  const cutRate = (analysis.cuts || []).length / dur;
  const bright = clamp(analysis.mean?.brightness || 0.4, 0, 1);
  return clamp(motion * 0.48 + Math.min(1, cutRate / 0.9) * 0.37 + bright * 0.15, 0, 1);
}

function chooseTempo(style, analysis, rng) {
  const ranges = { ambient: [54, 92], lofi: [66, 96], arp: [72, 118], synthwave: [80, 124] };
  const [lo, hi] = ranges[style] || ranges.ambient;
  const activity = activityOf(analysis);
  let target = lo + activity * (hi - lo);
  target += (rng() - 0.5) * (hi - lo) * 0.08;
  const minB = clamp(Math.round(target * 0.88), lo, hi);
  const maxB = clamp(Math.round(target * 1.12), lo, hi);
  const cuts = analysis.cuts || [];
  let best = clamp(Math.round(target), lo, hi);
  let bestScore = 1e9;
  for (let bpm = Math.min(minB, maxB); bpm <= Math.max(minB, maxB); bpm += 1) {
    const beat = 60 / bpm;
    let score = 0;
    for (const cut of cuts) {
      const phase = cut / beat;
      const dBeat = Math.abs(phase - Math.round(phase)) * beat;
      const half = Math.round(phase * 2) / 2;
      const dHalf = Math.abs(cut - half * beat);
      score += Math.min(dBeat, dHalf);
    }
    score += Math.abs(bpm - target) * 0.004;
    if (score < bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return best;
}

function chooseMeter(style, analysis, rng, bpm) {
  const motion = normMotion(analysis.mean?.motion || 0);
  const dur = Math.max(analysis.duration || 1, 0.5);
  const cutRate = (analysis.cuts || []).length / dur;
  const calm = motion < 0.38 && cutRate < 0.28;
  const energetic = motion > 0.55 || cutRate > 0.55;
  const smooth = smoothness(analysis.frames);
  let kind = "4/4";
  let swing = rng() * 0.2;
  if (style === "ambient") {
    kind = pickWeighted(rng, calm
      ? [["3/4", 3], ["6/8", 3], ["4/4", 1]]
      : energetic
        ? [["4/4", 4], ["3/4", 1], ["6/8", 1]]
        : [["4/4", 2], ["3/4", 2], ["6/8", 2]]);
    swing = rng() * 0.12;
  } else if (style === "lofi") {
    kind = pickWeighted(rng, calm
      ? [["swing", 3], ["3/4", 2], ["half", 2], ["12/8", 2], ["4/4", 1]]
      : energetic
        ? [["4/4", 3], ["swing", 2], ["12/8", 2], ["half", 1], ["3/4", 1]]
        : [["swing", 2], ["4/4", 2], ["12/8", 2], ["3/4", 2], ["half", 2]]);
    swing = kind === "4/4" ? 0 : 0.08 + smooth * 0.52;
  } else if (style === "arp") {
    kind = pickWeighted(rng, energetic
      ? [["4/4", 4], ["6/8", 2], ["3/4", 1]]
      : calm
        ? [["6/8", 3], ["3/4", 3], ["4/4", 1]]
        : [["4/4", 2], ["6/8", 2], ["3/4", 2]]);
    swing = rng() * 0.16;
  } else {
    kind = pickWeighted(rng, energetic
      ? [["4/4", 3], ["shuffle16", 2], ["half", 1]]
      : [["4/4", 2], ["half", 2], ["shuffle16", 2]]);
    swing = kind === "shuffle16" ? 0.12 + rng() * 0.2 : rng() * 0.1;
  }
  const table = {
    "3/4": { name: "3/4", beats: 3, sub: 2, feel: style === "lofi" ? "swing" : "straight", halfTime: false },
    "6/8": { name: "6/8", beats: 2, sub: 3, feel: "straight", halfTime: false },
    "12/8": { name: "12/8", beats: 4, sub: 3, feel: "shuffle", halfTime: false },
    half: { name: "4/4", beats: 4, sub: 2, feel: "half-time", halfTime: true },
    shuffle16: { name: "4/4", beats: 4, sub: 2, feel: "shuffle", halfTime: false },
    swing: { name: "4/4", beats: 4, sub: 2, feel: "swing", halfTime: false },
    "4/4": { name: "4/4", beats: 4, sub: 2, feel: "straight", halfTime: false },
  };
  const base = table[kind] || table["4/4"];
  const stepsPerBeat = base.sub === 3 ? base.sub : base.sub * 2;
  const swingAmt = base.feel === "straight" ? Math.round(swing * 100) / 100 : Math.round(clamp(swing, 0, 0.6) * 100) / 100;
  return {
    ...base,
    stepsPerBeat,
    stepsPerBar: base.beats * stepsPerBeat,
    barLen: base.beats * 60 / bpm,
    swing: swingAmt,
  };
}

function rotate(ids, n) {
  const k = ((n % ids.length) + ids.length) % ids.length;
  return ids.slice(k).concat(ids.slice(0, k));
}

function walkProgression(mode, rng, count, style) {
  if (style === "ambient" && rng() < 0.38) {
    const loop = PARALLEL[mode] || PARALLEL.minor;
    const out = [];
    const start = Math.floor(rng() * loop.length);
    for (let i = 0; i < count; i += 1) out.push(loop[(start + i) % loop.length]);
    return out;
  }
  const func = FUNC[mode] || FUNC.major;
  const out = [];
  let state = "T";
  for (let i = 0; i < count; i += 1) {
    const bag = func[state];
    let id = bag[Math.floor(rng() * bag.length)];
    if (state === "D" && rng() < 0.2 && mode !== "dorian" && mode !== "phrygian") {
      id = rng() < 0.5 ? "V/V" : id;
    }
    if (state === "S" && rng() < 0.16 && (mode === "major" || mode === "mixolydian")) id = rng() < 0.5 ? "Vsus" : id;
    out.push(id);
    if (rng() < 0.12 && state === "T") state = "D";
    else state = state === "T" ? "S" : state === "S" ? "D" : "T";
  }
  return out;
}

function chooseProgression(style, mode, rng) {
  const generated = rng() < (style === "ambient" ? 0.48 : 0.4);
  const count = 4 + Math.floor(rng() * 4);
  if (generated) {
    return { source: "generated", name: "walker", ids: walkProgression(mode, rng, count, style) };
  }
  const book = POOLS[mode] || POOLS.major;
  const entry = book[Math.floor(rng() * book.length)];
  let ids = entry[1].slice();
  ids = rotate(ids, Math.floor(rng() * ids.length));
  if (rng() < 0.35 && ids.length > 3) ids = ids.concat(ids.slice(0, 1 + Math.floor(rng() * 2)));
  return { source: `pool:${entry[0]}`, name: entry[0], ids };
}

function chooseRhythm(analysis, rng) {
  const busy = activityOf(analysis);
  let base = 1;
  if (busy > 0.62) base = 0.5;
  else if (busy < 0.3) base = 2;
  if (rng() < 0.25) base = base === 1 ? (rng() < 0.5 ? 0.5 : 2) : base;
  const fast = base === 2 ? 1 : 0.5;
  const slow = base === 0.5 ? 1 : 2;
  return {
    label: `base ${base} / B ${fast} / calm ${slow}`,
    base,
    fast,
    slow,
  };
}

export function holdsFor(name, bars, barLen, style, rhythm, energy = 1) {
  const plan = rhythm || { base: 1, fast: 0.5, slow: 2 };
  let unit = plan.base;
  const lively = name === "B" || name === "build";
  const calm = name === "breakdown" || name === "outro" || name === "intro" || name === "resolve";
  if (lively && energy >= 0.45) unit = plan.fast;
  else if (calm) unit = plan.slow;
  if (style === "ambient") {
    const minBars = barLen >= 2.95 ? 1 : (barLen * 2 >= 2.9 ? 2 : 3);
    if (unit < minBars) unit = minBars;
  }
  const holds = [];
  let left = bars;
  let guard = 0;
  while (left > 0.01 && guard < 48) {
    guard += 1;
    let h = unit;
    if (h > left) h = left;
    if (left - h > 0.01 && left - h < 0.5) h = left;
    holds.push(Math.round(h * 2) / 2);
    left = Math.round((left - h) * 2) / 2;
  }
  if (!holds.length) holds.push(bars);
  if (style === "ambient" && holds.length >= 2) {
    const minBars = barLen >= 2.95 ? 1 : 2;
    if (holds[holds.length - 1] < minBars) {
      holds[holds.length - 2] = Math.round((holds[holds.length - 2] + holds.pop()) * 2) / 2;
    }
  }
  return holds;
}

function hueDelta(a, b) {
  let d = Math.abs((a || 0) - (b || 0));
  if (d > 180) d = 360 - d;
  return d;
}

function resample(frames, key, length) {
  const out = [];
  const n = frames?.length || 0;
  for (let i = 0; i < length; i += 1) {
    if (!n) {
      out.push(0);
      continue;
    }
    const idx = length === 1 ? 0 : Math.round((i * (n - 1)) / (length - 1));
    out.push(frames[Math.min(n - 1, idx)][key] || 0);
  }
  return out;
}

function enforceMelody(raw, question) {
  const out = [0];
  let leapDir = 0;
  let sameDir = 0;
  let leapSum = 0;
  for (let i = 1; i < raw.length; i += 1) {
    let dir = Math.sign(raw[i]) || 1;
    let mag = Math.abs(raw[i]) || 1;
    if (mag > 5 && mag !== 7) mag = 5;
    if (mag >= 3) {
      if (dir === leapDir) {
        sameDir += 1;
        leapSum += mag;
        if (sameDir > 2 || leapSum > 7) {
          mag = 1;
          sameDir = 0;
          leapSum = 0;
        }
      } else {
        sameDir = 1;
        leapDir = dir;
        leapSum = mag;
      }
    }
    if (out.length >= 2) {
      const prevDelta = out[out.length - 1] - out[out.length - 2];
      if (Math.abs(prevDelta) >= 3) {
        dir = -Math.sign(prevDelta) || -1;
        mag = Math.min(Math.max(1, mag), 2);
      }
    }
    let next = out[out.length - 1] + dir * mag;
    if (next < 0) next = out[out.length - 1] + 1;
    out.push(next);
  }
  if (out.length >= 2) {
    const prev = out[out.length - 2];
    if (question) {
      if (out[out.length - 1] <= prev) out[out.length - 1] = prev + 1;
    } else if (prev <= 5) out[out.length - 1] = 0;
    else out[out.length - 1] = prev - 1;
  }
  const min = Math.min(...out);
  let shaped = out.map((degree) => degree - min);
  // A flat contour (typical of a still frame) has no singable peak. Lift an
  // arch on top of the seed so the motif still has several scale degrees.
  const n = shaped.length;
  const span = n ? Math.max(...shaped) - Math.min(...shaped) : 0;
  if (n >= 4 && (span < 3 || new Set(shaped).size < Math.min(4, n))) {
    // Where the arch peaks depends on the seed-driven contour itself, so two
    // still clips do not both get the same rising scale.
    const h = raw.reduce((acc, v, i) => (acc * 31 + (v + 16) * (i + 3)) >>> 0, 7);
    const peakAt = question ? n - 1 - (h % 2) : 1 + (h % Math.max(1, n - 2));
    shaped = shaped.map((degree, i) => degree + (i <= peakAt ? i : n - 1 - i));
    if (question && shaped[n - 1] <= shaped[n - 2]) shaped[n - 1] = shaped[n - 2] + 1;
    if (!question && n >= 2) shaped[n - 1] = Math.max(0, shaped[n - 2] - 1);
    const base = Math.min(...shaped);
    shaped = shaped.map((degree) => degree - base);
  }
  return shaped;
}

function motifRhythm(analysis, meter, seed, length) {
  const barLen = meter.barLen;
  const stepsPerBar = meter.stepsPerBar;
  const total = stepsPerBar * (meter.spanBars || 1);
  const weights = new Map();
  const add = (t, w) => {
    const wrapped = ((t % barLen) + barLen) % barLen;
    let step = Math.round((wrapped / barLen) * stepsPerBar) % stepsPerBar;
    if (meter.spanBars > 1 && (seed & 1)) step += ((Math.round(t / barLen) & 1) ? stepsPerBar : 0);
    step = ((step % total) + total) % total;
    weights.set(step, (weights.get(step) || 0) + w);
  };
  add(0, 8);
  for (const cut of analysis.cuts || []) add(cut, 3);
  const frames = analysis.frames || [];
  const fps = analysis.fps || 8;
  let motionPeaks = 0;
  for (let i = 1; i < frames.length - 1; i += 1) {
    const m = frames[i].motion || 0;
    if (m >= (frames[i - 1].motion || 0) && m >= (frames[i + 1].motion || 0) && m > MOTION_LO) {
      add(i / fps, 1);
      motionPeaks += 1;
    }
  }
  // No cuts and no real motion: quantise brightness drift and frame-difference
  // micro-peaks onto the same grid so a still picture still has a rhythm.
  const calm = (analysis.cuts || []).length === 0 && motionPeaks < 2;
  if (calm) {
    for (let i = 1; i < frames.length - 1; i += 1) {
      const m = frames[i].rawMotion != null ? frames[i].rawMotion : (frames[i].motion || 0);
      const prevM = frames[i - 1].rawMotion != null ? frames[i - 1].rawMotion : (frames[i - 1].motion || 0);
      const nextM = frames[i + 1].rawMotion != null ? frames[i + 1].rawMotion : (frames[i + 1].motion || 0);
      if (m >= prevM && m >= nextM && m > 0) add(i / fps, 2);
      const b = frames[i].brightness || 0;
      const db = Math.abs(b - (frames[i - 1].brightness || 0));
      const left = Math.abs((frames[i - 1].brightness || 0) - (frames[Math.max(0, i - 2)].brightness || 0));
      const right = Math.abs((frames[i + 1].brightness || 0) - b);
      if (db >= left && db >= right && db > 0.0015) add(i / fps, 1);
    }
  }
  const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const picked = new Set([0]);
  for (const [step] of ranked) {
    if (picked.size >= length) break;
    picked.add(step);
  }
  let k = 0;
  let x = seed >>> 0;
  while (picked.size < length && k < total + 4) {
    x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
    picked.add(x % total);
    k += 1;
  }
  const steps = [...picked].sort((a, b) => a - b).slice(0, length);
  if (!steps.includes(0)) steps.unshift(0);
  const trimmed = steps.slice(0, length);
  const durs = trimmed.map((step, i) => {
    const next = i + 1 < trimmed.length ? trimmed[i + 1] : total;
    const gap = Math.max(1, next - step);
    // Leave a grid rest inside a calm motif so the line can breathe.
    if (calm && gap >= 3) return Math.max(1, Math.min(3, gap - 1));
    return gap;
  });
  const strong = trimmed.map((step) => step % meter.stepsPerBeat === 0);
  strong[0] = true;
  return { steps: trimmed, durs, strong };
}

function buildMotif(analysis, meter, bpm, seed, rng) {
  const motion = normMotion(analysis.mean?.motion || 0);
  const dur = Math.max(analysis.duration || 1, 0.5);
  const cutRate = (analysis.cuts || []).length / dur;
  let length = 4 + Math.round(clamp(motion * 0.65 + Math.min(1, cutRate / 0.8) * 0.45, 0, 1) * 4);
  length = clamp(length, 4, 8);
  const frames = analysis.frames || [];
  const staticClip = (analysis.cuts || []).length === 0 && motion < 0.15;
  if (staticClip) length = Math.max(5, length);
  length = clamp(length, 4, 8);
  // A motif that fills every grid step is a running pattern, not a rhythm
  // (mc-rhythm-groove §7): leave at least ~40% of the steps as rests/holds.
  let spanBars = bpm < 72 || meter.barLen > 3.15 || length > meter.stepsPerBar * 0.6 ? 2 : 1;
  if (staticClip && meter.stepsPerBar >= 8 && ((seed >>> 3) & 1)) spanBars = 1;
  const grid = { ...meter, spanBars };
  const bright = resample(frames, "brightness", length);
  const hues = resample(frames, "hue", length);
  const raw = [0];
  for (let i = 1; i < length; i += 1) {
    let dir = 1;
    let mag = 1;
    if (staticClip) {
      const db = bright[i] - bright[i - 1];
      dir = Math.abs(db) >= 0.004 ? Math.sign(db) : (((seed >>> (i % 24)) & 1) ? 1 : -1);
      mag = 1 + ((seed >>> ((i * 3) % 20)) & 3);
      if (mag === 4) mag = 7;
      const dh = hueDelta(hues[i], hues[i - 1]);
      if (dh >= 8 && mag < 3) mag += 1;
    } else {
      const db = bright[i] - bright[i - 1];
      dir = Math.abs(db) < 0.012 ? (((seed >>> i) & 1) ? 1 : -1) : Math.sign(db);
      let dh = hueDelta(hues[i], hues[i - 1]);
      if (dh < 12) mag = 1;
      else if (dh < 28) mag = 2;
      else if (dh < 55) mag = 3;
      else if (dh < 90) mag = 4;
      else mag = 7;
      mag = Math.max(1, Math.round(mag * (0.65 + Math.min(1, Math.abs(db) * 4))));
    }
    raw.push(dir * mag);
  }
  const qRoll = rng();
  const question = qRoll < 0.28 || (staticClip && qRoll < 0.62);
  const degrees = enforceMelody(raw, question);
  const rhythm = motifRhythm(analysis, grid, seed, degrees.length);
  while (rhythm.strong.length < degrees.length) rhythm.strong.push(false);
  while (rhythm.durs.length < degrees.length) rhythm.durs.push(1);
  while (rhythm.steps.length < degrees.length) {
    rhythm.steps.push((rhythm.steps[rhythm.steps.length - 1] || 0) + 1);
  }
  return {
    degrees: degrees.slice(0, rhythm.steps.length),
    steps: rhythm.steps.slice(0, degrees.length),
    durs: rhythm.durs.slice(0, degrees.length),
    strong: rhythm.strong.slice(0, degrees.length),
    spanBars,
    question,
  };
}

function chooseRegister(analysis, rng) {
  const bright = clamp(analysis.mean?.brightness || 0.4, 0, 1);
  let leadShift = Math.round((bright - 0.45) * 14);
  leadShift = clamp(leadShift + (rng() < 0.5 ? 0 : (rng() < 0.5 ? 1 : -1)), -4, 4);
  const frames = analysis.frames || [];
  let mean = 0;
  for (const frame of frames) mean += frame.brightness || 0;
  mean = frames.length ? mean / frames.length : bright;
  let varSum = 0;
  for (const frame of frames) {
    const d = (frame.brightness || 0) - mean;
    varSum += d * d;
  }
  const contrast = frames.length ? Math.sqrt(varSum / frames.length) : 0;
  const sat = analysis.mean?.saturation || 0;
  const spread = sat > 0.28 || contrast > 0.08 ? "open" : "close";
  return { leadShift, spread };
}

function pickFrom(arr, rng, tilt) {
  const n = arr.length;
  const i = clamp(Math.floor(rng() * n + tilt), 0, n - 1);
  return arr[i];
}

function choosePalette(style, analysis, rng) {
  const book = PALETTE[style] || PALETTE.ambient;
  const motion = normMotion(analysis.mean?.motion || 0);
  const bright = clamp(analysis.mean?.brightness || 0.4, 0, 1);
  const drums = motion < 0.18 && rng() < 0.55 && book.drums.includes("none")
    ? "none"
    : pickFrom(book.drums, rng, motion > 0.6 ? -1 : 1);
  return {
    lead: pickFrom(book.lead, rng, bright > 0.55 ? -1 : 1),
    pad: pickFrom(book.pad, rng, 0),
    bass: pickFrom(book.bass, rng, motion > 0.55 ? -1 : 0),
    drums,
    texture: pickFrom(book.texture, rng, motion > 0.5 ? 1 : -1),
  };
}

function barEnergy(analysis, barLen) {
  const frames = analysis.frames || [];
  const fps = analysis.fps || 8;
  const dur = Math.max(analysis.duration || 0, 0.1);
  const nBars = Math.max(1, Math.round(dur / barLen));
  const raw = [];
  for (let b = 0; b < nBars; b += 1) {
    const t0 = b * barLen;
    const t1 = Math.min(dur, t0 + barLen);
    const a = clamp(Math.floor(t0 * fps), 0, Math.max(0, frames.length - 1));
    const c = clamp(Math.floor(t1 * fps), a, Math.max(0, frames.length - 1));
    let mot = 0;
    let count = 0;
    for (let i = a; i <= c && frames.length; i += 1) {
      mot += frames[i].motion || 0;
      count += 1;
    }
    mot = count ? normMotion(mot / count) : 0;
    const cuts = (analysis.cuts || []).filter((t) => t >= t0 && t < t1).length;
    const b0 = frames[a] ? frames[a].brightness : 0.4;
    const b1 = frames[c] ? frames[c].brightness : b0;
    raw.push(mot * 0.6 + Math.min(1, cuts) * 0.25 + Math.min(1, Math.abs(b1 - b0) * 3) * 0.15);
  }
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const dip = Math.max(0, Math.min(nBars - 1, Math.floor(nBars * 0.62)));
  const peak = Math.max(0, Math.min(nBars - 1, Math.floor(nBars * 0.38)));
  const shape = raw.map((_, i) => (i === dip ? 0.08 : i === peak && peak !== dip ? 0.92 : 0.46));
  let blended;
  if (hi - lo < 1e-6) blended = shape.slice();
  else {
    // A nearly static picture has only noise-level differences; normalizing
    // those to 0..1 would invent drama. Blend toward the default arc instead.
    // Mix relative (this clip's own ups and downs) with absolute activity so a
    // uniformly busy clip keeps its groove in its calmer bars.
    const k = clamp((hi - lo) / 0.15, 0, 1);
    blended = raw.map((v, i) => {
      const rel = k * ((v - lo) / (hi - lo)) + (1 - k) * shape[i];
      const abs = clamp(v / 0.55, 0, 1);
      return Math.round((0.6 * rel + 0.4 * Math.max(abs, rel * 0.5)) * 100) / 100;
    });
  }
  return reshapeEnergy(blended, raw, ((fingerprintOf(analysis).seed >>> 7) % 1000) / 1000);
}

// Early spike: one-bar cold open, main climax in the 55–85% window, then a
// descent. A video whose own peak is already at or after ~35% is unchanged.
function reshapeEnergy(blended, raw, u = 0.5) {
  const n = blended.length;
  if (n < 3) return blended;
  let rawAt = 0;
  let blendAt = 0;
  for (let i = 1; i < n; i += 1) {
    if (raw[i] > raw[rawAt]) rawAt = i;
    if (blended[i] > blended[blendAt]) blendAt = i;
  }
  const rawFrac = (rawAt + 0.5) / n;
  const blendFrac = (blendAt + 0.5) / n;
  const rawRange = Math.max(...raw) - Math.min(...raw);
  const early = (frac) => frac < 0.35;
  if (!early(rawFrac) && !early(blendFrac) && rawRange >= 0.05) return blended;
  // The picture peaks later, but absolute level crowned an early bar. Give the
  // max back to the video peak and leave the rest of the curve alone.
  if (!early(rawFrac) && rawRange >= 0.05) {
    const out = blended.slice();
    let top = out[0];
    for (const value of out) if (value > top) top = value;
    out[rawAt] = top >= 0.999 ? 1 : Math.round(Math.min(1, top + 0.04) * 100) / 100;
    for (let i = 0; i < n; i += 1) {
      if (i !== rawAt && out[i] >= out[rawAt]) out[i] = Math.round(Math.max(0.08, out[rawAt] - 0.03) * 100) / 100;
    }
    return out.map((v) => Math.round(v * 100) / 100);
  }
  const out = blended.slice();
  const windowIdx = [];
  for (let i = 0; i < n; i += 1) {
    const center = (i + 0.5) / n;
    // Each clip gets its own climax point inside the 55-85% window.
    const target = 0.58 + 0.24 * u;
    if (center >= target - 0.1 && center <= target + 0.1) windowIdx.push(i);
  }
  let w0 = windowIdx.length ? windowIdx[0] : Math.min(n - 1, Math.max(0, Math.round(n * 0.7 - 0.5)));
  let w1 = windowIdx.length ? windowIdx[windowIdx.length - 1] : w0;
  if (n >= 4 && w1 === n - 1 && w0 < w1) w1 -= 1;
  let best = -1;
  let bestV = -1;
  for (let i = w0; i <= w1; i += 1) {
    const left = i > 0 ? out[i - 1] : -1;
    const right = i + 1 < n ? out[i + 1] : -1;
    if (out[i] + 1e-9 < left || out[i] + 1e-9 < right) continue;
    if (out[i] > bestV) {
      bestV = out[i];
      best = i;
    }
  }
  if (best < 0) best = Math.min(w1, Math.max(w0, Math.round(n * 0.7 - 0.5)));
  if (n >= 4 && best >= n - 1) best = n - 2;
  let climax = Math.max(0.86, out[best]);
  for (let i = 0; i < n; i += 1) if (i !== best) climax = Math.max(climax, out[i] + 0.07);
  climax = Math.min(1, Math.round(climax * 100) / 100);
  // Build: a rising ramp into the climax (60% template, 40% the clip's own
  // bar-to-bar ups and downs), so the arc reads as a build, not a lone spike.
  const preCap = Math.round(climax * 0.76 * 100) / 100;
  for (let i = 0; i < best; i += 1) {
    const ramp = 0.14 + (climax * 0.8 - 0.14) * Math.pow((i + 1) / (best + 1), 1.3);
    out[i] = 0.6 * ramp + 0.4 * Math.min(out[i], preCap);
  }
  if (rawAt !== best && rawAt < best) {
    // Keep the video's own early moment as an accent (a cold open), below the climax.
    const neighbors = [];
    if (rawAt > 0) neighbors.push(out[rawAt - 1]);
    if (rawAt + 1 < n && rawAt + 1 !== best) neighbors.push(out[rawAt + 1]);
    const above = neighbors.length ? Math.max(...neighbors) : 0.3;
    let accent = Math.max(above + 0.08, 0.42);
    accent = Math.min(accent, climax - 0.14, 0.68);
    out[rawAt] = Math.max(out[rawAt], accent);
  }
  // The bar right before the climax lifts into it (no hole before the peak).
  if (best > 0) out[best - 1] = Math.max(out[best - 1], climax * 0.62);
  out[best] = climax;
  // Release: a smooth descent to the outro level.
  const endV = Math.max(0.1, climax * (0.28 + 0.2 * ((u * 7) % 1)));
  for (let i = best + 1; i < n; i += 1) {
    const t = (i - best) / Math.max(1, n - 1 - best);
    const env = climax - Math.pow(t, 0.8) * (climax - endV);
    const v = Math.min(out[i - 1] - 0.03, 0.65 * env + 0.35 * Math.min(out[i], env));
    out[i] = Math.max(0.08, v);
  }
  for (let i = 0; i < n; i += 1) {
    if (i === best) continue;
    if (out[i] >= climax) out[i] = Math.max(0.08, climax - 0.05);
  }
  out[best] = climax;
  return out.map((v) => Math.round(Math.max(0.08, Math.min(1, v)) * 100) / 100);
}

function windowStats(frames, fps, t0, t1) {
  if (!frames.length) return { hue: 0, brightness: 0.4, saturation: 0 };
  const a = clamp(Math.floor(t0 * fps), 0, frames.length - 1);
  const b = clamp(Math.ceil(t1 * fps), a, frames.length - 1);
  let x = 0;
  let y = 0;
  let w = 0;
  let bri = 0;
  let sat = 0;
  let n = 0;
  for (let i = a; i <= b; i += 1) {
    const s = Math.max(0.02, frames[i].saturation || 0);
    const ang = (frames[i].hue || 0) * Math.PI / 180;
    x += Math.cos(ang) * s;
    y += Math.sin(ang) * s;
    w += s;
    bri += frames[i].brightness || 0;
    sat += frames[i].saturation || 0;
    n += 1;
  }
  let hue = 0;
  if (w > 0) {
    hue = Math.atan2(y, x) * 180 / Math.PI;
    if (hue < 0) hue += 360;
  }
  return { hue, brightness: bri / (n || 1), saturation: sat / (n || 1) };
}

// Key changes are rare events. This only finds a candidate: a sustained scene
// change in the middle of the clip that is big enough to deserve one. The kind
// of modulation (step, relative, dominant, lift, mediant...) and its preparation
// are chosen in music.js where the section plan and climax are known.
function planModulation(analysis, key, meter, style, rng) {
  const dur = analysis.duration || 0;
  const roll = rng();
  const pick = rng();
  const flavour = rng();
  if (dur < 15) return null;
  const frames = analysis.frames || [];
  const fps = analysis.fps || 8;
  let best = null;
  const step = 0.5;
  for (let t = dur * 0.3; t <= dur * 0.78; t += step) {
    // The new look has to last: compare 3 s either side, and the 1.5 s right after.
    const left = windowStats(frames, fps, t - 3, t);
    const right = windowStats(frames, fps, t, t + 3);
    const near = windowStats(frames, fps, t + 1.5, t + 3);
    const dh = hueDelta(left.hue, right.hue) / 180;
    const db = right.brightness - left.brightness;
    const ds = Math.abs(left.saturation - right.saturation);
    const hold = Math.min(1, 1 - Math.abs(near.brightness - right.brightness) * 4);
    const score = (dh * 1.05 + Math.abs(db) * 1.5 + ds * 1.15) * Math.max(0.3, hold);
    if (!best || score > best.score) best = { t, score, dh, db, dir: right.hue - left.hue };
  }
  if (!best || best.score < 0.6) return null;
  // Even a large change only sometimes modulates (about 1 clip in 3 overall).
  const chance = Math.min(0.7, 0.3 + (best.score - 0.6) * 0.4);
  if (roll > chance) return null;
  const bar = meter.barLen;
  let barT = Math.round(best.t / bar) * bar;
  if (barT < dur * 0.3) barT += bar;
  if (barT > dur * 0.8) barT -= bar;
  if (barT < bar * 1.9 || barT > dur - bar * 1.5) return null;
  return {
    t: Math.round(barT * 1000) / 1000,
    score: Math.round(best.score * 100) / 100,
    brighter: best.db > 0.04 ? 1 : best.db < -0.04 ? -1 : 0,
    hueShift: Math.round(best.dh * 100) / 100,
    dir: best.dir >= 0 ? 1 : -1,
    pick: Math.round(pick * 1e6) / 1e6,
    flavour: Math.round(flavour * 1e6) / 1e6,
    fromPc: key.pc,
  };
}

export function buildGenome(analysis, style) {
  const safe = style === "lofi" || style === "arp" || style === "synthwave" ? style : "ambient";
  const fp = fingerprintOf(analysis || {});
  const seed = fp.seed;
  const tonicRng = rngFor(seed, `${safe}:tonic`);
  const modeRng = rngFor(seed, `${safe}:mode`);
  const tempoRng = rngFor(seed, `${safe}:tempo`);
  const meterRng = rngFor(seed, `${safe}:meter`);
  const progRng = rngFor(seed, `${safe}:prog`);
  const rhythmRng = rngFor(seed, `${safe}:rhythm`);
  const motifRng = rngFor(seed, `${safe}:motif`);
  const regRng = rngFor(seed, `${safe}:register`);
  const palRng = rngFor(seed, `${safe}:palette`);
  const modRng = rngFor(seed, `${safe}:mod`);
  const pc = chooseTonic(analysis, tonicRng);
  const chosen = chooseMode(safe, analysis, modeRng);
  const bpm = chooseTempo(safe, analysis, tempoRng);
  const meter = chooseMeter(safe, analysis, meterRng, bpm);
  const progression = chooseProgression(safe, chosen.mode, progRng);
  const harmonicRhythm = chooseRhythm(analysis, rhythmRng);
  const motif = buildMotif(analysis, meter, bpm, seed ^ hash32(`${safe}:motifbits`), motifRng);
  const register = chooseRegister(analysis, regRng);
  const palette = choosePalette(safe, analysis, palRng);
  const energy = barEnergy(analysis, meter.barLen);
  let peak = -1;
  let peakI = 0;
  energy.forEach((value, index) => {
    if (value > peak) {
      peak = value;
      peakI = index;
    }
  });
  const key = {
    pc,
    mode: chosen.mode,
    pentatonic: chosen.pentatonic,
    scaleLabel: chosen.scaleLabel,
    name: `${spell(pc)} ${MODE_TITLE[chosen.mode]}`,
  };
  const modulation = planModulation(analysis, key, meter, safe, modRng);
  const borrowedBag = BORROW[chosen.mode] || BORROW.minor;
  const borrowed = {
    id: borrowedBag[Math.floor(progRng() * borrowedBag.length)],
    section: (analysis.duration || 0) >= 18 ? "B" : "build",
  };
  return {
    fingerprint: fp.hex,
    seed,
    key,
    bpm,
    meter,
    feel: meter.feel,
    swing: meter.swing,
    progression,
    harmonicRhythm,
    motif,
    register,
    palette,
    energy,
    climaxT: Math.round((peakI + 0.5) * meter.barLen * 1000) / 1000,
    modulation,
    borrowed,
    humanize: Math.round((0.004 + rngFor(seed, `${safe}:human`)() * 0.01) * 10000) / 10000,
  };
}
