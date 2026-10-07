// Form, progression choice, motif, counter-line, and walking bass.
// Pure scheduling: the synthesizer in music.js plays what this returns.
// The same clip stats always produce the same notes.

const SCALE = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

const PENTA = {
  major: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 9],
  mixolydian: [0, 2, 4, 7, 10],
  dorian: [0, 3, 5, 7, 10],
  minor: [0, 3, 5, 7, 10],
  phrygian: [0, 1, 5, 7, 10],
  harmonicMinor: [0, 3, 5, 7, 11],
};

const PROGS = {
  major: {
    lofi: [
      ["vi", "ii", "Vsus", "V", "I"],
      ["I", "vi", "ii", "V", "I"],
      ["ii", "V/V", "V", "I"],
      ["vi", "IV", "iv", "I"],
      ["I", "bVII", "IV", "V", "I"],
      ["vi", "bVI", "ii", "V", "I"],
    ],
    ambient: [
      ["I", "iii", "vi", "IV", "I", "V"],
      ["vi", "IV", "I", "V"],
      ["I", "V", "vi", "iii", "IV", "I"],
      ["IV", "I", "ii", "vi", "V", "I"],
    ],
    arp: [
      ["vi", "IV", "I", "V"],
      ["I", "V", "vi", "IV"],
      ["ii", "V", "I", "vi"],
      ["vi", "ii", "V", "I"],
    ],
  },
  lydian: {
    lofi: [["I", "II", "V", "I"], ["vi", "II", "V", "I"], ["I", "V", "vi", "II"]],
    ambient: [["I", "II", "vi", "V", "I"], ["I", "V", "II", "I"]],
    arp: [["I", "V", "vi", "II"], ["vi", "II", "V", "I"]],
  },
  dorian: {
    lofi: [["i", "IV", "bVII", "i"], ["i", "ii", "bVII", "IV"], ["i", "v", "IV", "i"]],
    ambient: [["i", "bVII", "IV", "i"], ["i", "IV", "bVII", "IV"]],
    arp: [["i", "IV", "bVII", "i"], ["i", "bVII", "IV", "i"]],
  },
  minor: {
    lofi: [["i", "VI", "bIII", "bVII"], ["i", "iv", "bVII", "V"], ["i", "VI", "iv", "V"]],
    ambient: [["i", "VI", "bIII", "bVII", "i"], ["i", "iv", "VI", "V"]],
    arp: [["i", "bVII", "VI", "V"], ["i", "VI", "bIII", "bVII"]],
    synthwave: [
      ["i", "VI", "bIII", "bVII"],
      ["i", "bVII", "VI", "bVII"],
      ["VI", "bVII", "i", "i"],
      ["i", "iv", "VI", "V"],
    ],
  },
};

function layersFor(style, name) {
  if (style === "synthwave") {
    const map = {
      intro: ["pad", "arp", "kickbuild"],
      A: ["pad", "bass", "lead", "arp", "drums"],
      build: ["pad", "bass", "lead", "counter", "arp", "drums"],
      B: ["pad", "bass", "lead", "counter", "arp", "drums"],
      breakdown: ["pad", "bass", "lead", "arp", "kickbuild"],
      "A'": ["pad", "bass", "lead", "counter", "arp", "drums"],
      resolve: ["pad", "bass", "lead"],
      outro: ["pad", "bass", "lead"],
    };
    return (map[name] || ["pad"]).slice();
  }
  const shared = {
    intro: ["pad", "pedal", "wind"],
    A: ["pad", "bass", "lead", "counter"],
    build: ["pad", "bass", "lead", "counter", "shimmer"],
    B: ["pad", "bass", "lead", "counter", "shimmer"],
    breakdown: ["pad", "counter", "wind"],
    "A'": ["pad", "bass", "lead", "counter", "shimmer"],
    resolve: ["pad", "pedal", "lead"],
    outro: ["pad", "pedal", "lead", "wind"],
  };
  const layers = (shared[name] || ["pad"]).slice();
  if (style === "lofi") {
    if (name === "A" || name === "build" || name === "B" || name === "A'") layers.push("drums");
    if (name === "breakdown") layers.push("rim");
  } else if (style === "arp") {
    if (name === "intro" || name === "A" || name === "build" || name === "B" || name === "A'") layers.push("arp");
    if (name === "B") layers.push("pulse");
  } else if (name === "B") {
    layers.push("heart");
  }
  return layers;
}

const ENERGY = {
  intro: 0.3,
  A: 0.64,
  build: 0.8,
  B: 0.86,
  breakdown: 0.34,
  "A'": 0.72,
  resolve: 0.46,
  outro: 0.38,
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function pcOf(midi) {
  return ((midi % 12) + 12) % 12;
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

function scaleOf(key) {
  return (SCALE[key.mode] || SCALE.major).map((semi) => pcOf(key.pc + semi));
}

// After a direct modulation, notes at or after mod.t are judged in the new key.
export function keyAt(key, t) {
  if (!key?.mod || !(t >= key.mod.t - 0.001)) return key;
  return { ...key, pc: key.mod.toPc, mode: key.mod.toMode || key.mode, name: key.mod.to || key.name };
}

export function sectionAt(sections, t) {
  if (!sections || !sections.length) return null;
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    if (t >= sections[i].t0 - 0.001) return sections[i];
  }
  return sections[0];
}

function formNames(duration) {
  if (duration < 18) return ["intro", "build", "resolve"];
  if (duration < 38) return ["intro", "A", "B", "outro"];
  return ["intro", "A", "B", "breakdown", "A'", "outro"];
}

function allocateSynthwave(names, total) {
  const pref = { intro: 2, A: 6, build: 2, B: 4, breakdown: 2, "A'": 3, outro: 2, resolve: 2 };
  const floor = { intro: 1, A: 2, build: 1, B: 2, breakdown: 2, "A'": 2, outro: 2, resolve: 1 };
  const cap = { intro: 3, A: 8, build: 4, B: 8, breakdown: 4, "A'": 6, outro: 4, resolve: 3 };
  const counts = names.map((name) => pref[name] ?? 2);
  let sum = counts.reduce((a, b) => a + b, 0);
  const shrink = ["A", "A'", "breakdown", "B", "intro", "build", "outro", "resolve"];
  while (sum > total) {
    let idx = -1;
    for (const name of shrink) {
      const at = names.indexOf(name);
      if (at >= 0 && counts[at] > (floor[name] ?? 1)) {
        idx = at;
        break;
      }
    }
    if (idx < 0) {
      idx = counts.findIndex((count) => count > 1);
      if (idx < 0) break;
    }
    counts[idx] -= 1;
    sum -= 1;
  }
  const priority = { B: 0, "A'": 1, A: 2, breakdown: 3, outro: 4, build: 5, intro: 6, resolve: 7 };
  while (sum < total) {
    let best = -1;
    let bestScore = 1e9;
    let bestPri = 99;
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (counts[i] >= (cap[name] ?? 8)) continue;
      const score = counts[i] / (pref[name] || 2);
      const pri = priority[name] ?? 9;
      if (score < bestScore - 0.001 || (Math.abs(score - bestScore) <= 0.001 && pri < bestPri)) {
        bestScore = score;
        bestPri = pri;
        best = i;
      }
    }
    if (best < 0) break;
    counts[best] += 1;
    sum += 1;
  }
  return counts;
}

function restoreFloors(counts, names) {
  const floor = { outro: 2, B: 2, "A'": 2, breakdown: 2, A: 2, resolve: 1, intro: 1, build: 1 };
  const next = counts.slice();
  for (let i = 0; i < names.length; i += 1) {
    const need = floor[names[i]] ?? 1;
    while (next[i] < need) {
      let donor = -1;
      for (let j = 0; j < next.length; j += 1) {
        if (j === i) continue;
        const spare = next[j] - (floor[names[j]] ?? 1);
        if (spare <= 0) continue;
        if (donor < 0 || next[j] > next[donor]) donor = j;
      }
      if (donor < 0) break;
      next[donor] -= 1;
      next[i] += 1;
    }
  }
  return next;
}

function allocateBars(names, total, style) {
  if (style === "synthwave") return allocateSynthwave(names, total);
  const shapes = {
    "intro,build,resolve": [2, 2, 2],
    "intro,A,B,outro": [2, 2, 2, 2],
    "intro,A,B,breakdown,A',outro": [2, 4, 2, 2, 2, 2],
  };
  const counts = (shapes[names.join(",")] || names.map(() => 2)).slice();
  let sum = counts.reduce((a, b) => a + b, 0);
  const floorOf = (name) => (name === "A" || name === "B" ? 2 : 1);
  while (sum > total) {
    let idx = -1;
    for (let i = counts.length - 1; i >= 0; i -= 1) {
      if (counts[i] > floorOf(names[i]) && counts[i] > 1) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      idx = counts.findIndex((count) => count > 1);
      if (idx < 0) break;
    }
    counts[idx] -= 1;
    sum -= 1;
  }
  const grow = ["A", "B", "A'", "build", "breakdown", "outro", "intro", "resolve"];
  while (sum < total) {
    let idx = counts.length - 1;
    for (const name of grow) {
      const at = names.indexOf(name);
      if (at >= 0 && counts[at] < 8) {
        idx = at;
        break;
      }
    }
    counts[idx] += 1;
    sum += 1;
  }
  return counts;
}

function snapToCuts(counts, cuts, bar) {
  const idx = [0];
  for (const count of counts) idx.push(idx[idx.length - 1] + count);
  for (let s = 1; s < idx.length - 1; s += 1) {
    const planned = idx[s];
    let nearest = null;
    let nearestD = bar * 0.5;
    for (const cut of cuts || []) {
      const dist = Math.abs(cut - planned * bar);
      if (dist < nearestD) {
        nearestD = dist;
        nearest = cut;
      }
    }
    if (nearest == null) continue;
    const barIndex = Math.round(nearest / bar);
    if (Math.abs(barIndex - planned) > 1) continue;
    if (barIndex <= idx[s - 1] || barIndex >= idx[s + 1]) continue;
    idx[s] = barIndex;
  }
  const out = [];
  for (let s = 0; s < idx.length - 1; s += 1) out.push(idx[s + 1] - idx[s]);
  return out;
}

function snapBoundary(counts, target) {
  const next = counts.slice();
  const idx = [0];
  for (const count of next) idx.push(idx[idx.length - 1] + count);
  const total = idx[idx.length - 1];
  if (target <= 1 || target >= total - 1) return next;
  let best = 1;
  let bestD = 99;
  for (let s = 1; s < idx.length - 1; s += 1) {
    const dist = Math.abs(idx[s] - target);
    if (dist < bestD) {
      bestD = dist;
      best = s;
    }
  }
  const shift = clamp(target - idx[best], -2, 2);
  if (!shift) return next;
  if (shift > 0) {
    const give = Math.min(shift, next[best] - 1);
    next[best - 1] += give;
    next[best] -= give;
  } else {
    const take = Math.min(-shift, next[best - 1] - 1);
    next[best - 1] -= take;
    next[best] += take;
  }
  return next;
}

function coverPeak(counts, names, peakBar) {
  const next = counts.slice();
  const at = names.indexOf("B");
  if (at < 0) return next;
  const idx = [0];
  for (const count of next) idx.push(idx[idx.length - 1] + count);
  const total = idx[idx.length - 1];
  const peak = clamp(peakBar, 0, Math.max(0, total - 1));
  if (peak >= idx[at] && peak < idx[at + 1]) return next;
  if (peak < idx[at]) {
    let need = idx[at] - peak;
    for (let i = at - 1; i >= 0 && need > 0; i -= 1) {
      const spare = next[i] - 1;
      const give = Math.min(Math.max(0, spare), need);
      next[i] -= give;
      next[at] += give;
      need -= give;
    }
    return next;
  }
  let need = peak - (idx[at + 1] - 1);
  for (let i = at + 1; i < next.length && need > 0; i += 1) {
    const spare = next[i] - 1;
    const take = Math.min(Math.max(0, spare), need);
    next[i] -= take;
    next[at] += take;
    need -= take;
  }
  return next;
}

function unbalance(counts, names, seed) {
  if (!counts || counts.length < 3) return counts;
  const next = counts.slice();
  const same = next.every((count) => count === next[0]);
  const dest = Math.max(0, names.indexOf("B") >= 0 ? names.indexOf("B") : names.indexOf("build"));
  if (same && next[0] > 1) {
    next[0] -= 1;
    next[dest] += 1;
  } else if (((seed >>> 3) & 1) === 1) {
    const donor = next.findIndex((count, index) => index !== dest && count > (index === 0 ? 1 : 2));
    if (donor >= 0) {
      next[donor] -= 1;
      next[dest] += 1;
    }
  }
  return next;
}

