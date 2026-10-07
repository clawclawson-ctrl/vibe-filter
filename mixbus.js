// Mix-bus helpers for the music renderer: per-stem EQ, chorus, width,
// saturation, send effects. Pure DSP on Float32Array pairs, deterministic,
// Node built-ins only.

const SR = 48000;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// RBJ cookbook biquad. Returns normalised [b0, b1, b2, a1, a2].
export function biquadCoefs(type, f, q = 0.7071, gainDb = 0) {
  const w = (2 * Math.PI * clamp(f, 10, SR * 0.45)) / SR;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b0; let b1; let b2; let a0; let a1; let a2;
  if (type === "hp") {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === "lp") {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === "peak") {
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else if (type === "lowshelf" || type === "highshelf") {
    const sq = 2 * Math.sqrt(A) * alpha;
    if (type === "lowshelf") {
      b0 = A * ((A + 1) - (A - 1) * cos + sq);
      b1 = 2 * A * ((A - 1) - (A + 1) * cos);
      b2 = A * ((A + 1) - (A - 1) * cos - sq);
      a0 = (A + 1) + (A - 1) * cos + sq;
      a1 = -2 * ((A - 1) + (A + 1) * cos);
      a2 = (A + 1) + (A - 1) * cos - sq;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cos + sq);
      b1 = -2 * A * ((A - 1) + (A + 1) * cos);
      b2 = A * ((A + 1) + (A - 1) * cos - sq);
      a0 = (A + 1) - (A - 1) * cos + sq;
      a1 = 2 * ((A - 1) - (A + 1) * cos);
      a2 = (A + 1) - (A - 1) * cos - sq;
    }
  } else {
    return [1, 0, 0, 0, 0];
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

export function filterMono(x, type, f, q = 0.7071, gainDb = 0) {
  const [b0, b1, b2, a1, a2] = biquadCoefs(type, f, q, gainDb);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i];
    let y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    // Flush denormals: decaying tails in silent stretches otherwise crawl.
    if (y < 1e-20 && y > -1e-20) y = 0;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

// Apply a chain like [["hp", 150], ["peak", 320, 1, -3]] to both channels.
export function eqPair(L, R, chain) {
  for (const [type, f, q = 0.7071, g = 0] of chain) {
    if (g === 0 && (type === "peak" || type === "lowshelf" || type === "highshelf")) continue;
    const [b0, b1, b2, a1, a2] = biquadCoefs(type, f, q, g);
    let lx1 = 0; let lx2 = 0; let ly1 = 0; let ly2 = 0;
    let rx1 = 0; let rx2 = 0; let ry1 = 0; let ry2 = 0;
    for (let i = 0; i < L.length; i += 1) {
      const vl = L[i];
      const vr = R[i];
      let yl = b0 * vl + b1 * lx1 + b2 * lx2 - a1 * ly1 - a2 * ly2;
      let yr = b0 * vr + b1 * rx1 + b2 * rx2 - a1 * ry1 - a2 * ry2;
      if (yl < 1e-20 && yl > -1e-20) yl = 0;
      if (yr < 1e-20 && yr > -1e-20) yr = 0;
      lx2 = lx1; lx1 = vl; ly2 = ly1; ly1 = yl;
      rx2 = rx1; rx1 = vr; ry2 = ry1; ry1 = yr;
      L[i] = yl;
      R[i] = yr;
    }
  }
}

export function isSilent(L, R) {
  for (let i = 0; i < L.length; i += 64) if (L[i] !== 0 || R[i] !== 0) return false;
  return true;
}

// Two slowly modulated delay taps in quadrature: movement and width for pads.
export function chorusPair(L, R, { rate = 0.23, base = 0.011, depth = 0.0032, mix = 0.42 } = {}) {
  const n = L.length;
  const size = Math.ceil((base * 1.21 + depth) * SR) + 4;
  const bufL = new Float32Array(size);
  const bufR = new Float32Array(size);
  let w = 0;
  const k = (2 * Math.PI * rate) / SR;
  const k2 = (2 * Math.PI * rate * 1.37) / SR;
  const dry = 1 - mix * 0.5;
  const delayL = (i) => (base + depth * (0.5 + 0.5 * Math.sin(k * i))) * SR;
  const delayR = (i) => (base * 1.21 + depth * (0.5 + 0.5 * Math.sin(k2 * i + 1.9))) * SR;
  // The LFO moves slowly, so evaluate it every 32 samples and interpolate.
  let dL0 = delayL(0);
  let dR0 = delayR(0);
  for (let blk = 0; blk < n; blk += 32) {
    const end = Math.min(n, blk + 32);
    const dL1 = delayL(blk + 32);
    const dR1 = delayR(blk + 32);
    const sL = (dL1 - dL0) / 32;
    const sR = (dR1 - dR0) / 32;
    let dL = dL0;
    let dR = dR0;
    for (let i = blk; i < end; i += 1) {
      bufL[w] = L[i];
      bufR[w] = R[i];
      let p = w - dL;
      if (p < 0) p += size;
      let i0 = p | 0;
      let f = p - i0;
      let i1 = i0 + 1 >= size ? 0 : i0 + 1;
      const wetL = bufR[i0] + (bufR[i1] - bufR[i0]) * f;
      p = w - dR;
      if (p < 0) p += size;
      i0 = p | 0;
      f = p - i0;
      i1 = i0 + 1 >= size ? 0 : i0 + 1;
      const wetR = bufL[i0] + (bufL[i1] - bufL[i0]) * f;
      L[i] = L[i] * dry + wetL * mix;
      R[i] = R[i] * dry + wetR * mix;
      w += 1;
      if (w >= size) w = 0;
      dL += sL;
      dR += sR;
    }
    dL0 = dL1;
    dR0 = dR1;
  }
}

// Mid/side width. amount 1 = unchanged; low end below ~150 Hz stays mono.
export function widenPair(L, R, amount) {
  if (amount === 1) return;
  const n = L.length;
  const c = 1 - Math.exp((-2 * Math.PI * 150) / SR);
  let low = 0;
  const extra = amount - 1;
  for (let i = 0; i < n; i += 1) {
    const mid = (L[i] + R[i]) * 0.5;
    const side = (L[i] - R[i]) * 0.5;
    low += c * (side - low);
    if (low < 1e-20 && low > -1e-20) low = 0;
    // Widen only the side content above ~150 Hz.
    const s = side + (side - low) * extra;
    L[i] = mid + s;
    R[i] = mid - s;
  }
}

// Level-matched tanh saturation blended with the dry signal (harmonics for
// sine basses, tape warmth for buses).
export function saturatePair(L, R, drive, mix) {
  if (!(mix > 0)) return;
  let peak = 1e-9;
  for (let i = 0; i < L.length; i += 1) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = drive / peak;
  const sat = (x) => (x > 3 ? 1 : x < -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x));
  const norm = peak / sat(drive);
  for (let i = 0; i < L.length; i += 1) {
    L[i] = L[i] * (1 - mix) + sat(L[i] * g) * norm * mix;
    R[i] = R[i] * (1 - mix) + sat(R[i] * g) * norm * mix;
  }
}

// Tempo delay: ping-pong, filtered feedback. Adds the wet into outL/outR.
export function pingPongSend(srcL, srcR, outL, outR, { time, feedback = 0.32, level = 0.2, hp = 450, lp = 4800 }) {
  const n = srcL.length;
  const d = Math.max(1, Math.round(time * SR));
  if (d >= n) return;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i += 1) mono[i] = (srcL[i] + srcR[i]) * 0.5;
  filterMono(mono, "hp", hp);
  filterMono(mono, "lp", lp);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  // L gets taps 1,3,5..., R gets 2,4,6...
  for (let i = d; i < n; i += 1) {
    left[i] = mono[i - d] + right[i - d] * feedback;
    right[i] = left[i - d] * feedback;
  }
  let lpL = 0;
  let lpR = 0;
  const c = 1 - Math.exp((-2 * Math.PI * lp * 0.8) / SR);
  for (let i = 0; i < n; i += 1) {
    lpL += c * (left[i] - lpL);
    lpR += c * (right[i] - lpR);
    outL[i] += lpL * level;
    outR[i] += lpR * level;
  }
}

