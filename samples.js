// Optional instrument samples. If assets/ is missing, every play returns false
// and the synthesizer keeps going. Paths are relative to this file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const DIR = process.env.VIBE_FILTER_ASSETS
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");

const BANKS = {
  ep: { dir: "ep", loop: true },
  mute: { dir: "mute", loop: false },
  celesta: { dir: "celesta", loop: false },
  bass: { dir: "bass", loop: true },
  cym: { dir: "cym", loop: false },
  kick: { dir: "drums", files: ["kick.wav", "kick-1.wav"], loop: false },
  snare: { dir: "drums", files: ["snare.wav", "snare-1.wav"], loop: false },
  hat: { dir: "drums", file: "hat.wav", loop: false },
  open: { dir: "drums", file: "open.wav", loop: false },
  rim: { dir: "drums", file: "rim.wav", loop: false },
  shaker: { dir: "drums", file: "shaker.wav", loop: false },
};

let cache = null;

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  let offset = 12;
  let channels = 1;
  let rate = SR;
  let bits = 16;
  let format = 1;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = buf.readUInt16LE(offset + 8);
      channels = buf.readUInt16LE(offset + 10);
      rate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataStart = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (dataStart < 0 || format !== 1 || bits !== 16) return null;
  const frames = Math.floor(dataSize / (2 * channels));
  const raw = new Float32Array(frames);
  let peak = 1e-8;
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += buf.readInt16LE(dataStart + (i * channels + c) * 2) / 32768;
    }
    raw[i] = sum / channels;
    peak = Math.max(peak, Math.abs(raw[i]));
  }
  const gain = 0.85 / peak;
  let pcm = raw;
  if (rate !== SR && frames > 2) {
    const outN = Math.max(2, Math.round(frames * SR / rate));
    pcm = new Float32Array(outN);
    const step = rate / SR;
    for (let i = 0; i < outN; i += 1) {
      const x = i * step;
      const i0 = Math.min(frames - 1, Math.floor(x));
      const i1 = Math.min(frames - 1, i0 + 1);
      const f = x - i0;
      pcm[i] = (raw[i0] * (1 - f) + raw[i1] * f) * gain;
    }
  } else {
    for (let i = 0; i < pcm.length; i += 1) pcm[i] *= gain;
  }
  return pcm;
}

function loadBank(spec) {
  const folder = path.join(DIR, spec.dir);
  if (!fs.existsSync(folder)) return [];
  const listed = spec.files || (spec.file ? [spec.file] : null);
  if (listed) {
    const notes = [];
    for (const name of listed) {
      const file = path.join(folder, name);
      if (!fs.existsSync(file)) continue;
      const pcm = readWav(file);
      if (pcm && pcm.length > 32) notes.push({ midi: 60, pcm, loop: spec.loop });
    }
    return notes;
  }
  const notes = [];
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith(".wav")) continue;
    const midi = Number(name.replace(/\.wav$/, ""));
    if (!Number.isFinite(midi)) continue;
    const pcm = readWav(path.join(folder, name));
    if (pcm && pcm.length > 32) notes.push({ midi, pcm, loop: spec.loop });
  }
  notes.sort((a, b) => a.midi - b.midi);
  return notes;
}

export function primeSamples() {
  if (cache) return cache;
  cache = {};
  if (!fs.existsSync(DIR)) return cache;
  for (const [name, spec] of Object.entries(BANKS)) {
    try {
      cache[name] = loadBank(spec);
    } catch {
      cache[name] = [];
    }
  }
  return cache;
}

export function bankReady(name) {
  const banks = primeSamples();
  return Boolean(banks[name] && banks[name].length);
}

function nearest(notes, midi) {
  let best = notes[0];
  let dist = 99;
  for (const note of notes) {
    const d = Math.abs(note.midi - midi);
    if (d < dist) {
      dist = d;
      best = note;
    }
  }
  return best;
}

// Returns false when that bank is not on disk.
export function playNote(L, R, bankName, spec) {
  const notes = primeSamples()[bankName];
  if (!notes || !notes.length) return false;
  const src = Number.isInteger(spec.robin) && notes.length > 1
    ? notes[Math.abs(spec.robin) % notes.length]
    : nearest(notes, spec.midi);
  const pcm = src.pcm;
  const n = L.length;
  const t0 = spec.t0 || 0;
  const t1 = spec.t1 != null ? spec.t1 : t0 + (spec.dur || 0.4);
  const i0 = Math.max(0, Math.min(n, Math.floor(t0 * SR)));
  const relStart = Math.max(i0, Math.min(n, Math.floor(t1 * SR)));
  const relLen = Math.max(1, Math.round((spec.release ?? 0.08) * SR));
  const i1 = Math.min(n, relStart + relLen);
  const attack = spec.attack ?? 0.012;
  const aN = Math.max(1, Math.round((attack < 0.006 ? attack : Math.max(0.006, attack)) * SR));
  const ratio = 2 ** ((spec.midi - src.midi) / 12);
  const loop = src.loop && pcm.length > 800;
  const loopStart = Math.floor(pcm.length * 0.38);
  const loopEnd = Math.max(loopStart + 200, Math.floor(pcm.length * 0.78));
  const span = loopEnd - loopStart;
  let pos = 0;
  let vib = (spec.midi % 7) * 0.4;
  const vibAmt = spec.vibrato || 0;
  const vibStep = ((spec.vibratoRate || 5) / SR) * Math.PI * 2;
  let trem = (spec.midi % 5) * 0.5;
  const tremAmt = spec.trem || 0;
  const tremStep = ((spec.tremRate || 3.2) / SR) * Math.PI * 2;
  const panL = spec.panL ?? 0.707;
  const panR = spec.panR ?? 0.707;
  const gain = spec.gain ?? 0.2;
  const lpOn = spec.lowpass > 0;
  const lpC = lpOn ? 1 - Math.exp((-2 * Math.PI * spec.lowpass) / SR) : 0;
  let lp = 0;
  for (let i = i0; i < i1; i += 1) {
    let env = 1;
    if (i < i0 + aN) env = Math.sin(((i - i0) / aN) * Math.PI * 0.5);
    else if (i >= relStart) env = Math.cos(Math.min(1, (i - relStart) / relLen) * Math.PI * 0.5);
    let idx = pos;
    if (loop && idx >= loopStart) {
      idx = loopStart + ((idx - loopStart) % span);
    }
    const iA = idx | 0;
    if (iA >= pcm.length - 2) break;
    const frac = idx - iA;
    const raw = pcm[iA] * (1 - frac) + pcm[iA + 1] * frac;
    const sample = lpOn ? (lp += lpC * (raw - lp)) : raw;
    vib += vibStep;
    trem += tremStep;
    const tremG = 1 - tremAmt + tremAmt * (0.5 + 0.5 * Math.sin(trem));
    const s = sample * env * tremG * gain;
    L[i] += s * panL;
    R[i] += s * panR;
    pos += ratio * (1 + vibAmt * Math.sin(vib));
  }
  return true;
}

const irCache = new Map();

export function loadIr(name) {
  if (irCache.has(name)) return irCache.get(name);
  const file = path.join(DIR, "ir", `${name}.wav`);
  let pcm = null;
  try {
    if (fs.existsSync(file)) pcm = readWav(file);
  } catch {
    pcm = null;
  }
  irCache.set(name, pcm);
  return pcm;
}

export function assetDir() {
  return DIR;
}