export function planSections(analysis, regionMean, normMotion, bpm, style, meter, seed = 0, genome = null) {
  const d = analysis.duration;
  const bar = meter?.barLen || (240 / bpm);
  let last = 0;
  while ((last + 1) * bar <= d - 0.12) last += 1;
  const names = formNames(d);
  // A tail shorter than ~0.6 bar is folded into the last bar, so the outro
  // (and its final cadence chord) is never a fraction-of-a-beat sliver.
  let grid = last + 1;
  if (d - last * bar < bar * (style === "synthwave" ? 0.55 : 0.6)) grid = Math.max(names.length, last);
  const totalBars = Math.max(names.length, grid);
  let counts = allocateBars(names, totalBars, style);
  counts = unbalance(counts, names, seed || 0);
  if (genome?.climaxT != null && names.includes("B")) {
    counts = coverPeak(counts, names, Math.round(genome.climaxT / bar));
  }
  if (genome?.modulation) counts = snapBoundary(counts, Math.round(genome.modulation.t / bar));
  counts = snapToCuts(counts, analysis.cuts, bar);
  if (genome?.modulation) {
    const idx = [0];
    for (const count of counts) idx.push(idx[idx.length - 1] + count);
    let nearest = idx[1] || 0;
    let nearestD = 99;
    const target = Math.round(genome.modulation.t / bar);
    for (let s = 1; s < idx.length - 1; s += 1) {
      const dist = Math.abs(idx[s] - target);
      if (dist < nearestD) {
        nearestD = dist;
        nearest = idx[s];
      }
    }
    // Land on a section seam when one is within a bar; otherwise keep the
    // planned bar line (the V7/pivot preparation does not need a seam). Never
    // let a seam drag the change into the first 30% of the clip.
    const at = nearestD <= 1 ? nearest : target;
    if (at * bar < d * 0.3) genome.modulation = null;
    else genome.modulation.t = Math.round(at * bar * 1000) / 1000;
  }
  if (style === "synthwave") counts = restoreFloors(counts, names);
  const sections = [];
  let bar0 = 0;
  for (let i = 0; i < names.length; i += 1) {
    const bars = Math.max(1, counts[i] || 1);
    const t0 = bar0 * bar;
    const endBar = bar0 + bars;
    const t1 = i === names.length - 1 ? d : endBar * bar;
    const mot = normMotion(regionMean(analysis, t0, t1, "motion"));
    const bright = regionMean(analysis, t0, t1, "brightness");
    const base = ENERGY[names[i]] ?? 0.5;
    sections.push({
      name: names[i],
      t0,
      t1,
      bar0,
      bars,
      energy: Math.round(clamp(base * 0.72 + mot * 0.18 + bright * 0.1, 0.18, 1) * 100) / 100,
      layers: layersFor(style || "ambient", names[i]),
    });
    bar0 = endBar;
  }
  if (sections.length) sections[sections.length - 1].t1 = d;
  return sections;
}

function familyOf(style) {
  return style === "lofi" || style === "arp" || style === "synthwave" ? style : "ambient";
}

export function pickIds(mode, style, mean, count, has) {
  const book = PROGS[mode] || PROGS.major;
  const family = familyOf(style);
  const list = book[family] || book.ambient || PROGS.major.ambient;
  const sat = clamp((mean.saturation - 0.06) / 0.36, 0, 1);
  const mood = clamp(mean.brightness * 0.55 + sat * 0.25 + clamp(mean.warmth, -0.05, 0.2) * 0.8, 0, 1);
  const prog = list[Math.min(list.length - 1, Math.round(mood * (list.length - 1)))];
  const ids = [];
  for (let i = 0; i < count; i += 1) ids.push(prog[i % prog.length]);
  let pen = mean.brightness < 0.2 ? "IV" : "V";
  if (!has(pen)) pen = has("iv") ? "iv" : has("v") ? "v" : has("V") ? "V" : prog[0];
  let fin = has("I") ? "I" : has("i") ? "i" : prog[prog.length - 1];
  if (count >= 2) {
    ids[count - 2] = pen;
    ids[count - 1] = fin;
  } else if (count === 1) ids[0] = fin;
  for (let i = 1; i < Math.max(0, count - 2); i += 1) {
    if (ids[i] === ids[i - 1]) {
      const alt = prog[(i + 2) % prog.length];
      if (alt !== ids[i]) ids[i] = alt;
    }
  }
  return { ids, prog };
}

export function chooseProg(mode, style, mean) {
  const book = PROGS[mode] || PROGS.major;
  const family = familyOf(style);
  const list = book[family] || book.ambient || PROGS.major.ambient;
  const sat = clamp((mean.saturation - 0.06) / 0.36, 0, 1);
  const mood = clamp(mean.brightness * 0.55 + sat * 0.25 + clamp(mean.warmth, -0.05, 0.2) * 0.8, 0, 1);
  return list[Math.min(list.length - 1, Math.round(mood * (list.length - 1)))].slice();
}

function minorMode(mode) {
  return mode === "minor" || mode === "dorian" || mode === "phrygian" || mode === "harmonicMinor";
}

export function sectionChordIds(name, count, prog, has, bars = count, style = null, mode = null) {
  const n = Math.max(0, count);
  const tonic = has("I") ? "I" : has("i") ? "i" : prog[prog.length - 1];
  const five = mode === "dorian"
    ? (has("v") ? "v" : has("IV") ? "IV" : null)
    : mode === "phrygian"
      ? (has("bII") ? "bII" : has("v") ? "v" : null)
      : mode === "mixolydian"
        ? (has("v") ? "v" : has("bVII") ? "bVII" : null)
        : mode === "harmonicMinor"
          ? (has("V7") ? "V7" : has("V") ? "V" : null)
          : (has("V") ? "V" : has("v") ? "v" : null);
  if (!n) return [];
  if (name === "intro") return Array.from({ length: n }, () => tonic);
  if (name === "breakdown") {
    // Hold a color, then lift on V or IV so A' (which restarts the loop) is a new chord.
    const opening = prog[0];
    const color = prog.find((id) => id !== tonic) || opening;
    const lift = (five && five !== opening ? five : null)
      || (has("IV") && "IV" !== opening ? "IV" : null)
      || (has("iv") && "iv" !== opening ? "iv" : null)
      || (tonic !== opening ? tonic : color);
    if (n === 1) return [lift !== opening ? lift : color !== opening ? color : lift];
    const ids = Array.from({ length: n }, () => color);
    if (ids[n - 2] === "iv") ids[n - 1] = tonic !== opening ? tonic : lift;
    else ids[n - 1] = lift;
    if (ids[n - 1] === opening) {
      const alt = [five, "IV", "iv", tonic].find((id) => id && has(id) && id !== opening && id !== "iv");
      if (alt) ids[n - 1] = alt;
    }
    return ids;
  }
  const ids = [];
  for (let i = 0; i < n; i += 1) ids.push(prog[i % prog.length]);
  const half = name === "A" || name === "build";
  const ending = name === "B" || name === "outro" || name === "resolve";
  const cadenced = half || ending;
  if (half && n >= 2 && five) {
    if (ids[n - 2] === "iv") ids[n - 1] = tonic;
    else if (n >= 4 || n > prog.length || bars >= 4) {
      ids[n - 1] = five;
      if (ids[n - 2] === five) {
        const before = n >= 3 ? ids[n - 3] : null;
        const alt = prog.find((id) => id !== five && id !== "iv" && id !== before);
        if (alt) ids[n - 2] = alt;
      }
    }
  }
  if (ending && n >= 2 && mode === "mixolydian" && has("bVII")) {
    ids[n - 2] = "bVII";
    ids[n - 1] = tonic;
  } else if (ending && n >= 2 && mode === "dorian") {
    const pre = has("bVII") ? "bVII" : has("IV") ? "IV" : five;
    if (pre) {
      ids[n - 2] = pre;
      ids[n - 1] = tonic;
    }
  } else if (ending && n >= 2 && mode === "phrygian" && has("bII")) {
    ids[n - 2] = "bII";
    ids[n - 1] = tonic;
  } else if (ending && n >= 2 && mode === "harmonicMinor" && (has("V7") || has("V"))) {
    ids[n - 2] = has("V7") ? "V7" : "V";
    ids[n - 1] = tonic;
  } else if (ending && n >= 2 && style === "synthwave") {
    const seven = has("bVII") ? "bVII" : null;
    if (prog.includes("iv") && has("iv") && five && n >= 3) {
      ids[n - 3] = "iv";
      ids[n - 2] = five;
      ids[n - 1] = tonic;
    } else if (has("VI") && seven && n >= 3) {
      ids[n - 3] = "VI";
      ids[n - 2] = seven;
      ids[n - 1] = tonic;
    } else if (seven) {
      ids[n - 2] = seven;
      ids[n - 1] = tonic;
    } else if (five) {
      ids[n - 2] = five;
      ids[n - 1] = tonic;
    } else ids[n - 1] = tonic;
  } else if (ending && n >= 2) {
    if (has("iv") && prog.includes("iv")) {
      ids[n - 2] = "iv";
      ids[n - 1] = tonic;
    } else if (five) {
      ids[n - 2] = five;
      ids[n - 1] = tonic;
    } else ids[n - 1] = tonic;
  }
  if (n === 1 && (name === "outro" || name === "resolve")) ids[0] = tonic;
  const stop = cadenced && n >= 2 ? n - 2 : n;
  for (let i = 1; i < stop; i += 1) {
    if (ids[i] !== ids[i - 1]) continue;
    const alt = prog.find((id) => id !== ids[i - 1] && id !== ids[i + 1] && id !== "iv");
    if (alt) ids[i] = alt;
  }
  for (let i = 0; i < ids.length; i += 1) {
    if (ids[i] !== "iv") continue;
    if (style === "synthwave") {
      if (i + 1 >= ids.length) ids[i] = five || tonic;
      continue;
    }
    if (i + 1 >= ids.length) {
      ids[i] = five || tonic;
      continue;
    }
    if (ids[i + 1] === tonic) continue;
    const nextIsCadence = cadenced && i + 1 >= ids.length - 2;
    if (nextIsCadence) {
      const alt = prog.find((id) => id !== "iv" && id !== ids[i + 1] && id !== tonic && id !== ids[i - 1]);
      ids[i] = alt || five || tonic;
    } else ids[i + 1] = tonic;
  }
  return ids;
}

function chordAt(chords, t) {
  for (let i = chords.length - 1; i >= 0; i -= 1) {
    if (t >= chords[i].t0 - 0.001) return chords[i];
  }
  return chords[0];
}