// Schroeder allpass decorrelator: one mono wet becomes two different sides.
export function decorrelate(x, delays, g = 0.6) {
  let y = Float32Array.from(x);
  for (const d of delays) {
    const buf = new Float32Array(d);
    let idx = 0;
    const out = new Float32Array(y.length);
    for (let i = 0; i < y.length; i += 1) {
      const b = buf[idx];
      const v = y[i] + b * g;
      out[i] = b - v * g;
      buf[idx] = v;
      idx += 1;
      if (idx >= d) idx = 0;
    }
    y = out;
  }
  return y;
}

// Gentle bus glue: slow RMS compressor, ~2 dB of gain reduction on peaks.
export function gluePair(L, R, { thresholdDb = -18, ratio = 1.8, attack = 0.03, release = 0.25 } = {}) {
  const atk = Math.exp(-1 / (attack * SR));
  const rel = Math.exp(-1 / (release * SR));
  let env = 0;
  const thr = 10 ** (thresholdDb / 20);
  let g = 1;
  let gPrev = 1;
  const inv = 1 / ratio - 1;
  for (let i = 0; i < L.length; i += 1) {
    const x = (L[i] * L[i] + R[i] * R[i]) * 0.5;
    env = x > env ? atk * env + (1 - atk) * x : rel * env + (1 - rel) * x;
    if ((i & 31) === 0) {
      gPrev = g;
      const rms = Math.sqrt(env);
      g = rms > thr ? (rms / thr) ** inv : 1;
    }
    // Interpolate the 32-sample gain steps so they never zipper.
    const gi = gPrev + (g - gPrev) * ((i & 31) / 32);
    L[i] *= gi;
    R[i] *= gi;
  }
}

export function addInto(L, R, srcL, srcR, gain) {
  if (!gain) return;
  for (let i = 0; i < L.length; i += 1) {
    L[i] += srcL[i] * gain;
    R[i] += srcR[i] * gain;
  }
}