function nearest(midi, pcs, lo, hi) {
  let best = null;
  let bestD = 99;
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  for (let m = a; m <= b; m += 1) {
    if (!pcs.includes(pcOf(m))) continue;
    const d = Math.abs(m - midi);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

function semitoneApart(a, b) {
  const d = Math.abs(pcOf(a) - pcOf(b)) % 12;
  return d === 1 || d === 11;
}

function closestMidi(target, options) {
  let best = options[0];
  let bestD = Math.abs(best - target);
  for (const midi of options) {
    const dist = Math.abs(midi - target);
    if (dist < bestD) {
      bestD = dist;
      best = midi;
    }
  }
  return best;
}

// Chord tones plus 9ths and 13ths that are not a semitone from a chord tone.
// A borrowed chord may include notes outside the key; those stay, a chromatic neighbor does not.
function tensionPcs(chord, key) {
  const tones = [...new Set((chord?.notes || []).map((midi) => pcOf(midi)))];
  if (!chord) return tones;
  const rel = (pc) => (pc - chord.rootPc + 12) % 12;
  let pool = tones.slice();
  let guard = 0;
  while (guard < 6) {
    guard += 1;
    let found = false;
    for (let i = 0; i < pool.length && !found; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        if (!semitoneApart(pool[i], pool[j])) continue;
        const drop = [2, 6, 9, 10, 11].includes(rel(pool[j])) ? pool[j]
          : [2, 6, 9, 10, 11].includes(rel(pool[i])) ? pool[i]
            : pool[j];
        pool = pool.filter((pc) => pc !== drop);
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  const extra = [2, 9].map((semi) => pcOf(chord.rootPc + semi));
  if (pool.includes(pcOf(chord.rootPc + 3)) || tones.includes(pcOf(chord.rootPc + 3))) {
    extra.push(pcOf(chord.rootPc + 5));
  }
  if (key.mode === "lydian" && chord.rootPc === key.pc) extra.push(pcOf(chord.rootPc + 6));
  for (const pc of extra) {
    if (pool.some((tone) => semitoneApart(tone, pc))) continue;
    pool.push(pc);
  }
  return [...new Set(pool)];
}

const MOTIF_DEG = [0, 2, 1, 4, 3, 5];
const MOTIF_S = [0, 2, 3, 6, 8, 14];
const MOTIF_DUR = [2, 1, 3, 2, 4, 2];
const MOTIF_STRONG = [true, false, false, false, true, false];

function invertedDegrees(degrees) {
  const flipped = degrees.map((degree, index) => (index === 0 ? 0 : degrees[0] - (degree - degrees[0])));
  const lift = -Math.min(...flipped);
  return flipped.map((degree) => degree + lift);
}

function fitMidi(midi, chord, strong, scale, lo, hi) {
  const tones = [...new Set(chord.notes.map((note) => pcOf(note)))];
  const pcs = strong ? tones : scale;
  return nearest(midi, pcs.length ? pcs : scale, lo, hi) ?? clamp(Math.round(midi), lo, hi);
}

function degreeMidi(scale, degree, center, lo, hi) {
  const len = scale.length;
  const wrapped = ((degree % len) + len) % len;
  const oct = Math.floor(degree / len);
  const pc = scale[wrapped];
  let midi = Math.round(center) + oct * 12;
  let guard = 0;
  while (pcOf(midi) !== pc && guard < 12) {
    midi += 1;
    guard += 1;
  }
  while (midi - center > 6) midi -= 12;
  while (center - midi > 6) midi += 12;
  while (midi < lo) midi += 12;
  while (midi > hi) midi -= 12;
  return midi;
}

function slotsOf(starts, durations, strong, stretch) {
  return starts.map((start, index) => ({
    s: start * stretch,
    dur: durations[index] * stretch,
    strong: strong[index],
  }));
}

function allowedPcs(chord, strong, scale, key) {
  const tones = [...new Set(chord.notes.map((midi) => pcOf(midi)))];
  if (!strong) return scale;
  const extra = [2, 9].map((semi) => pcOf(chord.rootPc + semi));
  if (tones.includes(pcOf(chord.rootPc + 3))) extra.push(pcOf(chord.rootPc + 5));
  if (key.mode === "lydian" && chord.rootPc === key.pc) extra.push(pcOf(chord.rootPc + 6));
  const bag = tones.slice();
  for (const pc of extra) {
    if (!tones.some((tone) => pcOf(tone + 1) === pc)) bag.push(pc);
  }
  return [...new Set(bag)];
}

function walkDegrees(scale, degrees, center) {
  const len = scale.length;
  const midis = [];
  for (let i = 0; i < degrees.length; i += 1) {
    const wrapped = ((degrees[i] % len) + len) % len;
    const pc = scale[wrapped];
    if (!midis.length) {
      let midi = Math.round(center);
      let guard = 0;
      while (pcOf(midi) !== pc && guard < 12) {
        midi += 1;
        guard += 1;
      }
      if (midi - center > 6) midi -= 12;
      midis.push(midi);
      continue;
    }
    const dir = degrees[i] >= degrees[i - 1] ? 1 : -1;
    let left = Math.abs(degrees[i] - degrees[i - 1]);
    let midi = midis[i - 1];
    let guard = 0;
    while (left > 0 && guard < 48) {
      midi += dir;
      guard += 1;
      if (scale.includes(pcOf(midi))) left -= 1;
    }
    midis.push(midi);
  }
  return midis;
}

function shiftPhrase(midis, lo, hi) {
  const next = midis.slice();
  let guard = 0;
  while (next.length && Math.max(...next) > hi && guard < 6) {
    for (let i = 0; i < next.length; i += 1) next[i] -= 12;
    guard += 1;
  }
  guard = 0;
  while (next.length && Math.min(...next) < lo && guard < 6) {
    for (let i = 0; i < next.length; i += 1) next[i] += 12;
    guard += 1;
  }
  if (next.length && Math.max(...next) > hi && Math.min(...next) - 12 >= lo) {
    for (let i = 0; i < next.length; i += 1) next[i] -= 12;
  }
  return next;
}

// One leap wider than a 6th may stay. Later ones move by octave so the
// pitch class, and the clash check, stay put.
function foldLeaps(notes, lo, hi) {
  let used = false;
  let role = null;
  for (let i = 1; i < notes.length; i += 1) {
    const note = notes[i];
    const prev = notes[i - 1];
    if (note.role !== role) {
      role = note.role;
      used = false;
    }
    if (note.role !== prev.role) continue;
    if (Math.abs(note.midi - prev.midi) <= 9) continue;
    if (!used) {
      used = true;
      continue;
    }
    const dir = Math.sign(note.midi - prev.midi) || 1;
    let midi = note.midi - dir * 12;
    let guard = 0;
    while (Math.abs(midi - prev.midi) > 9 && guard < 3) {
      midi -= dir * 12;
      guard += 1;
    }
    if (midi < lo || midi > hi) continue;
    if (note.contour && midi !== prev.midi && Math.sign(midi - prev.midi) !== note.contour) continue;
    note.midi = midi;
  }
}

function guidePcs(chord) {
  const rels = [...new Set((chord.notes || []).map((midi) => (pcOf(midi) - chord.rootPc + 12) % 12))];
  const pcs = [];
  if (rels.includes(3)) pcs.push(pcOf(chord.rootPc + 3));
  else if (rels.includes(4)) pcs.push(pcOf(chord.rootPc + 4));
  if (rels.includes(10)) pcs.push(pcOf(chord.rootPc + 10));
  else if (rels.includes(11)) pcs.push(pcOf(chord.rootPc + 11));
  if (pcs.length < 2 && rels.includes(7)) pcs.push(pcOf(chord.rootPc + 7));
  if (!pcs.length && chord.notes.length) pcs.push(pcOf(chord.notes[chord.notes.length - 1]));
  return [...new Set(pcs)];
}

function midiOfPc(pc, target, lo, hi) {
  let best = null;
  let bestD = 99;
  for (let midi = lo; midi <= hi; midi += 1) {
    if (pcOf(midi) !== pc) continue;
    const dist = Math.abs(midi - target);
    if (dist < bestD) {
      bestD = dist;
      best = midi;
    }
  }
  return best;
}

function layGuide(chords, lead, counter) {
  let prev = null;
  let prev2 = null;
  for (const chord of chords) {
    const covering = lead.filter((note) => note.t < chord.t1 - 0.02 && note.t + (note.dur || 0.2) > chord.t0 + 0.02);
    const leadFloor = covering.length ? Math.min(...covering.map((note) => note.midi)) : 76;
    const hi = Math.min(69, leadFloor - 3);
    const lo = 52;
    if (hi < lo) continue;
    const color = new Set(guidePcs(chord));
    const voiced = [...new Set((chord.notes || []).map((midi) => pcOf(midi)))];
    const pcs = [...new Set([...color, ...voiced])];
    const banned = prev != null && prev2 != null && pcOf(prev) === pcOf(prev2) ? pcOf(prev) : null;
    let chosen = null;
    let chosenScore = 99;
    const scoreOf = (pc, dist) => {
      let score = dist;
      if (dist > 2) score += color.has(pc) ? 2 : 6;
      if (pc === banned) score += 20;
      return score;
    };
    for (const pc of pcs) {
      const midi = midiOfPc(pc, prev ?? 62, lo, hi);
      if (midi == null) continue;
      const dist = prev == null ? Math.abs(midi - 62) : Math.abs(midi - prev);
      const score = scoreOf(pc, dist);
      if (score < chosenScore) {
        chosenScore = score;
        chosen = midi;
      }
    }
    if (chosen == null) continue;
    const span = chord.t1 - chord.t0;
    const alts = pcs
      .map((pc) => midiOfPc(pc, chosen, lo, hi))
      .filter((midi) => midi != null && midi !== chosen && Math.abs(midi - chosen) <= 5);
    if (span > 1.7 && alts.length) {
      const half = Math.max(0.4, span * 0.46);
      const second = closestMidi(chosen + (chosen >= (prev ?? 62) ? -2 : 2), alts);
      counter.push({
        t: Math.round(chord.t0 * 1000) / 1000,
        midi: chosen,
        dur: Math.round(half * 1000) / 1000,
        role: "guide",
        strong: true,
      });
      counter.push({
        t: Math.round((chord.t0 + half + 0.03) * 1000) / 1000,
        midi: second,
        dur: Math.round(Math.max(0.4, span - half - 0.08) * 1000) / 1000,
        role: "guide",
        strong: false,
      });
      prev2 = chosen;
      prev = second;
      continue;
    }
    const dur = Math.max(0.4, span - 0.05);
    counter.push({
      t: Math.round(chord.t0 * 1000) / 1000,
      midi: chosen,
      dur: Math.round(dur * 1000) / 1000,
      role: "guide",
      strong: true,
    });
    prev2 = prev;
    prev = chosen;
  }
}

// Calm phrase patterns: p = phrase that runs into the next, b = phrase then a
// breath, r = a whole motif span of rest.
const CALM_PATTERNS = [["p", "b"], ["p", "b"], ["b"], ["p", "p", "b"], ["p", "b", "r"], ["b", "p", "b"]];

// Counter-line rhythm cells, in beats. Each clip picks one, so the inner
// voice moves in its own rhythm instead of a uniform eighth-note stream.
const COUNTER_CELLS = [[1], [1.5, 0.5], [2], [0.5, 1.5], [1, 0.5, 0.5], [0.75, 1.25]];
let counterCell = COUNTER_CELLS[0];

export function composeLines({ analysis, key, plan, seed, style }) {
  mulberry32((seed + 17) >>> 0);
  counterCell = COUNTER_CELLS[(seed >>> 13) % COUNTER_CELLS.length];
  const scale = scaleOf(key);
  const penta = (PENTA[key.mode] || PENTA.minor).map((semi) => pcOf(key.pc + semi));
  const beat = 60 / plan.bpm;
  const bar = plan.meter?.barLen || beat * 4;
  const sixteenth = bar / (plan.meter?.stepsPerBar || 16);
  const motion = plan.motion ?? 0.4;
  const leadLo = style === "lofi" ? 71 : style === "synthwave" ? 69 : 69;
  const leadHi = style === "lofi" ? 83 : style === "synthwave" ? 86 : 88;
  let center = style === "lofi" ? 76 : style === "synthwave" ? 78 : style === "arp" ? 78 : 79;
  if (plan.register && Number.isFinite(plan.register.leadShift)) center += plan.register.leadShift;
  else if (analysis.mean.brightness > 0.5) center += 2;
  center = clamp(center, leadLo + 2, leadHi - 2);
  const lead = [];
  const counter = [];
  const invDeg = invertedDegrees(MOTIF_DEG);
  const baseSlots = slotsOf(MOTIF_S, MOTIF_DUR, MOTIF_STRONG, 1);

  function realize(degrees, slots, t0, role, regCenter, tLimit) {
    const midis = [];
    const notes = [];
    const limit = tLimit == null ? analysis.duration : tLimit;
    for (let i = 0; i < degrees.length && i < slots.length; i += 1) {
      const when = t0 + slots[i].s * sixteenth;
      if (when >= analysis.duration - 0.08 || when >= limit - 0.04) break;
      const chord = chordAt(plan.chords, when + 0.0001);
      if (!chord) break;
      const raw = degreeMidi(scale, degrees[i], regCenter, leadLo, leadHi);
      const room = Math.min(chord.t1, limit) - when;
      if (room < 0.12) break;
      const dur = Math.min(slots[i].dur * sixteenth, room);
      const want = i > 0 ? Math.sign(degrees[i] - degrees[i - 1]) : 0;
      const snap = slots[i].strong || dur > 0.25;
      let midi = raw;
      if (snap) {
        const pcs = tensionPcs(chord, key);
        const options = [];
        for (let m = leadLo; m <= leadHi; m += 1) if (pcs.includes(pcOf(m))) options.push(m);
        const pool = options.length ? options : [raw];
        midi = closestMidi(raw, pool);
        if (want) {
          const signed = pool.filter((m) => Math.sign(m - midis[i - 1]) === want);
          if (signed.length) midi = closestMidi(raw, signed);
        }
      } else if (want && Math.sign(raw - (midis[i - 1] ?? raw)) !== want) {
        const options = [];
        for (let m = leadLo; m <= leadHi; m += 1) {
          if (!scale.includes(pcOf(m))) continue;
          if (Math.sign(m - midis[i - 1]) !== want) continue;
          options.push(m);
        }
        if (options.length) midi = closestMidi(raw, options);
      }
      while (midi < leadLo) midi += 12;
      while (midi > leadHi) midi -= 12;
      if (key.pentatonic && !snap) {
        const options = [];
        for (let m = leadLo; m <= leadHi; m += 1) if (penta.includes(pcOf(m))) options.push(m);
        if (options.length) midi = closestMidi(midi, options);
      }
      midis.push(midi);
      notes.push({
        t: Math.round(when * 1000) / 1000,
        midi,
        dur: Math.round(Math.max(0.12, dur) * 1000) / 1000,
        role,
        strong: Boolean(slots[i].strong),
        contour: want,
      });
    }
    return notes;
  }

  // Place the whole phrase on the scale first, then slide it by octaves.
  // Snapping a single note into the register is what made the motif leap by 9ths.
  function realizeSynth(degrees, slots, t0, role, regCenter, tLimit) {
    const limit = tLimit == null ? analysis.duration : tLimit;
    const used = [];
    for (let i = 0; i < degrees.length && i < slots.length; i += 1) {
      const when = t0 + slots[i].s * sixteenth;
      if (when >= analysis.duration - 0.08 || when >= limit - 0.04) break;
      const chord = chordAt(plan.chords, when + 0.0001);
      if (!chord) break;
      used.push({ degree: degrees[i], when, chord, slot: slots[i], index: i });
    }
    if (!used.length) return [];
    let midis = shiftPhrase(walkDegrees(scale, used.map((item) => item.degree), regCenter), leadLo, leadHi);
    const notes = [];
    let usedLeap = false;
    for (let i = 0; i < used.length; i += 1) {
      const { when, chord, slot, index } = used[i];
      const room = Math.min(chord.t1, limit) - when;
      if (room < 0.12) break;
      const dur = Math.min(slot.dur * sixteenth, room);
      const want = index > 0 ? Math.sign(degrees[index] - degrees[index - 1]) : 0;
      const snap = slot.strong || dur > 0.25;
      let midi = midis[i];
      const prev = notes.length ? notes[notes.length - 1].midi : null;
      if (snap) {
        const pcs = tensionPcs(chord, key);
        const options = [];
        for (let m = leadLo; m <= leadHi; m += 1) if (pcs.includes(pcOf(m))) options.push(m);
        const near = options.filter((m) => {
          if (Math.abs(m - midis[i]) > 7) return false;
          if (prev != null && Math.abs(m - prev) > 9 && usedLeap) return false;
          if (want && prev != null && m !== prev && Math.sign(m - prev) !== want) return false;
          return true;
        });
        const pool = near.length ? near : options.filter((m) => prev == null || Math.abs(m - prev) <= 9 || !usedLeap);
        if (pool.length) midi = closestMidi(midis[i], pool);
      }
      while (midi < leadLo) midi += 12;
      while (midi > leadHi) midi -= 12;
      if (key.pentatonic && !snap) {
        const options = [];
        for (let m = leadLo; m <= leadHi; m += 1) if (penta.includes(pcOf(m))) options.push(m);
        if (options.length) midi = closestMidi(midi, options);
      }
      if (prev != null && Math.abs(midi - prev) > 9) {
        if (usedLeap) {
          const dir = Math.sign(midi - prev) || 1;
          let pulled = midi;
          while (Math.abs(pulled - prev) > 9) pulled -= dir * 12;
          if (pulled >= leadLo && pulled <= leadHi) midi = pulled;
        } else usedLeap = true;
      }
      notes.push({
        t: Math.round(when * 1000) / 1000,
        midi,
        dur: Math.round(Math.max(0.12, dur) * 1000) / 1000,
        role,
        strong: Boolean(slot.strong),
        contour: want,
      });
    }
    foldLeaps(notes, leadLo, leadHi);
    return notes;
  }

  function motifPack(stretch) {
    const source = plan.motif || { degrees: MOTIF_DEG, steps: MOTIF_S, durs: MOTIF_DUR, strong: MOTIF_STRONG };
    return {
      degrees: source.degrees.slice(),
      starts: source.steps.map((step) => step * stretch),
      durs: source.durs.map((dur) => Math.max(1, dur * stretch)),
      strong: source.strong.slice(),
    };
  }

  function answerOf(degrees) {
    const out = [degrees[0] || 0];
    for (let i = 1; i < degrees.length; i += 1) {
      out.push(out[i - 1] - (degrees[i] - degrees[i - 1]));
    }
    const min = Math.min(...out);
    const shifted = out.map((degree) => degree - min);
    if (shifted.length >= 2) {
      const prev = shifted[shifted.length - 2];
      shifted[shifted.length - 1] = prev > 0 ? 0 : 0;
    }
    return shifted;
  }

  function shapeFor(role) {
    const stretch = style === "ambient" && (plan.motif?.spanBars || 1) < 2 ? 2 : 1;
    const base = motifPack(stretch);
    if (role === "answer") return { ...base, degrees: answerOf(base.degrees) };
    if (role === "cadence") {
      const degrees = base.degrees.map((_, index) => Math.max(0, base.degrees.length - 1 - index));
      const max = degrees[0] || 1;
      const scaled = max > 5 ? degrees.map((degree) => Math.round((degree / max) * 4)) : degrees;
      if (scaled.length) scaled[scaled.length - 1] = 0;
      return { ...base, degrees: scaled };
    }
    if (role === "fragment") {
      const n = Math.min(3, base.degrees.length);
      return {
        degrees: base.degrees.slice(0, n),
        starts: base.starts.slice(0, n),
        durs: base.durs.slice(0, n),
        strong: base.strong.slice(0, n),
      };
    }
    if (role === "displacement") {
      return {
        ...base,
        starts: base.starts.map((start, index) => (index === 0 ? start : start + 1)),
        strong: base.strong.map((flag, index) => (index === 0 ? flag : false)),
      };
    }
    if (role === "ornament") {
      const degrees = base.degrees.slice();
      const starts = base.starts.slice();
      const durs = base.durs.slice();
      const strong = base.strong.slice();
      const at = Math.min(2, Math.max(0, degrees.length - 2));
      const piece = Math.max(1, Math.floor(durs[at] / 2));
      durs[at] = piece;
      starts.splice(at + 1, 0, starts[at] + piece);
      durs.splice(at + 1, 0, Math.max(1, (base.durs[at] || 2) - piece));
      strong.splice(at + 1, 0, false);
      degrees.splice(at + 1, 0, (degrees[at] || 0) + 1);
      return { degrees, starts, durs, strong };
    }
    if (role === "inversion") return { ...base, degrees: invertedDegrees(base.degrees) };
    if (role === "augmentation") {
      return {
        degrees: base.degrees.slice(),
        starts: base.starts.map((start) => start * 2),
        durs: base.durs.map((dur) => dur * 2),
        strong: base.strong.slice(),
      };
    }
    return base;
  }

  function roleFor(name, index, count) {
    if (name === "breakdown") return index % 2 === 0 ? "fragment" : "inversion";
    if (name === "outro" || name === "resolve") return index === 0 ? "augmentation" : "answer";
    if (name === "B" || name === "build") {
      if (style === "arp" && name === "B") return "sequence";
      return index === count - 1 && count > 1 ? "inversion" : "sequence";
    }
    if (name === "A'") {
      if (index === 0) return "motif";
      return index % 2 ? "ornament" : "displacement";
    }
    const ladder = ["motif", "answer", "sequence", "displacement", "fragment"];
    if (index === count - 1 && count > 2) return "cadence";
    return ladder[Math.min(index, ladder.length - 1)];
  }

  for (const section of plan.sections) {
    if (!section.layers.includes("lead")) continue;
    const chordsHere = plan.chords.filter((chord) => chord.t0 >= section.t0 - 0.02 && chord.t0 < section.t1 - 0.02);
    // A generated motif can be longer than one chord (2-bar motifs over a
    // bar-or-faster harmonic rhythm). A phrase then runs across the chord
    // changes (each note still fits the chord under it) and the next phrase
    // starts on the first chord after it, instead of cutting it to one note.
    const spanSec = (plan.motif?.spanBars || 1) * bar * (style === "ambient" && (plan.motif?.spanBars || 1) < 2 ? 2 : 1);
    const calm = motion < 0.32;
    const starters = [];
    if (calm) {
      // Question/answer phrases of 2 bars, or 4 when the motif itself is already
      // two bars, with a rest before the next phrase.
      // Each phrase is one motif span; phrases pair up as call and answer and
      // the breath comes after the answer, so a calm clip still gets a full
      // sentence (and enough notes to carry lyrics) instead of one bar in two.
      const motifBars = Math.max(1, Math.min(2, plan.motif?.spanBars || 1));
      const period = motifBars * bar;
      // Seeded phrasing per clip (mc-melody §phrase): which phrases are
      // followed by a breath, and whether phrases enter on the downbeat or
      // as a pickup, so calm clips do not all share one phrase rhythm.
      const pattern = CALM_PATTERNS[(seed >>> 5) % CALM_PATTERNS.length];
      const pickup = [0, 0, beat, bar * 0.5][(seed >>> 9) & 3];
      let slot = 0;
      for (let t = section.t0; t < section.t1 - Math.min(bar * 0.7, 1.2); t += period, slot += 1) {
        const kind = pattern[slot % pattern.length];
        if (kind === "r") continue;
        const t0 = slot > 0 && pickup ? t - pickup : t;
        if (!chordAt(plan.chords, t0 + 0.03)) continue;
        starters.push({ t0: Math.round(t0 * 1000) / 1000, t1: Math.min(section.t1, t + period), breath: kind === "b" });
      }
    } else {
      let busyUntil = -1;
      for (const chord of chordsHere) {
        if (chord.t0 < busyUntil - 0.05) continue;
        starters.push(chord);
        busyUntil = chord.t0 + spanSec;
      }
    }
    const count = starters.length;
    for (let index = 0; index < count; index += 1) {
      const chord = starters[index];
      const nextStart = index + 1 < count ? starters[index + 1].t0 : section.t1;
      const phraseEnd = calm
        ? Math.min(section.t1, nextStart - (chord.breath || index + 1 >= count ? 0.64 : 0.14))
        : Math.min(nextStart, Math.max(chord.t1, chord.t0 + spanSec));
      let role = roleFor(section.name, index, count);
      if (!role) role = index % 2 ? "answer" : "motif";
      if (motion < 0.38 && style === "lofi" && role === "displacement") role = "inversion";
      let reg = center;
      if (section.name === "B" || section.name === "build") reg += 3;
      else if (role === "sequence") reg += 2;
      const shape = shapeFor(role, section.name);
      let degrees = shape.degrees.slice();
      if (role === "sequence") {
        const shift = 2 + (index % 2);
        degrees = degrees.map((degree) => degree + shift);
      }
      const slots = shape.starts.map((start, slot) => ({
        s: start,
        dur: shape.durs[slot],
        strong: shape.strong[slot],
      }));
      const limit = role === "augmentation" ? section.t1 : phraseEnd;
      let phrase = (style === "synthwave" ? realizeSynth : realize)(degrees, slots, chord.t0, role, reg, limit);
      if (role === "augmentation") {
        const lastChord = chordsHere[chordsHere.length - 1];
        const cadenceT = lastChord.t0;
        const already = phrase.some((note) => Math.abs(note.t - cadenceT) < 0.04);
        if (!already && cadenceT >= chord.t0 - 0.001) {
          phrase = phrase.filter((note) => note.t < cadenceT - 0.02);
          const prevMidi = phrase.length ? phrase[phrase.length - 1].midi : reg;
          let land = reg;
          if (style === "synthwave") {
            const third = pcOf(key.pc + (minorMode(key.mode) ? 3 : 4));
            const options = [];
            for (const pc of [key.pc, third]) {
              for (let m = leadLo; m <= leadHi; m += 1) {
                if (pcOf(m) === pc && Math.abs(m - prevMidi) <= 9) options.push(m);
              }
            }
            land = options.length ? closestMidi(prevMidi, options) : Math.min(leadHi, Math.max(leadLo, prevMidi));
          }
          const room = section.t1 - cadenceT;
          const held = style === "synthwave"
            ? Math.max(0.5, room - 0.04)
            : Math.max(0.5, Math.min(style === "ambient" ? 3 : bar * 0.9, room));
          phrase.push({
            t: Math.round(cadenceT * 1000) / 1000,
            midi: land,
            dur: Math.round(held * 1000) / 1000,
            role,
            strong: true,
            contour: 0,
            land: true,
          });
        } else if (phrase.length) {
          if (style === "synthwave") {
            const onBeat = phrase.find((note) => Math.abs(note.t - cadenceT) < 0.04);
            const cut = onBeat ? onBeat.t : phrase[phrase.length - 1].t;
            phrase = phrase.filter((note) => note.t <= cut + 0.001);
            const target = phrase[phrase.length - 1];
            const prevMidi = phrase.length > 1 ? phrase[phrase.length - 2].midi : target.midi;
            const third = pcOf(key.pc + (minorMode(key.mode) ? 3 : 4));
            const options = [];
            for (const pc of [key.pc, third]) {
              for (let m = leadLo; m <= leadHi; m += 1) {
                if (pcOf(m) === pc && Math.abs(m - prevMidi) <= 9) options.push(m);
              }
            }
            if (options.length) target.midi = closestMidi(prevMidi, options);
            const room = section.t1 - target.t;
            target.dur = Math.round(Math.max(0.5, room - 0.04) * 1000) / 1000;
            target.land = true;
            target.strong = true;
            target.contour = 0;
          } else phrase[phrase.length - 1].land = true;
        }
      }
      if ((role === "answer" || role === "cadence") && phrase.length) {
        phrase[phrase.length - 1].land = true;
        phrase[phrase.length - 1].strong = true;
      }
      if (style === "ambient" && phrase.length) {
        const last = phrase[phrase.length - 1];
        const room = Math.min(phraseEnd, analysis.duration) - last.t;
        const cap = Math.min(calm ? 1.35 : 2.4, Math.max(0.12, room - (calm ? 0.04 : 0.28)));
        if (cap > last.dur + 0.15) last.dur = Math.round(cap * 1000) / 1000;
        if (last.dur > room - 0.04) last.dur = Math.round(Math.max(0.12, room - 0.04) * 1000) / 1000;
      }
      if (calm && phrase.length) {
        const last = phrase[phrase.length - 1];
        const room = Math.min(phraseEnd, analysis.duration) - last.t;
        if (room >= 0.12 && last.dur > room - 0.02) last.dur = Math.round(Math.max(0.12, room - 0.02) * 1000) / 1000;
      }
      if (phrase.length >= 3 && lead.length >= phrase.length) {
        const prevPhrase = lead.slice(-phrase.length);
        const sameLine = prevPhrase.every((note, i) => note.midi === phrase[i].midi);
        if (sameLine) {
          for (const note of phrase) {
            if (note.land) continue;
            const up = nearest(note.midi + 2, scale, leadLo, leadHi);
            if (up != null && up !== note.midi) note.midi = up;
          }
        }
      }
      if (phrase.length >= 4 && lead.length >= 8) {
        const cell = phrase.slice(0, 4).map((note) => note.midi).join(".");
        const prev = lead.slice(-4).map((note) => note.midi).join(".");
        const before = lead.slice(-8, -4).map((note) => note.midi).join(".");
        if (cell === prev && cell === before) {
          for (const note of phrase) {
            if (note.land) continue;
            const up = nearest(note.midi + 3, scale, leadLo, leadHi);
            if (up != null) note.midi = up;
          }
        }
      }
      if (!phrase.length) continue;
      lead.push(...phrase);
      if (section.layers.includes("counter") && style !== "synthwave") layCounter(phrase, plan, scale, counter, beat);
    }
    if (style === "synthwave" && section.layers.includes("counter")) {
      const here = lead.filter((note) => note.t >= section.t0 - 0.02 && note.t < section.t1 - 0.02);
      layGuide(chordsHere, here, counter);
    }
  }
  return { lead, counter };
}

function layCounter(phrase, plan, scale, counter, beat) {
  const clo = 50;
  const chi = 69;
  const bar = plan.meter?.barLen || beat * 4;
  const energyAt = (t) => {
    const i = Math.max(0, Math.floor((t + 0.0001) / Math.max(0.05, bar)));
    const e = plan.energy?.[i];
    return Number.isFinite(e) ? e : 0.55;
  };
  const lastEnd = () => (counter.length ? counter[counter.length - 1].t + counter[counter.length - 1].dur : -1);
  const place = (t, midi, dur, role, strong) => {
    if (added >= budget) return;
    let when = t;
    if (when < lastEnd() - 0.01) when = lastEnd() + 0.02;
    const d = Math.max(0.12, dur);
    if (d < 0.12 || when + 0.12 > t + dur + 0.2) return;
    let m = Math.round(midi);
    while (m < clo) m += 12;
    while (m > chi) m -= 12;
    counter.push({
      t: Math.round(when * 1000) / 1000,
      midi: m,
      dur: Math.round(Math.min(d, Math.max(0.12, dur)) * 1000) / 1000,
      role,
      strong: Boolean(strong),
    });
    added += 1;
  };
  const snap = (midi, chord, ceiling) => {
    const top = Math.min(chi, ceiling);
    let m = fitMidi(midi, chord, false, scale, clo, top) ?? midi;
    while (m > top) m -= 12;
    while (m < clo) m += 12;
    if (m > top) m = top;
    let guard = 0;
    while (!scale.includes(pcOf(m)) && guard < 6) {
      m -= 1;
      guard += 1;
    }
    if (m < clo) m = clo;
    return m;
  };
  const avg = phrase.reduce((sum, note) => sum + note.dur, 0) / Math.max(1, phrase.length);
  const busy = avg < beat * 0.55 || phrase.length >= 6;
  const budget = busy ? Math.max(2, Math.floor(phrase.length / 2)) : phrase.length * 2;
  let added = 0;
  let i = 0;
  while (i < phrase.length) {
    const note = phrase[i];
    const e = energyAt(note.t);
    const prevLead = i > 0 ? phrase[i - 1] : null;
    const leadDir = prevLead ? (Math.sign(note.midi - prevLead.midi) || 1) : 1;
    if (prevLead) {
      const gap = note.t - (prevLead.t + prevLead.dur);
      if (gap > beat * 0.85) {
        const steps = Math.min(busy ? 1 : 2, Math.max(1, Math.floor(gap / Math.max(0.2, beat * 0.5))));
        let t = prevLead.t + prevLead.dur + 0.04;
        let m = counter.length ? counter[counter.length - 1].midi : note.midi - 12;
        for (let k = 0; k < steps && t < note.t - 0.16; k += 1) {
          const pos = ((t % bar) + bar) % bar;
          if (e < 0.32 && pos > bar * 0.14) {
            const nextDown = t - pos + bar;
            if (nextDown >= note.t - 0.16) break;
            t = nextDown;
          }
          m += leadDir > 0 ? -2 : 2;
          const chord = chordAt(plan.chords, t);
          m = snap(m, chord, note.midi - 3);
          const cellStep = beat * counterCell[k % counterCell.length];
          place(t, m, Math.min(0.5, cellStep * 0.8), "contrary", true);
          t += Math.max(0.2, cellStep);
        }
      }
    }
    if (note.dur > beat * 0.55) {
      const maxN = busy ? 1 : Math.min(3, Math.max(1, Math.floor(note.dur / Math.max(0.3, beat * 0.9))));
      let t = note.t;
      const pos0 = ((t % bar) + bar) % bar;
      if (e < 0.32 && pos0 > bar * 0.14) {
        const barStart = t - pos0;
        const hit = [barStart, barStart + bar].find((c) => c >= note.t - 0.001 && c < note.t + note.dur - 0.16);
        if (hit == null) {
          i += 1;
          continue;
        }
        t = hit;
      }
      const chord = chordAt(plan.chords, t);
      let m = snap(note.midi - 12 - leadDir * 2, chord, note.midi - 3);
      if (pcOf(m) === pcOf(note.midi)) m = snap(m - 2, chord, note.midi - 3);
      const room = note.dur - (t - note.t);
      for (let k = 0; k < maxN && t < note.t + note.dur - 0.14; k += 1) {
        const stepT = Math.max(0.2, Math.min(beat * counterCell[k % counterCell.length], room / Math.max(1, maxN - k)));
        if (k > 0) {
          const dir = (k % 2 === 0 ? 1 : -1) * leadDir;
          m = snap(m + dir * 2, chordAt(plan.chords, t), note.midi - 3);
          if (pcOf(m) === pcOf(note.midi)) m = snap(m - 2, chordAt(plan.chords, t), note.midi - 3);
        }
        const dur = Math.min(stepT * 0.82, note.t + note.dur - t - 0.02);
        if (dur >= 0.12) place(t, m, dur, k % 2 === 0 ? "contrary" : "oblique", k === 0);
        t += stepT;
      }
      i += 1;
      continue;
    }
    let j = i + 1;
    const groupCap = busy ? 3 : 2;
    while (j < phrase.length && j - i < groupCap && phrase[j].dur <= beat * 0.55 && phrase[j].t < note.t + beat * 2) j += 1;
    if (busy && phrase.length > 6 && (i % 2 === 1)) {
      i = j;
      continue;
    }
    let onset = note.t;
    const pos = ((onset % bar) + bar) % bar;
    if (e < 0.32 && pos > bar * 0.14) {
      const down = onset - pos + bar;
      if (down < note.t + note.dur - 0.12 && down < (phrase[j - 1].t + phrase[j - 1].dur)) onset = down;
      else {
        i = j;
        continue;
      }
    }
    const chord = chordAt(plan.chords, onset);
    let midi = snap(note.midi - 12, chord, note.midi - 3);
    if (counter.length && Math.abs(midi - counter[counter.length - 1].midi) > 5) {
      const step = Math.sign(counter[counter.length - 1].midi - midi) || -1;
      midi = snap(counter[counter.length - 1].midi + step * 2, chord, note.midi - 3);
    }
    if (pcOf(midi) === pcOf(note.midi)) midi = snap(midi - 2, chord, note.midi - 3);
    const end = phrase[Math.min(phrase.length - 1, j - 1)].t + Math.min(phrase[j - 1].dur, beat * 0.9);
    const dur = Math.max(0.12, Math.min(beat * 0.85, end - onset));
    place(onset, midi, dur, "oblique", true);
    i = j;
  }
}

function wrapBass(midi) {
  let m = midi;
  while (m > 43) m -= 12;
  while (m < 31) m += 12;
  return m;
}

function stepBetween(prev, dest, scale) {
  if (pcOf(prev) === pcOf(dest)) return null;
  const dir = dest >= prev ? 1 : -1;
  if (Math.abs(dest - prev) <= 2) return null;
  for (let midi = prev + dir; dir > 0 ? midi < dest : midi > dest; midi += dir) {
    if (scale.includes(pcOf(midi))) return wrapBass(midi);
  }
  return wrapBass(prev + dir);
}

export function walkBass(chords, bpm, key, sections, beatsPerBar = 4) {
  const beat = 60 / bpm;
  const scale = scaleOf(key);
  const notes = [];
  for (let c = 0; c < chords.length; c += 1) {
    const chord = chords[c];
    const section = sectionAt(sections, chord.t0 + 0.001);
    const pedal = section && section.layers.includes("pedal");
    const walking = section && section.layers.includes("bass");
    const root = wrapBass(chord.bassPc != null ? chord.bassPc + 36 : chord.rootPc + 36);
    if (pedal) {
      notes.push({
        t: Math.round(chord.t0 * 1000) / 1000,
        midi: wrapBass(key.pc + 36),
        dur: Math.round(Math.max(0.3, chord.t1 - chord.t0) * 1000) / 1000,
        degree: "pedal",
      });
      continue;
    }
    if (!walking) continue;
    const next = chords[c + 1];
    const beats = [];
    for (let t = chord.t0; t < chord.t1 - beat * 0.35 && beats.length < beatsPerBar; t += beat) beats.push(t);
    if (!beats.length) beats.push(chord.t0);
    const third = wrapBass(root + (scale.includes(pcOf(root + 3)) ? 3 : 4));
    const fifth = wrapBass(root + 7);
    for (let i = 0; i < beats.length; i += 1) {
      const last = i === beats.length - 1;
      const prevMidi = notes.length ? notes[notes.length - 1].midi : root;
      let midi = root;
      let degree = "root";
      if (i === 0) {
        midi = root;
        degree = chord.bassPc != null ? "slash" : "root";
      } else if (last && next && pcOf(next.rootPc) !== pcOf(chord.rootPc)) {
        const target = wrapBass((next.bassPc != null ? next.bassPc : next.rootPc) + 36);
        midi = wrapBass(target - 1);
        degree = "approach";
        if (Math.abs(midi - prevMidi) > 5) {
          const stepped = stepBetween(prevMidi, target, scale);
          if (stepped != null) midi = stepped;
        }
      } else if (i % 2 === 1) {
        const upcoming = fifth;
        const stepped = stepBetween(prevMidi, upcoming, scale);
        if (stepped != null && pcOf(stepped) !== pcOf(prevMidi)) {
          midi = stepped;
          degree = "passing";
        } else if (pcOf(third) !== pcOf(prevMidi)) {
          midi = third;
          degree = "third";
        } else {
          midi = fifth;
          degree = "fifth";
        }
      } else if (pcOf(fifth) !== pcOf(prevMidi)) {
        midi = fifth;
        degree = "fifth";
      } else {
        midi = third;
        degree = "third";
      }
      const slotEnd = last && next ? next.t0 : (i + 1 < beats.length ? beats[i + 1] : chord.t1);
      const dur = Math.max(0.08, Math.min(beat * 0.92, 0.55, slotEnd - beats[i] - 0.02));
      notes.push({
        t: Math.round(beats[i] * 1000) / 1000,
        midi,
        dur: Math.round(dur * 1000) / 1000,
        degree,
      });
    }
  }
  return notes;
}

// Eighth-note root pulse for synthwave. An octave jump every other half-bar
// stays on the same pitch class, so the clash checker still hears the root.
export function pulseBass(chords, bpm, sections, meter) {
  const beat = 60 / bpm;
  const eighth = meter?.sub === 3 ? beat / 3 : beat / 2;
  const perBar = Math.max(2, (meter?.beats || 4) * (meter?.sub === 3 ? 3 : 2));
  const notes = [];
  for (const chord of chords) {
    const section = sectionAt(sections, chord.t0 + 0.001);
    if (!section || !section.layers.includes("bass")) continue;
    let root = chord.rootPc + 36;
    while (root > 43) root -= 12;
    while (root < 31) root += 12;
    if (section.name === "breakdown" || section.name === "outro" || section.name === "resolve") {
      notes.push({
        t: Math.round(chord.t0 * 1000) / 1000,
        midi: root,
        dur: Math.round(Math.max(0.2, chord.t1 - chord.t0) * 1000) / 1000,
        degree: "held",
      });
      continue;
    }
    let i = 0;
    for (let t = chord.t0; t < chord.t1 - eighth * 0.25; t += eighth) {
      const jump = i % perBar === Math.floor(perBar / 2) || i % perBar === Math.floor(perBar / 2) + 1;
      const midi = jump ? root + 12 : root;
      const dur = Math.min(eighth * 0.9, chord.t1 - t);
      notes.push({
        t: Math.round(t * 1000) / 1000,
        midi,
        dur: Math.round(Math.max(0.05, dur) * 1000) / 1000,
        degree: jump ? "octave" : "root",
      });
      i += 1;
    }
  }
  return notes;
}

function alignToChord(notes, chords) {
  for (const note of notes) {
    const next = chords.find((chord) => chord.t0 > note.t + 0.001);
    if (!next) continue;
    const early = next.t0 - note.t;
    if (early <= 0 || early >= 0.05) continue;
    note.t = Math.round(next.t0 * 1000) / 1000;
    note.dur = Math.round(Math.max(0.12, (note.dur || 0.2) - early) * 1000) / 1000;
  }
}

export function settleStrong(lead, counter, chords) {
  alignToChord(lead, chords);
  alignToChord(counter, chords);
  for (const note of counter) {
    const other = lead.find((item) => Math.abs(item.t - note.t) < 0.04);
    if (!other) continue;
    if (pcOf(other.midi) === pcOf(note.midi) || note.midi > other.midi - 3) {
      note.midi = Math.max(50, other.midi - 3);
    }
  }
}

export function fixParallel(lead, counter, bass) {
  const covering = (notes, t) => notes.find((note) => t >= note.t - 0.04 && t < note.t + (note.dur || 0.25) - 0.02);
  for (let i = 1; i < lead.length; i += 1) {
    const prev = lead[i - 1];
    const note = lead[i];
    const b0 = covering(bass, prev.t);
    const b1 = covering(bass, note.t);
    if (!b0 || !b1) continue;
    const same = pcOf(prev.midi) === pcOf(b0.midi) && pcOf(note.midi) === pcOf(b1.midi);
    const leadDir = Math.sign(note.midi - prev.midi);
    const bassDir = Math.sign(b1.midi - b0.midi);
    if (same && leadDir !== 0 && leadDir === bassDir) {
      const nudged = note.midi + (leadDir > 0 ? -3 : 3);
      if (Math.sign(nudged - prev.midi) === leadDir) note.midi = nudged;
      else {
        const alt = wrapBass(b1.midi + (bassDir > 0 ? -3 : 3));
        if (pcOf(alt) !== pcOf(note.midi)) {
          b1.midi = alt;
          b1.degree = "neighbor";
        }
      }
    }
  }
  for (const note of counter) {
    const other = covering(lead, note.t);
    if (!other) continue;
    if (pcOf(other.midi) === pcOf(note.midi)) note.midi -= 3;
    const dist = Math.min((note.midi - other.midi + 120) % 12, (other.midi - note.midi + 120) % 12);
    if (note.strong && dist === 1) note.midi -= 2;
  }
}

const MOTIF_SIGNS = [1, -1, 1, -1, 1];
const INVERT_SIGNS = [-1, 1, -1, 1, -1];

function registerOf(lead, style) {
  if (style === "lofi") return [71, 83];
  if (style === "synthwave") return [69, 86];
  const lo = Math.min(...lead.map((note) => note.midi));
  const hi = Math.max(...lead.map((note) => note.midi));
  if (lo >= 74 && hi > 83) return [74, 88];
  if (lo >= 71 && hi <= 83) return [71, 83];
  return [69, 88];
}

function withSign(prev, midi, want, lo, hi) {
  if (want === 0 || Math.sign(midi - prev) === want) {
    return Math.min(hi, Math.max(lo, midi));
  }
  let best = null;
  for (let alt = lo; alt <= hi; alt += 1) {
    if (Math.sign(alt - prev) !== want) continue;
    if (best == null || Math.abs(alt - midi) < Math.abs(best - midi)) best = alt;
  }
  return best == null ? Math.min(hi, Math.max(lo, midi)) : best;
}

function landMidi(note, chord, key, lo, hi) {
  const third = pcOf(key.pc + (minorMode(key.mode) ? 3 : 4));
  const tones = chord ? tensionPcs(chord, key) : [];
  const order = [key.pc, third, chord?.rootPc].filter((pc, index, list) => pc != null && tones.includes(pc) && list.indexOf(pc) === index);
  for (const pc of order) {
    const hit = nearest(note.midi, [pc], lo, hi);
    if (hit != null) return hit;
  }
  const any = nearest(note.midi, tones.length ? tones : scaleOf(key), lo, hi);
  return any == null ? note.midi : any;
}

// Labels are only true if the sounded intervals still match the motif after
// clash and parallel repairs. Answer and the augmented cadence keep their
// tonic-or-third landing instead of the motif's last interval.
export function keepContour(lead, key, chords, _bar, style) {
  if (!lead.length) return;
  const scale = scaleOf(key);
  const [lo, hi] = registerOf(lead, style);
  for (let i = 1; i < lead.length; i += 1) {
    const note = lead[i];
    const prev = lead[i - 1];
    if (!note.contour || note.role !== prev.role || note.land) continue;
    if (Math.sign(note.midi - prev.midi) === note.contour) continue;
    const chord = chords ? chordAt(chords, note.t + 0.01) : null;
    const pcs = (note.strong || note.dur > 0.25) && chord ? tensionPcs(chord, key) : scale;
    const options = [];
    for (let m = lo; m <= hi; m += 1) {
      if (!pcs.includes(pcOf(m))) continue;
      if (Math.sign(m - prev.midi) !== note.contour) continue;
      options.push(m);
    }
    if (options.length) note.midi = closestMidi(note.midi, options);
  }
  for (const note of lead) {
    if (!note.land || !chords) continue;
    const chord = chordAt(chords, note.t + 0.01);
    note.midi = landMidi(note, chord, key, lo, hi);
  }
}

function bassPcsAt(t, dur, bass, chord, style, key, sections) {
  const pcs = [];
  if (style === "lofi" || style === "synthwave") {
    for (const note of bass || []) {
      const end = note.t + (note.dur || 0.3);
      if (note.t < t + Math.max(dur, 0.05) - 0.02 && end > t + 0.02) pcs.push(pcOf(note.midi));
    }
    return pcs;
  }
  if (!chord) return pcs;
  if (style === "arp") {
    pcs.push(chord.rootPc);
    if (chord.bassPc != null) pcs.push(chord.bassPc);
    return pcs;
  }
  const section = sectionAt(sections, t);
  const local = keyAt(key, t);
  if (!chord.notes?.length) {
    if (section && section.layers.includes("pedal")) pcs.push(local.pc);
    return pcs;
  }
  // Same pitch the renderer holds under the pad: tonic pedal, or an octave
  // under the lowest chord tone, clamped at MIDI 36 (which can be a new class).
  const low = Math.min(...chord.notes);
  const pedal = section && section.layers.includes("pedal");
  let bassMidi = pedal ? local.pc + 36 : low - 12;
  if (bassMidi < 36) bassMidi += 12 * Math.ceil((36 - bassMidi) / 12);
  pcs.push(pcOf(bassMidi));
  return pcs;
}

// Walking bass is the last word on parallel unisons. Nudge it by a whole step
// (then a third or fourth) so it no longer copies the lead, and so the new
// pitch is not a semitone from any long note still ringing over that bass.
function breakParallels(lead, bass) {
  const covering = (t) => (bass || []).find((note) => t >= note.t - 0.04 && t < note.t + (note.dur || 0.3) - 0.02);
  const harmful = (midi, bassNote, except) => {
    const end = bassNote.t + (bassNote.dur || 0.3);
    return (lead || []).some((note) => {
      if (note === except) return false;
      if (!note.strong && (note.dur || 0) <= 0.25) return false;
      const noteEnd = note.t + (note.dur || 0.2);
      if (note.t >= end - 0.02 || noteEnd <= bassNote.t + 0.02) return false;
      return semitoneApart(midi, note.midi);
    });
  };
  for (let i = 1; i < (lead || []).length; i += 1) {
    const prev = lead[i - 1];
    const note = lead[i];
    const b0 = covering(prev.t);
    const b1 = covering(note.t);
    if (!b0 || !b1 || b0 === b1) continue;
    const same = pcOf(prev.midi) === pcOf(b0.midi) && pcOf(note.midi) === pcOf(b1.midi);
    const leadDir = Math.sign(note.midi - prev.midi);
    const bassDir = Math.sign(b1.midi - b0.midi);
    if (!same || leadDir === 0 || leadDir !== bassDir) continue;
    const steps = bassDir > 0 ? [-2, 2, -5, 5, -3, 3, -7, 7] : [2, -2, 5, -5, 3, -3, 7, -7];
    let chosen = null;
    for (const step of steps) {
      let alt = b1.midi + step;
      while (alt > 43) alt -= 12;
      while (alt < 31) alt += 12;
      if (semitoneApart(alt, note.midi) || pcOf(alt) === pcOf(note.midi)) continue;
      if (harmful(alt, b1, note)) continue;
      chosen = alt;
      break;
    }
    if (chosen == null) continue;
    b1.midi = chosen;
    b1.degree = "neighbor";
  }
}

function soundingPcs(chord, extras) {
  const pcs = [...new Set((chord?.notes || []).map((midi) => pcOf(midi)))];
  for (const pc of extras) if (!pcs.includes(pc)) pcs.push(pc);
  return pcs;
}

// A clash repair can flatten a motif interval. Put the nearest chord tone back
// in the motif's direction, within a 6th, without reintroducing the clash.
function restoreContour(lead, chords, bass, key, style, sections, lo, hi) {
  for (let i = 1; i < lead.length; i += 1) {
    const note = lead[i];
    const prev = lead[i - 1];
    if (!note.contour || note.role !== prev.role || note.land) continue;
    if (Math.sign(note.midi - prev.midi) === note.contour) continue;
    const chord = chords ? chordAt(chords, note.t + 0.01) : null;
    const long = note.strong || (note.dur || 0) > 0.25;
    const local = keyAt(key, note.t);
    const pcs = long && chord ? tensionPcs(chord, local) : scaleOf(local);
    const extras = bassPcsAt(note.t, note.dur || 0.2, bass, chord, style, key, sections);
    const sounding = soundingPcs(chord, extras);
    let options = [];
    for (let m = lo; m <= hi; m += 1) {
      if (!pcs.includes(pcOf(m))) continue;
      if (Math.sign(m - prev.midi) !== note.contour) continue;
      if (Math.abs(m - prev.midi) > 9) continue;
      if (long && sounding.some((pc) => semitoneApart(m, pc))) continue;
      options.push(m);
    }
    const next = lead[i + 1];
    if (next && next.contour && next.role === note.role && !next.land) {
      const both = options.filter((m) => Math.sign(next.midi - m) === next.contour && Math.abs(next.midi - m) <= 9);
      if (both.length) options = both;
    }
    if (options.length) note.midi = closestMidi(prev.midi + note.contour, options);
  }
}

// Last word on the lead: chord-tone snaps above can flatten a calm motif.
// Restore a singable contour without a semitone against the pad or the bass,
// and without a leap the audit would reject. Runs after both clash passes.
function ensureSingable(lead, counter, chords, bass, key, style, sections) {
  if (!lead || lead.length < 2) return;
  const lo = style === "lofi" ? 71 : 69;
  const hi = style === "lofi" ? 83 : style === "synthwave" ? 86 : 88;
  const maxRange = style === "lofi" ? 12 : 16;
  const bar = sections && sections[0] && sections[0].bars
    ? (sections[0].t1 - sections[0].t0) / sections[0].bars
    : 2;
  const poolOf = (note) => {
    const chord = chords ? chordAt(chords, note.t + 0.01) : null;
    const local = keyAt(key, note.t);
    const extras = bassPcsAt(note.t, note.dur || 0.2, bass, chord, style, key, sections);
    const sounding = soundingPcs(chord, extras);
    const scale = scaleOf(local);
    const tones = chord ? tensionPcs(chord, local) : scale;
    const pcs = new Set([...tones, ...scale]);
    const bag = [];
    for (let m = lo; m <= hi; m += 1) {
      if (!pcs.has(pcOf(m))) continue;
      if (sounding.some((pc) => semitoneApart(m, pc))) continue;
      bag.push(m);
    }
    return bag;
  };
  const put = (note, target, pred) => {
    const pool = poolOf(note);
    if (!pool.length) return false;
    const bag = pred ? pool.filter(pred) : pool;
    if (!bag.length) return false;
    note.midi = closestMidi(target, bag);
    return true;
  };
  const scrub = () => {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 1; i < lead.length; i += 1) {
        const prev = lead[i - 1];
        const note = lead[i];
        if (note.t - (prev.t + (prev.dur || 0)) > 0.6) continue;
        const gap = note.midi - prev.midi;
        if (Math.abs(gap) > 9 && Math.abs(gap) !== 12) {
          const dir = Math.sign(gap) || 1;
          put(note, prev.midi + dir * 3, (m) => {
            const d = Math.abs(m - prev.midi);
            return d >= 1 && (d <= 9 || d === 12);
          });
        }
        if (i < 2) continue;
        const prev2 = lead[i - 2];
        if (prev.t - (prev2.t + (prev2.dur || 0)) > 0.6) continue;
        const d0 = prev.midi - prev2.midi;
        const d1 = note.midi - prev.midi;
        if (Math.abs(d0) >= 5 && Math.abs(d1) >= 5 && Math.sign(d0) !== 0 && Math.sign(d0) === Math.sign(d1) && Math.abs(d0 + d1) > 12) {
          put(note, prev.midi - Math.sign(d0) * 2, (m) => m !== prev.midi && Math.abs(m - prev.midi) <= 4);
        }
        const d2 = note.midi - prev.midi;
        if (Math.abs(d0) >= 7 && !(Math.sign(d2) === -Math.sign(d0) && Math.abs(d2) <= 4)) {
          const want = -Math.sign(d0) || -1;
          put(note, prev.midi + want * 2, (m) => Math.sign(m - prev.midi) === want && Math.abs(m - prev.midi) >= 1 && Math.abs(m - prev.midi) <= 4);
        }
      }
    }
  };
  for (let i = 3; i < lead.length; i += 1) {
    const a = lead[i].midi;
    if (a !== lead[i - 1].midi || a !== lead[i - 2].midi || a !== lead[i - 3].midi) continue;
    put(lead[i], a + 3, (m) => m !== a);
  }
  const phrases = [];
  let cur = [];
  for (const note of lead) {
    if (cur.length && note.t - (cur[cur.length - 1].t + cur[cur.length - 1].dur) > 0.35) {
      phrases.push(cur);
      cur = [];
    }
    cur.push(note);
  }
  if (cur.length) phrases.push(cur);
  phrases.forEach((phrase, p) => {
    if (phrase.length < 3) return;
    const midis = () => phrase.map((n) => n.midi);
    const rangeOf = () => Math.max(...midis()) - Math.min(...midis());
    let run = 1;
    let longest = 1;
    const now = midis();
    for (let i = 1; i < now.length; i += 1) {
      if (now[i] === now[i - 1]) {
        run += 1;
        longest = Math.max(longest, run);
      } else run = 1;
    }
    const distinct = new Set(now).size;
    const peakI = now.indexOf(Math.max(...now));
    const interior = peakI > 0 && peakI < phrase.length - 1;
    const range = rangeOf();
    const hard = distinct < Math.min(5, phrase.length) || (phrase.length >= 4 && range < 7) || longest > 3;
    if (!hard && interior && range <= maxRange) return;
    if (!hard) {
      const at = Math.max(1, Math.min(phrase.length - 2, Math.floor(phrase.length * 0.6)));
      const left = phrase[at - 1].midi;
      const right = phrase[at + 1].midi;
      put(phrase[at], Math.max(left, right) + 2, (m) => m > left && m > right && Math.abs(m - left) <= 5 && Math.abs(phrase[at + 1].midi - m) <= 5);
      return;
    }
    const n = phrase.length;
    const peak = Math.max(1, Math.min(n - 2, Math.floor((n - 1) * 0.62)));
    const pool0 = poolOf(phrase[0]);
    const low = pool0.filter((m) => m <= lo + Math.max(4, Math.floor((hi - lo) * 0.5)));
    if (low.length) phrase[0].midi = low[Math.min(low.length - 1, p % low.length)];
    const base = phrase[0].midi;
    const span = Math.min(9, maxRange - 1);
    for (let i = 1; i < n; i += 1) {
      const rise = i <= peak ? i / peak : (n - 1 - i) / Math.max(1, n - 1 - peak);
      const want = base + Math.round(rise * span);
      const prev = phrase[i - 1].midi;
      put(phrase[i], want, (m) => Math.abs(m - prev) >= 1 && Math.abs(m - prev) <= 5);
    }
  });
  if (lead.length >= 4) {
    const loM = Math.min(...lead.map((n) => n.midi));
    const hiM = Math.max(...lead.map((n) => n.midi));
    if (hiM - loM > maxRange) {
      const cap = loM + maxRange;
      for (const note of lead) {
        if (note.midi <= cap) continue;
        put(note, cap, (m) => m <= cap && m >= loM);
      }
    }
    const lo2 = Math.min(...lead.map((n) => n.midi));
    const hi2 = Math.max(...lead.map((n) => n.midi));
    if (hi2 - lo2 < 7) {
      let peakI = 0;
      lead.forEach((n, i) => { if (n.midi >= lead[peakI].midi) peakI = i; });
      if (peakI === 0 || peakI === lead.length - 1) peakI = Math.max(1, Math.min(lead.length - 2, Math.floor(lead.length * 0.6)));
      const prev = lead[Math.max(0, peakI - 1)].midi;
      put(lead[peakI], lo2 + 7, (m) => m >= lo2 + 7 && m <= lo2 + maxRange && Math.abs(m - prev) <= 7);
    }
  }
  if (bar > 0.2) {
    const end = lead[lead.length - 1].t;
    for (let t0 = 0; t0 <= end + 0.01; t0 += bar * 8) {
      const slice = lead.filter((n) => n.t >= t0 - 0.001 && n.t < t0 + bar * 8);
      if (slice.length < 4) continue;
      const have = () => new Set(slice.map((n) => n.midi));
      if (have().size >= 5) continue;
      const counts = new Map();
      for (const n of slice) counts.set(n.midi, (counts.get(n.midi) || 0) + 1);
      let common = slice[0].midi;
      let bestC = 0;
      for (const [m, c] of counts) if (c > bestC) { bestC = c; common = m; }
      const order = slice.slice().sort((a, b) => (counts.get(b.midi) || 0) - (counts.get(a.midi) || 0));
      for (const note of order) {
        if (have().size >= 5) break;
        const idx = lead.indexOf(note);
        const prev = idx > 0 ? lead[idx - 1].midi : note.midi;
        const next = idx + 1 < lead.length ? lead[idx + 1].midi : note.midi;
        const seen = have();
        const moved = put(note, note.midi + 3, (m) => !seen.has(m) && Math.abs(m - prev) <= 7 && Math.abs(m - next) <= 7);
        if (!moved) put(note, note.midi + 5, (m) => !seen.has(m));
      }
    }
  }
  for (let i = 3; i < lead.length; i += 1) {
    const a = lead[i].midi;
    if (a !== lead[i - 1].midi || a !== lead[i - 2].midi || a !== lead[i - 3].midi) continue;
    put(lead[i], a + 3, (m) => m !== a);
  }
  if (lead.length >= 2) {
    const loM = Math.min(...lead.map((n) => n.midi));
    const cap = loM + maxRange;
    for (const note of lead) {
      if (note.midi <= cap) continue;
      put(note, cap, (m) => m <= cap && m >= loM);
    }
  }
  scrub();
  for (let i = lead.length - 1; i >= 3; i -= 1) {
    if (lead[i].midi !== lead[i - 1].midi || lead[i].midi !== lead[i - 2].midi || lead[i].midi !== lead[i - 3].midi) continue;
    const moved = put(lead[i], lead[i].midi + 2, (m) => m !== lead[i].midi && Math.abs(m - lead[i - 1].midi) <= 5);
    if (!moved) put(lead[i], lead[i].midi + 2, (m) => m !== lead[i].midi);
    if (lead[i].midi === lead[i - 1].midi) lead.splice(i, 1);
  }
  scrub();
  if (bar > 0.2 && lead.length) {
    const end = lead[lead.length - 1].t + (lead[lead.length - 1].dur || 0);
    for (let t0 = 0; t0 < end; t0 += bar * 8) {
      const slice = lead.filter((n) => n.t >= t0 && n.t < t0 + bar * 8);
      if (slice.length < 4) continue;
      let guard = 0;
      while (new Set(slice.map((n) => n.midi)).size < 5 && guard < 8) {
        guard += 1;
        const seen = new Set(slice.map((n) => n.midi));
        const note = slice[slice.length - 1 - ((guard - 1) % slice.length)];
        const idx = lead.indexOf(note);
        const prev = idx > 0 ? lead[idx - 1].midi : note.midi;
        const next = idx + 1 < lead.length ? lead[idx + 1].midi : note.midi;
        const ok = put(note, note.midi + 1 + guard, (m) => !seen.has(m) && Math.abs(m - prev) <= 7 && Math.abs(m - next) <= 7);
        if (!ok) put(note, note.midi + guard, (m) => !seen.has(m) && Math.abs(m - prev) <= 9);
      }
    }
  }
  if (lead.length >= 2) {
    const loM = Math.min(...lead.map((n) => n.midi));
    const cap = loM + maxRange;
    for (const note of lead) {
      if (note.midi <= cap) continue;
      put(note, cap, (m) => m <= cap && m >= loM);
    }
  }
  scrub();
  for (let i = lead.length - 1; i >= 3; i -= 1) {
    if (lead[i].midi !== lead[i - 1].midi || lead[i].midi !== lead[i - 2].midi || lead[i].midi !== lead[i - 3].midi) continue;
    const prev = lead[i - 1].midi;
    const moved = put(lead[i], prev + 2, (m) => m !== prev && Math.abs(m - prev) >= 1 && Math.abs(m - prev) <= 4);
    if (!moved || lead[i].midi === prev) {
      lead.splice(i, 1);
      if (i > 0 && i < lead.length) {
        const left = lead[i - 1];
        const right = lead[i];
        if (right.t - (left.t + (left.dur || 0)) <= 0.6 && Math.abs(right.midi - left.midi) > 5) {
          const dir = Math.sign(right.midi - left.midi) || 1;
          put(right, left.midi + dir * 2, (m) => m !== left.midi && Math.abs(m - left.midi) <= 4);
        }
      }
    }
  }
  if (lead.length >= 2) {
    const loM = Math.min(...lead.map((n) => n.midi));
    const cap = loM + maxRange;
    for (let i = 0; i < lead.length; i += 1) {
      const note = lead[i];
      if (note.midi <= cap) continue;
      const prev = i > 0 ? lead[i - 1].midi : cap;
      const moved = put(note, cap, (m) => m <= cap && m >= loM && m !== prev && Math.abs(m - prev) <= 5);
      if (!moved) put(note, cap, (m) => m <= cap && m >= loM);
    }
  }
  for (let i = lead.length - 1; i >= 3; i -= 1) {
    if (lead[i].midi === lead[i - 1].midi && lead[i].midi === lead[i - 2].midi && lead[i].midi === lead[i - 3].midi) {
      lead.splice(i, 1);
    }
  }
  for (let i = 0; i < (counter || []).length; i += 1) {
    const note = counter[i];
    const other = lead.find((item) => note.t >= item.t - 0.03 && note.t < item.t + (item.dur || 0.2))
      || lead.find((item) => Math.abs(item.t - note.t) < 0.08);
    const floor = style === "synthwave" ? 52 : 50;
    const ceiling = other ? Math.min(69, other.midi - 3) : 69;
    if (ceiling < floor) continue;
    const chord = chords ? chordAt(chords, note.t + 0.01) : null;
    const local = keyAt(key, note.t);
    const extras = bassPcsAt(note.t, note.dur || 0.2, bass, chord, style, key, sections);
    const sounding = soundingPcs(chord, extras);
    const scale = scaleOf(local);
    const pool = [];
    for (let m = floor; m <= ceiling; m += 1) {
      if (!scale.includes(pcOf(m)) && !(chord?.notes || []).some((tone) => pcOf(tone) === pcOf(m))) continue;
      if (sounding.some((pc) => semitoneApart(m, pc))) continue;
      if (other && (pcOf(m) === pcOf(other.midi) || m > other.midi - 3)) continue;
      pool.push(m);
    }
    if (!pool.length) continue;
    const prev = i > 0 ? counter[i - 1].midi : note.midi;
    const stepish = pool.filter((m) => Math.abs(m - prev) <= 5);
    if (pool.includes(note.midi)) continue;
    note.midi = closestMidi(Math.min(note.midi, ceiling), stepish.length ? stepish : pool);
  }
}

// Move any lead or counter note that sits a semitone from the pad or the bass
// for longer than a quarter of a second onto a chord tone. Short weak neighbors stay.
export function clearClashes(lead, counter, chords, bass, key, style, sections) {
  const leadLo = style === "lofi" ? 71 : style === "synthwave" ? 69 : 69;
  const leadHi = style === "lofi" ? 83 : style === "synthwave" ? 86 : 88;
  const flags = [];
  const clash = (midi, pcs) => pcs.some((pc) => semitoneApart(midi, pc));
  const safePool = (chord, extras, lo, hi, ceiling, t) => {
    const local = keyAt(key, t);
    const base = chord ? tensionPcs(chord, local) : scaleOf(local);
    const sounding = soundingPcs(chord, extras);
    const pcs = base.filter((pc) => !sounding.some((other) => semitoneApart(pc, other)));
    const pool = [];
    const top = ceiling == null ? hi : Math.min(hi, ceiling);
    for (let m = lo; m <= top; m += 1) if (pcs.includes(pcOf(m))) pool.push(m);
    return pool;
  };
  const repair = (note, lo, hi, ceiling, prevMidi) => {
    const chord = chordAt(chords, note.t + 0.01);
    const extras = bassPcsAt(note.t, note.dur || 0.2, bass, chord, style, key, sections);
    const pcs = soundingPcs(chord, extras);
    const long = (note.dur || 0) > 0.25;
    if (!clash(note.midi, pcs) || (!note.strong && !long)) return;
    const pool = safePool(chord, extras, lo, hi, ceiling, note.t);
    if (pool.length) {
      const signed = note.contour && prevMidi != null
        ? pool.filter((midi) => Math.sign(midi - prevMidi) === note.contour)
        : [];
      note.midi = closestMidi(note.midi, signed.length ? signed : pool);
    }
    else if (long) {
      note.dur = Math.round(0.24 * 1000) / 1000;
      note.strong = false;
    }
    const again = soundingPcs(chord, bassPcsAt(note.t, note.dur || 0.2, bass, chord, style, key, sections));
    if (clash(note.midi, again) && (note.strong || (note.dur || 0) > 0.25)) {
      flags.push(`${note.t.toFixed(3)} midi ${note.midi} ${note.role || "note"}`);
    }
  };
  for (let i = 0; i < lead.length; i += 1) {
    const note = lead[i];
    if (note.land) {
      const chord = chordAt(chords, note.t + 0.01);
      note.midi = landMidi(note, chord, keyAt(key, note.t), leadLo, leadHi);
    }
    const prev = i > 0 && lead[i - 1].role === note.role ? lead[i - 1].midi : null;
    repair(note, leadLo, leadHi, null, prev);
  }
  if (style === "synthwave") {
    foldLeaps(lead, leadLo, leadHi);
    restoreContour(lead, chords, bass, key, style, sections, leadLo, leadHi);
  }
  const guideCeiling = (note) => {
    const covers = lead.filter((item) => item.t < note.t + (note.dur || 0.2) - 0.02 && item.t + (item.dur || 0.2) > note.t + 0.02);
    const low = covers.length ? Math.min(...covers.map((item) => item.midi)) : 80;
    return Math.min(69, low - 3);
  };
  const guideHits = (note, midi, dur) => lead.filter((item) => {
    if (!(item.t < note.t + dur - 0.02 && item.t + (item.dur || 0.2) > note.t + 0.02)) return false;
    return pcOf(item.midi) === pcOf(midi) || midi > item.midi - 3;
  }).sort((a, b) => a.t - b.t);
  const guideTones = (note, ceiling, dur) => {
    const chord = chordAt(chords, note.t + 0.01);
    const tones = [];
    for (let m = 52; m <= ceiling; m += 1) {
      if (!(chord?.notes || []).some((tone) => pcOf(tone) === pcOf(m))) continue;
      if (guideHits(note, m, dur).length) continue;
      tones.push(m);
    }
    return tones;
  };
  for (let i = 0; i < counter.length; i += 1) {
    const note = counter[i];
    const prev = i > 0 ? counter[i - 1].midi : null;
    if (style === "synthwave") {
      let ceiling = guideCeiling(note);
      repair(note, 52, 69, ceiling, prev);
      let hits = guideHits(note, note.midi, note.dur || 0.2);
      if (hits.length) {
        const kept = hits[0].t - note.t - 0.03;
        const full = guideTones(note, ceiling, note.dur || 0.2);
        // A chopped guide under about a half note is just another blip. Hold a
        // different chord tone for the whole chord when one sits under the lead.
        if (full.length && kept < 1.1) {
          note.midi = closestMidi(prev ?? note.midi, full);
          repair(note, 52, 69, ceiling, prev);
          if (guideHits(note, note.midi, note.dur || 0.2).length) {
            const still = guideTones(note, ceiling, note.dur || 0.2);
            if (still.length) note.midi = closestMidi(prev ?? note.midi, still);
          }
        } else if (kept >= 0.9) {
          note.dur = Math.round(kept * 1000) / 1000;
          ceiling = guideCeiling(note);
          if (note.midi > ceiling) {
            const alts = guideTones(note, ceiling, note.dur || 0.2);
            if (alts.length) note.midi = closestMidi(prev ?? note.midi, alts);
          }
        } else if (full.length) {
          note.midi = closestMidi(prev ?? note.midi, full);
          repair(note, 52, 69, ceiling, prev);
        }
      }
      continue;
    }
    const other = lead.find((item) => note.t >= item.t - 0.03 && note.t < item.t + (item.dur || 0.2))
      || lead.find((item) => Math.abs(item.t - note.t) < 0.06);
    const ceiling = other ? Math.min(69, other.midi - 3) : 69;
    repair(note, 50, 69, ceiling, prev);
    if (other && (pcOf(note.midi) === pcOf(other.midi) || note.midi > other.midi - 3)) {
      note.midi = Math.max(50, Math.min(ceiling, other.midi - 3));
      repair(note, 50, 69, ceiling, prev);
    }
  }
  if (style === "synthwave" && counter.length) {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < counter.length; i += 1) {
        const note = counter[i];
        const prev = i > 0 ? counter[i - 1].midi : null;
        const next = i + 1 < counter.length ? counter[i + 1].midi : null;
        const ceiling = guideCeiling(note);
        const alts = guideTones(note, ceiling, note.dur || 0.2);
        if (!alts.length) continue;
        const cost = (midi) => {
          let score = 0;
          if (prev != null) {
            const dist = Math.abs(midi - prev);
            score += dist + (dist === 0 ? 3 : 0) + (dist > 2 ? (dist - 2) * 3 : 0);
          }
          if (next != null) {
            const dist = Math.abs(next - midi);
            score += dist * 0.5 + (dist > 2 ? (dist - 2) : 0);
          }
          if (i >= 2 && pcOf(midi) === pcOf(counter[i - 1].midi) && pcOf(midi) === pcOf(counter[i - 2].midi)) score += 20;
          return score;
        };
        let best = alts.includes(note.midi) ? note.midi : alts[0];
        let bestCost = cost(best);
        for (const midi of alts) {
          const value = cost(midi);
          if (value < bestCost) {
            bestCost = value;
            best = midi;
          }
        }
        note.midi = best;
      }
    }
    for (let i = 2; i < counter.length; i += 1) {
      const note = counter[i];
      if (pcOf(note.midi) !== pcOf(counter[i - 1].midi) || pcOf(note.midi) !== pcOf(counter[i - 2].midi)) continue;
      const ceiling = guideCeiling(note);
      const alts = guideTones(note, ceiling, note.dur || 0.2).filter((midi) => pcOf(midi) !== pcOf(note.midi));
      if (!alts.length) continue;
      note.midi = closestMidi(counter[i - 1].midi, alts);
    }
  }
  if (style !== "synthwave") breakParallels(lead, bass);
  for (let i = 1; i < lead.length; i += 1) {
    const note = lead[i];
    const prev = lead[i - 1];
    if (!note.contour || note.role !== prev.role || note.land) continue;
    if (!["motif", "sequence", "inversion", "fragment", "augmentation"].includes(note.role)) continue;
    if (Math.sign(note.midi - prev.midi) !== note.contour) note.role = "variation";
  }
  ensureSingable(lead, counter, chords, bass, key, style, sections);
  return flags;
}

export function glintTimes(plan, duration) {
  const beat = 60 / plan.bpm;
  const bar = plan.meter?.barLen || beat * 4;
  const gapBars = ((plan.seed || 0) & 1) ? 3 : 5;
  const times = [];
  for (let t = bar * 2; t < duration - 1.4; t += bar * gapBars) {
    const section = sectionAt(plan.sections, t);
    if (!section) continue;
    if (section.layers.includes("shimmer") || section.name === "A" || section.name === "A'") times.push(t);
  }
  return times;
}

export { mulberry32 as mixRng };

// Leaps wider than a major 6th (other than a clean octave) inside a phrase are
// hard to sing and sound like octave-folding accidents (mc-melody §3.1). Move
// the landing note, or the rest of the phrase, by an octave when that stays in
// the lead's own range and does not create a new wide leap. Pitch classes are
// unchanged, so the clash checks that run afterwards still apply.
export function smoothLeaps(lead, gapLimit = 0.6) {
  if (!lead || lead.length < 2) return 0;
  const lo = Math.min(...lead.map((note) => note.midi));
  const hi = Math.max(...lead.map((note) => note.midi));
  const wide = (d) => Math.abs(d) > 9 && Math.abs(d) !== 12;
  let fixed = 0;
  for (let i = 1; i < lead.length; i += 1) {
    const prev = lead[i - 1];
    const note = lead[i];
    if (note.t - (prev.t + prev.dur) > gapLimit) continue;
    const d = note.midi - prev.midi;
    if (!wide(d)) continue;
    const shift = -Math.sign(d) * 12;
    let end = i;
    while (end + 1 < lead.length && lead[end + 1].t - (lead[end].t + lead[end].dur) <= gapLimit) end += 1;
    const next = lead[i + 1];
    const nextOk = !next || next.t - (note.t + note.dur) > gapLimit || !wide(next.midi - (note.midi + shift));
    const moved = note.midi + shift;
    if (moved >= lo && moved <= hi && nextOk && Math.abs(moved - prev.midi) < Math.abs(d)) {
      note.midi = moved;
      fixed += 1;
      continue;
    }
    // Otherwise slide the rest of the phrase so its inner intervals survive.
    let fits = true;
    for (let k = i; k <= end; k += 1) {
      const m = lead[k].midi + shift;
      if (m < lo - 2 || m > hi + 2) { fits = false; break; }
    }
    if (fits) {
      for (let k = i; k <= end; k += 1) lead[k].midi += shift;
      fixed += 1;
    }
  }
  return fixed;
}
