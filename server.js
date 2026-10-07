import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyzeClip, renderMusic, fitLyrics } from "./music.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const HOST = "127.0.0.1";
// VIBE_FILTER_PORT picks the port; the old TOON_CLIP_PORT name still works.
const PORT = Number(process.env.VIBE_FILTER_PORT || process.env.TOON_CLIP_PORT) || 4747;
const WORK = path.join(os.tmpdir(), "vibe-filter");
const EXPORT_DIR = path.join(os.homedir(), "Movies", "Vibe Filter");

const FFMPEG = findBin("ffmpeg");
const FFPROBE = findBin("ffprobe");

const jobs = new Map();
let activeJobId = null;

fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.join(WORK, "uploads"), { recursive: true });
cleanStaleWork();

// Previews and palette images left in the work folder by an earlier run (named by job id) are never served again.
function cleanStaleWork() {
  const stale = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-palette-\d+\.ppm|-music\.wav|\.mp4)$/;
  let names = [];
  try { names = fs.readdirSync(WORK); } catch { return; }
  for (const name of names) {
    if (stale.test(name)) {
      try { fs.rmSync(path.join(WORK, name), { force: true }); } catch { /* already gone */ }
    }
  }
}

function findBin(name) {
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request body is too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Expected JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const isJson = typeof body !== "string";
  res.writeHead(status, {
    "content-type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function existingFile(input) {
  if (typeof input !== "string" || !path.isAbsolute(input) || input.includes("\0")) {
    throw Object.assign(new Error("Use a full file path"), { status: 400 });
  }
  const resolved = path.resolve(input);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw Object.assign(new Error("That file is not there"), { status: 404 });
  }
  if (!stat.isFile()) throw Object.assign(new Error("That path is not a file"), { status: 400 });
  return resolved;
}

// Display rotation in degrees (phone clips), so generated textures can be sized to the turned frame.
function videoRotation(video) {
  const side = (video.side_data_list || []).find((d) => d.rotation != null);
  const value = Number(side ? side.rotation : video.tags?.rotate || 0);
  return Number.isFinite(value) ? value : 0;
}

function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE,
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(Object.assign(new Error(stderr.trim() || "Could not read that video"), { status: 400 }));
          return;
        }
        const data = JSON.parse(stdout);
        const video = (data.streams || []).find((s) => s.codec_type === "video");
        const audio = (data.streams || []).find((s) => s.codec_type === "audio");
        if (!video) {
          reject(Object.assign(new Error("No video track in that file"), { status: 400 }));
          return;
        }
        const rate = video.avg_frame_rate || video.r_frame_rate || "0/1";
        const [num, den] = rate.split("/").map(Number);
        const fps = den ? num / den : 0;
        resolve({
          path: file,
          duration: Number(data.format?.duration || video.duration || 0),
          size: Number(data.format?.size || 0),
          width: video.width,
          height: video.height,
          fps: Math.round(fps * 1000) / 1000,
          videoCodec: video.codec_name,
          audioCodec: audio ? audio.codec_name : null,
          audioRate: audio ? Number(audio.sample_rate) : null,
          audioChannels: audio ? Number(audio.channels) : null,
          rotation: videoRotation(video),
        });
      },
    );
  });
}

// Fixed Classic palettes. Only these ids are accepted; the colors never come from the request.
const PALETTES = {
  vintage: [[240, 226, 190], [214, 166, 52], [170, 64, 48], [46, 122, 120], [84, 52, 34], [30, 26, 22]],
  gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
  noir: [[0, 0, 0], [70, 70, 70], [135, 135, 135], [200, 200, 200], [255, 255, 255]],
  popart: [[230, 30, 40], [255, 220, 0], [20, 70, 200], [0, 0, 0], [255, 255, 255]],
  pastel: [[248, 200, 214], [190, 236, 212], [210, 196, 240], [186, 218, 245], [252, 238, 170], [255, 248, 230]],
  sunset: [[60, 22, 88], [200, 40, 130], [245, 120, 40], [250, 190, 60], [20, 24, 56]],
};
const PALETTE_IDS = ["original", ...Object.keys(PALETTES)];
// Pixel Art "Retro 16" colors (the Sweetie 16 palette: an 8-bit look that still has good greens and blues).
const PIXEL_PALETTE = [
  [26, 28, 44], [93, 39, 93], [177, 62, 83], [239, 125, 87], [255, 205, 117], [167, 240, 112], [56, 183, 100], [37, 113, 121],
  [41, 54, 111], [59, 93, 201], [65, 166, 246], [115, 239, 247], [244, 244, 244], [148, 176, 194], [86, 108, 134], [51, 60, 87],
];

function palettesFrom(input) {
  const asked = new Set(Array.isArray(input) ? input : []);
  const picked = PALETTE_IDS.filter((id) => asked.has(id));
  return picked.length ? picked : ["original"];
}

// Numbers only. The filter string is built from these, never from raw text.
function settingsFrom(input = {}) {
  const widths = new Set([0, 640, 960, 1280, 1920]);
  const width = Number(input.width);
  const styles = new Set(["classic", "fractal", "neon", "vhs", "pixel", "oil"]);
  return {
    style: styles.has(input.style) ? input.style : "classic",
    fps: clamp(Math.round(Number(input.fps) || 12), 8, 24),
    width: widths.has(width) ? width : 960,
    simplify: clamp(Number(input.simplify ?? 50), 0, 100),
    outline: clamp(Math.round(Number(input.outline ?? 2)), 0, 4),
    saturation: clamp(Number(input.saturation ?? 1.5), 0.6, 2),
    palettes: palettesFrom(input.palettes),
    paletteMode: input.paletteMode === "mix" ? "mix" : "combine",
    fractal: fractalEffectsFrom(input.fractal),
    neon: {
      color: pick(input.neon?.color, ["rainbow", "pinkcyan", "single"], "rainbow"),
      glow: pick(input.neon?.glow, ["low", "medium", "high"], "medium"),
      bg: pick(input.neon?.bg, ["dark", "medium", "bright"], "medium"),
    },
    vhs: vhsEffectsFrom(input.vhs),
    pixel: {
      size: pick(input.pixel?.size, ["small", "medium", "large"], "medium"),
      colors: pick(input.pixel?.colors, ["rich", "retro16"], "rich"),
    },
    oil: { strength: pick(input.oil?.strength, ["light", "medium", "strong"], "medium") },
    music: musicFrom(input.music),
  };
}

// Off (the default) leaves the soundtrack alone. "on" is the older shape for Ambient.
function musicFrom(input) {
  const raw = input && typeof input === "object" ? input : {};
  let style = raw.style;
  if ((style == null || style === "") && raw.mode != null) {
    if (raw.mode === "on") style = "ambient";
    else if (raw.mode === "off") style = "off";
    else style = raw.mode;
  }
  return {
    style: pick(style, ["off", "ambient", "lofi", "arp", "synthwave"], "off"),
    mix: pick(raw.mix, ["replace", "blend"], "replace"),
    lyrics: cleanLyrics(raw.lyrics),
    lyricsOn: raw.lyricsOn === true,
    oohaah: raw.oohaah === true,
  };
}

function cleanLyrics(text) {
  if (typeof text !== "string" || !text) return "";
  let out = "";
  for (let i = 0; i < text.length && out.length < 4000; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || c >= 32) out += text[i];
  }
  return out;
}

// One id from a fixed list, or the default.
function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// VHS extras. Unlike Fractal, all of them may be off (the washed tape colors and bleed always stay).
const VHS_EFFECTS = ["scanlines", "wobble", "grain"];

function vhsEffectsFrom(input) {
  if (!Array.isArray(input)) return [...VHS_EFFECTS];
  const asked = new Set(input);
  return VHS_EFFECTS.filter((id) => asked.has(id));
}

// Fractal effects, in the fixed order they are stacked. Only these ids are accepted.
const FRACTAL_EFFECTS = ["fill", "echo", "tendrils", "glow"];

function fractalEffectsFrom(input) {
  const asked = new Set(Array.isArray(input) ? input : []);
  const picked = FRACTAL_EFFECTS.filter((id) => asked.has(id));
  return picked.length ? picked : ["glow"];
}

// Which fixed color lists the Classic filter needs as extra ffmpeg inputs (input 1, 2, ...).
// An empty list means the plain Original look, built exactly as before.
function palettePlan(settings) {
  if (settings.style === "pixel") return settings.pixel.colors === "retro16" ? [PIXEL_PALETTE] : [];
  if (settings.style !== "classic") return [];
  const chosen = settings.palettes.filter((id) => id !== "original");
  if (!chosen.length) return [];
  if (chosen.length === 1 || settings.paletteMode === "combine") {
    return [chosen.flatMap((id) => PALETTES[id])];
  }
  return chosen.map((id) => PALETTES[id]);
}

// paletteuse wants a 16x16 palette image. Write it as a binary PPM, padding with the first color.
function writePaletteImage(file, colors) {
  const header = Buffer.from("P6\n16 16\n255\n", "ascii");
  const body = Buffer.alloc(16 * 16 * 3);
  for (let i = 0; i < 256; i += 1) {
    const [r, g, b] = colors[i < colors.length ? i : 0];
    body[i * 3] = r;
    body[i * 3 + 1] = g;
    body[i * 3 + 2] = b;
  }
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

function scaleFilter(width) {
  return width > 0
    ? `scale=${width}:-2:flags=bilinear`
    : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
}

// Returns the ffmpeg lavfi texture inputs the filter needs (numbered from firstInput) and the filter itself.
function buildFilter(settings, meta, firstInput) {
  if (settings.style === "fractal") return buildFractal(settings, meta, firstInput);
  if (settings.style === "neon") return buildNeon(settings, meta, firstInput);
  if (settings.style === "vhs") return { inputs: [], filter: buildVhs(settings, meta) };
  if (settings.style === "pixel") return { inputs: [], filter: buildPixel(settings, meta) };
  if (settings.style === "oil") return { inputs: [], filter: buildOil(settings) };
  return { inputs: [], filter: buildClassic(settings) };
}

// Flat cel fills with an even ink line around each color shape, like a 1950s short.
function buildClassic(settings) {
  const simplify = settings.simplify / 100;
  const sigmaS = (5 + simplify * 10).toFixed(2);
  const sigmaR = (0.22 + simplify * 0.32).toFixed(3);
  const step = Math.round(32 + simplify * 40);
  const saturation = settings.saturation.toFixed(2);
  const scale = scaleFilter(settings.width);
  const paint =
    `bilateral=sigmaS=${sigmaS}:sigmaR=${sigmaR}:planes=7,` +
    `eq=saturation=${saturation}:contrast=1.14:brightness=0.04,` +
    `format=rgb24,lutrgb=r='round(val/${step})*${step}':g='round(val/${step})*${step}':b='round(val/${step})*${step}'`;
  const head = `[0:v]${scale},fps=${settings.fps},hqdn3d=1.5:1:3:2,format=yuv420p`;
  const recolor = paletteChain(settings);

  if (settings.outline <= 0) {
    if (recolor) return `${head},${paint}[pc];${recolor("[pc]", "[pal]")}[pal]setsar=1[out]`;
    return `${head},${paint},setsar=1[out]`;
  }

  const rings = [0, 1, 2, 2, 3][settings.outline];
  const gate = [0, 16, 26, 22, 32][settings.outline];
  const dilate = Array.from({ length: rings }, () => "dilation").join(",");
  const erode = Array.from({ length: rings }, () => "erosion").join(",");

  // With a palette, the ink is still traced from the posterized frame, then multiplied over the recolored one.
  const fill = recolor ? `[pc][d][e];${recolor("[pc]", "[c]")}` : "[c][d][e];";
  return (
    `${head},${paint},split=3${fill}` +
    `[d]${dilate}[di];` +
    `[e]${erode}[er];` +
    `[di][er]blend=all_mode=difference,gblur=sigma=0.65,format=gray,` +
    `lut=c0='if(gt(val,${gate}),0,255)',format=rgb24[ink];` +
    `[c][ink]blend=all_mode=multiply,format=rgb24,setsar=1[out]`
  );
}

// Returns (inLabel, outLabel) => filter text that recolors the posterized frame, or null for Original only.
// Palette images are ffmpeg inputs 1..n, in the order palettePlan() lists them.
function paletteChain(settings) {
  const plan = palettePlan(settings);
  if (!plan.length) return null;
  const withOriginal = settings.palettes.includes("original");
  // Nearest color in a fixed palette image, no dithering.
  const snap = (src, input) => `${src}[${input}:v]paletteuse=dither=none:diff_mode=none`;

  if (settings.paletteMode === "mix" && settings.palettes.length > 1) {
    // Mix: one render per selected palette (Original is the posterized frame itself), averaged evenly.
    return (inLabel, outLabel) => {
      const n = settings.palettes.length;
      let text = `${inLabel}split=${n}${settings.palettes.map((_, i) => `[mx${i}]`).join("")};`;
      let input = 1;
      settings.palettes.forEach((id, i) => {
        if (id === "original") {
          text += `[mx${i}]format=gbrp[mr${i}];`;
        } else {
          text += `${snap(`[mx${i}]`, input)},format=gbrp[mr${i}];`;
          input += 1;
        }
      });
      text += `${settings.palettes.map((_, i) => `[mr${i}]`).join("")}mix=inputs=${n},format=rgb24${outLabel};`;
      return text;
    };
  }

  if (!withOriginal) {
    // A single palette, or Combine: every pixel takes the nearest color in the pooled palette.
    return (inLabel, outLabel) => `${snap(inLabel, 1)},format=rgb24${outLabel};`;
  }

  // Combine with Original: snap to the pool, but a pixel keeps its own posterized color
  // unless a pooled color is within NEAR levels of it on every channel.
  const NEAR = 60;
  return (inLabel, outLabel) =>
    `${inLabel}format=gbrp,split=3[co][cp][cd];` +
    `${snap("[cp]", 1)},format=gbrp,split=2[cq][cr];` +
    `[cd][cr]blend=all_mode=difference,extractplanes=r+g+b[dr][dg][db];` +
    `[dr][dg]blend=all_mode=lighten[drg];[drg][db]blend=all_mode=lighten,` +
    `lut=c0='if(lte(val,${NEAR}),255,0)',format=gbrp[cm];` +
    `[co][cq][cm]maskedmerge,format=rgb24${outLabel};`;
}

// Size of the output frame (a little generous), so generated textures always cover it.
function fractalCover(settings, meta) {
  let w = Math.max(2, Math.round(Number(meta.width) || 1920));
  let h = Math.max(2, Math.round(Number(meta.height) || 1080));
  if (Math.abs(Number(meta.rotation) || 0) % 180 === 90) [w, h] = [h, w];
  const outW = settings.width > 0 ? settings.width : w;
  const outH = Math.ceil((outW * h) / w);
  return { w: outW + 4, h: outH + 4 };
}

// Returns the generated texture sources (ffmpeg lavfi inputs, numbered from firstInput) and the filter.
function buildFractal(settings, meta = {}, firstInput = 1) {
  const inputs = [];
  const on = (id) => settings.fractal.includes(id);
  const k = 0.35 + (settings.simplify / 100) * 0.65; // effect strength
  const gate = [60, 46, 34, 24, 16][settings.outline];
  // With several effects stacked, the two light layers back off a little so the picture stays readable.
  const crowd = 1 / (1 + 0.12 * (settings.fractal.length - 1));
  const fps = settings.fps;
  const cover = fractalCover(settings, meta);
  const hw = Math.ceil(cover.w / 2) + 1;
  const hh = Math.ceil(cover.h / 2) + 1;
  const f = (n) => n.toFixed(3);
  const out = [];
  const fanout = (names) => (names.length === 1 ? `null[${names[0]}]` : `split=${names.length}${names.map((n) => `[${n}]`).join("")}`);

  const baseTaps = ["comp"];
  const fineTaps = [];
  const bigTaps = [];
  const noiseTaps = [];
  if (on("fill")) fineTaps.push("fill");
  if (on("echo")) { baseTaps.push("echo"); fineTaps.push("echo"); }
  if (on("tendrils")) { baseTaps.push("tend"); bigTaps.push("tend"); noiseTaps.push("tend"); }
  if (on("glow")) { baseTaps.push("glow"); bigTaps.push("glow"); noiseTaps.push("glow"); }

  // The frame, then seeds found in it: fine edges (every detail) and major edges (main outlines), both half size.
  // Color slider: 1.50 (the default) leaves the source colors alone.
  const sat = settings.saturation / 1.5;
  const color = Math.abs(sat - 1) < 0.005 ? "" : `eq=saturation=${sat.toFixed(3)},`;
  out.push(`[0:v]${scaleFilter(settings.width)},fps=${fps},${color}format=gbrp,split=2[base][det];`);
  out.push(`[base]${fanout(baseTaps.map((n) => `b_${n}`))};`);
  const detTaps = ["cv"];
  if (fineTaps.length) detTaps.push("fine");
  if (bigTaps.length) detTaps.push("big");
  out.push(`[det]scale=iw/2:ih/2:flags=area,format=gray,${fanout(detTaps.map((n) => `d_${n}`))};`);
  // Sobel edge strength, gated so only real contrast counts. Outline slider = how faint a detail may be and still seed.
  if (fineTaps.length) out.push(`[d_fine]sobel,lut=c0='clip((val-${gate})*4,0,255)',${fanout(fineTaps.map((n) => `f_${n}`))};`);
  if (bigTaps.length) out.push(`[d_big]gblur=sigma=2,sobel,lut=c0='if(gt(val,${Math.round(gate * 0.85)}),255,0)',${fanout(bigTaps.map((n) => `g_${n}`))};`);

  // Half-size gray canvas used to crop generated textures to the frame.
  const cvTaps = [];
  if (noiseTaps.length) cvTaps.push("noise");
  if (on("fill")) cvTaps.push("fill");
  if (cvTaps.length) out.push(`[d_cv]${fanout(cvTaps.map((n) => `cv_${n}`))};`);
  else out.push(`[d_cv]nullsink;`);

  if (noiseTaps.length) {
    // Animated fractal noise (Perlin fBm) at quarter size: a 2 s stretch rendered once, then played
    // forward and backward on a loop so it keeps moving without a seam.
    const nw = Math.ceil(hw / 2), nh = Math.ceil(hh / 2);
    const sc = nw / 70;
    const n = Math.max(24, fps * 2);
    inputs.push(
      `perlin=s=${nw}x${nh}:r=${fps}:octaves=5:persistence=0.6:xscale=${f(sc)}:yscale=${f((sc * nh) / nw)}:tscale=0.08:random_mode=seed:seed=4747,format=gray,trim=end_frame=${n},split=2[a][b];` +
      `[b]reverse[r];[a][r]concat=n=2:v=1:a=0,loop=loop=-1:size=${n * 2}:start=0,setpts=N/(${fps}*TB),scale=iw*2:ih*2:flags=bicubic`,
    );
    out.push(`[${firstInput + inputs.length - 1}:v]null[nzbig];`);
    out.push(`[cv_noise][nzbig]overlay=format=yuv444:shortest=1,format=gray,${fanout(noiseTaps.map((n) => `n_${n}`))};`);
  }

  let comp = "[b_comp]";
  let step = 0;
  const next = () => `[c${++step}]`;

  // 1. Fill: a Mandelbrot zoom (seahorse-valley spirals) laid into the busy parts of the frame.
  if (on("fill")) {
    out.push(`[f_fill]gblur=sigma=8,lut=c0='clip((val-16)*${f(2 + k * 2.5)},0,255)',gblur=sigma=4,scale=iw*2:ih*2:flags=bilinear[fmask];`);
    inputs.push(`mandelbrot=s=${hw}x${hh}:r=${fps}:maxiter=400:start_scale=0.006:end_scale=0.000024:end_pts=${fps * 90}:inner=convergence,format=gbrp,gblur=sigma=0.8`);
    out.push(`[${firstInput + inputs.length - 1}:v]null[mand];`);
    out.push(`[cv_fill]format=gbrp[cvf];[cvf][mand]overlay=format=gbrp:shortest=1,scale=iw*2:ih*2:flags=bicubic,split=2[mcol][mlum];`);
    // Swirl bands: the fractal's shading folded into stripes that follow its spirals.
    out.push(`[mlum]format=gray,lut=c0='128+90*sin(val*0.11)',split=3[mband][mx][my0];`);
    out.push(`[mx]lut=c0='128+(val-128)*${f(0.02 + k * 0.03)}'[mdx];[my0]lut=c0='128+(val-128)*${f(0.02 + k * 0.03)}'[mdy];`);
    out.push(`${comp}split=2[fa][fb];[fb][mdx][mdy]displace=edge=smear[fdisp];`);
    out.push(`[mband]format=gbrp[mbrgb];[fdisp][mbrgb]blend=all_mode=overlay:all_opacity=${f(0.3 + k * 0.4)}[fb2];`);
    out.push(`[fb2][mcol]blend=all_mode=softlight:all_opacity=${f(0.35 + k * 0.4)}[fpat];`);
    const c = next();
    out.push(`[fa][fpat][fmask]maskedmerge${c};`);
    comp = c;
  }

  // 2. Echo: the detailed parts of the frame repeated smaller and smaller toward the center.
  if (on("echo")) {
    // Faded to nothing toward the frame border, so each smaller copy has soft edges.
    const band = Math.max(4, Math.round(Math.min(hw, hh) / 7));
    out.push(`[f_echo]dilation,gblur=sigma=5,lut=c0='clip(val*9,0,255)',drawbox=x=0:y=0:w=iw:h=ih:t=${band}:color=black@1:replace=1,gblur=sigma=${f(band * 0.7)},lut=c0='clip((val-24)*1.15,0,255)'[emask];`);
    out.push(`[b_echo]scale=iw/2:ih/2:flags=area,format=gbrap[ebase];[ebase][emask]alphamerge,split=2[d0][d1];`);
    const shrink = (i) =>
      `scale=trunc(iw*0.62):trunc(ih*0.62):flags=bilinear,${i % 2 ? "hflip," : ""}` +
      `rotate=a='${i % 2 ? "-" : ""}(0.10+0.06*sin(t*0.7))':c=none,` +
      `colorchannelmixer=rr=0.8:rb=0.2:gg=0.8:gr=0.2:bb=0.8:bg=0.2:aa=0.97,eq=contrast=1.25:saturation=1.3`;
    out.push(`[d1]${shrink(1)}[s1];[d0][s1]overlay=x='(W-w)/2':y='(H-h)/2':format=auto[l1];`);
    out.push(`[l1]format=gbrap,split=2[l1a][l1b];[l1b]${shrink(2)}[s2];[l1a][s2]overlay=x='(W-w)/2':y='(H-h)/2':format=auto[l2];`);
    out.push(`[l2]format=gbrap,${shrink(3)},colorchannelmixer=aa=${f((0.55 + k * 0.35) * crowd)},scale=iw*2:ih*2:flags=bicubic[echo];`);
    const c = next();
    out.push(`${comp}[echo]overlay=x='(W-w)/2':y='(H-h)/2':format=gbrp${c};`);
    comp = c;
  }

  // 3. Tendrils: thin crackling branches where a fractal noise field crosses zero near the main outlines.
  if (on("tendrils")) {
    // Main branches: the zero line of the noise; twigs: a second, off-center line that only shows close to edges.
    out.push(`[g_tend]gblur=sigma=12,lut=c0='clip(val*5,0,255)',split=2[tp1][tp2];`);
    out.push(`[n_tend]split=2[tn1][tn2];`);
    out.push(`[tn1]lut=c0='if(gt(val,128),255,0)',split=2[ta][tb];[ta]dilation[tad];[tb]erosion[tbe];[tad][tbe]blend=all_mode=difference[tline1];`);
    out.push(`[tn2]lut=c0='if(gt(val,150),255,0)',split=2[tc][td];[tc]dilation[tcd];[td]erosion[tde];[tcd][tde]blend=all_mode=difference[tline2];`);
    out.push(`[tline1][tp1]blend=all_mode=multiply[tm1];[tp2]lut=c0='clip((val-150)*2.4,0,255)'[tp2b];[tline2][tp2b]blend=all_mode=multiply[tm2];`);
    out.push(`[tm1][tm2]blend=all_mode=lighten,split=2[tl0][tl1];`);
    out.push(`[tl1]gblur=sigma=2.5,lut=c0='clip(val*1.2,0,255)'[th];[tl0][th]blend=all_mode=lighten,format=gbrp[tmask];`);
    // Colored like the frame underneath, pushed toward a pale electric white.
    out.push(`[b_tend]scale=iw/2:ih/2:flags=area,lutrgb=r='min(255,val*0.35+165)':g='min(255,val*0.35+175)':b='min(255,val*0.3+200)'[tint];[tint][tmask]blend=all_mode=multiply,scale=iw*2:ih*2:flags=bicubic[tcol];`);
    const c = next();
    out.push(`${comp}[tcol]blend=all_mode=screen:all_opacity=${f((0.75 + k * 0.25) * crowd)}${c};`);
    comp = c;
  }

  // 4. Glow: a shimmering fractal-noise aura hugging the main outlines, in the frame's own colors.
  if (on("glow")) {
    out.push(`[g_glow]split=2[ga][gb];[ga]gblur=sigma=1.5[ga2];[gb]gblur=sigma=5[gb2];[ga2][gb2]lut2=c0='clip(x*1.3+y*1.2,0,255)'[aura];`);
    // Ridged noise: bright veins where the fBm is near its middle value, so the aura has a fractal texture.
    out.push(`[n_glow]lut=c0='clip(255-abs(val-128)*6,0,255)'[gveins];`);
    out.push(`[aura][gveins]lut2=c0='clip(x*(0.05+y/255*1.25),0,255)',format=gbrp[gmask];`);
    out.push(`[b_glow]scale=iw/2:ih/2:flags=area,gblur=sigma=1,eq=saturation=2.2:brightness=0.06,format=gbrp,lutrgb=r='min(255,val*1.5)':g='min(255,val*1.5)':b='min(255,val*1.5+10)'[gtint];[gtint][gmask]blend=all_mode=multiply,scale=iw*2:ih*2:flags=bicubic[gcol];`);
    const c = next();
    out.push(`${comp}[gcol]blend=all_mode=screen:all_opacity=${f((0.45 + k * 0.45) * crowd)}${c};`);
    comp = c;
  }

  out.push(`${comp}format=rgb24,setsar=1[out]`);
  return { inputs, filter: out.join("") };
}

// Width of the output frame in pixels, so sizes that must be whole pixels can follow it.
function frameWidth(settings, meta) {
  return fractalCover(settings, meta).w - 4;
}

// Color slider for the newer styles: 1.50 (the default) leaves the source colors alone.
function colorScale(settings) {
  return settings.saturation / 1.5;
}

// Neon Edges: the outlines of the frame drawn as glowing neon tubes, with finer detail lines glowing
// more softly, over a darkened, moody, tinted version of the picture.
function buildNeon(settings, meta = {}, firstInput = 1) {
  const inputs = [];
  const fps = settings.fps;
  const cover = fractalCover(settings, meta);
  const f = (n) => n.toFixed(3);
  // [tight blur, wide blur, tight gain, wide gain]
  const [s1, s2, g1, g2] = { low: [2, 7, 1.6, 1.2], medium: [3, 11, 2.2, 1.9], high: [4, 16, 2.8, 2.8] }[settings.neon.glow];
  // Background: brightness of the picture behind the tubes, how much of its color stays, and bloom strength
  // (lower over a brighter picture, which already adds light).
  const [bright, keep, BLOOM] = { dark: [0.16, 0.5, 0.95], medium: [0.42, 0.65, 0.75], bright: [0.68, 0.72, 0.6] }[settings.neon.bg];
  // Tint of the background, toward the neon colors.
  const tint = { rainbow: [0.9, 0.85, 1.12], pinkcyan: [1.05, 0.8, 1.12], single: [0.75, 0.97, 1.1] }[settings.neon.color];
  const lum = [0.299, 0.587, 0.114];
  const FINE = 0.55; // detail line brightness (the outlines are 2)
  const HALO = 90; // darkening right around the tubes (0-255)
  const mixer = ["r", "g", "b"].map((out, i) =>
    ["r", "g", "b"].map((src, j) => `${out}${src}=${f(bright * tint[i] * ((1 - keep) * lum[j] + (i === j ? keep : 0)))}`).join(":"),
  ).join(":");
  const W = cover.w - 4; // output size (even), so masks made at half size come back exactly
  const H = cover.h - 4;
  const gain = (g) => `lutrgb=r='min(255,val*${f(g)})':g='min(255,val*${f(g)})':b='min(255,val*${f(g)})'`;
  const out = [];
  out.push(`[0:v]${scaleFilter(settings.width)},fps=${fps},format=gbrp,split=3[nb][ne][nc];`);
  // Masks are made in grayscale (one plane instead of three, so cheaper).
  // Main outlines: found at half size on a smoothed frame (bigger, calmer shapes), enlarged into soft lines.
  // Detail lines: a second, finer edge pass at 2/3 size with its own thresholds, so textures and small features
  // glow too; thin and dimmer than the outlines so foliage does not turn to noise.
  out.push(
    `[ne]scale=w='ceil(iw/2)':h='ceil(ih/2)':flags=area,split=2[ne1][ne2];` +
    `[ne1]bilateral=sigmaS=6:sigmaR=0.12:planes=7,format=gray,gblur=sigma=1.6,edgedetect=low=0.1:high=0.26,lut=c0='clip(val*2,0,255)',format=gray,split=2[nmh][nmh2];` +
    `[nmh]scale=w=${W}:h=${H}:flags=bilinear,format=gray,split=2[nm1][nm2];` +
    `[ne2]format=gray,edgedetect=low=0.07:high=0.19,` +
    `scale=w=${W}:h=${H}:flags=bilinear,format=gray,lut=c0='clip(val*${f(FINE)},0,255)'[nfine];` +
    `[nm1][nfine]blend=all_mode=lighten,format=gbrp[nmask];`,
  );
  if (settings.neon.color === "single") {
    // One electric cyan.
    const cyan = "lutrgb=r='val*0.05':g='val*0.94':b='val'";
    out.push(`[nc]nullsink;[nmask]${cyan}[nlines];[nmh2]format=gbrp,${cyan}[nwide];`);
  } else {
    // A diagonal color ramp twice the frame width, drawn once, that slides sideways and repeats every 8 s.
    // It is cropped to the frame by laying it over a copy of the frame.
    const { w, h } = cover;
    const phase = `2*PI*(X/${w}+Y/${h}*0.35)`;
    const ramp = settings.neon.color === "pinkcyan"
      // Hot pink to electric cyan and back.
      ? { r: `255*(0.5+0.5*sin(${phase}))`, g: `40+190*(0.5-0.5*sin(${phase}))`, b: `214+41*(0.5-0.5*sin(${phase}))` }
      // Full rainbow, pushed toward bright synthwave colors.
      : { r: `clip(128+160*sin(${phase}),0,255)`, g: `clip(128+160*sin(${phase}+2.094),0,255)`, b: `clip(128+160*sin(${phase}+4.189),0,255)` };
    inputs.push(
      `color=c=black:s=${w * 2}x${h}:r=${fps},format=gbrp,geq=r='${ramp.r}':g='${ramp.g}':b='${ramp.b}',` +
      `trim=end_frame=1,loop=loop=-1:size=1:start=0,setpts=N/(${fps}*TB),crop=w=${w}:h=${h}:x='mod(t*${(w / 8).toFixed(2)},${w})':y=0`,
    );
    out.push(`[nc][${firstInput}:v]overlay=format=gbrp:shortest=1,format=gbrp,split=2[ngrad][ngrad2];`);
    out.push(`[ngrad][nmask]blend=all_mode=multiply,format=gbrp[nlines];`);
    // Half-size colored outlines for the wide bloom.
    out.push(`[ngrad2]scale=w='ceil(iw/2)':h='ceil(ih/2)':flags=area,crop=w=${W / 2}:h=${H / 2}:x=0:y=0[ngh];[nmh2]format=gbrp[nmhc];[ngh][nmhc]blend=all_mode=multiply[nwide];`);
  }
  // Glow: the tubes and a tight bloom from all lines, and a wide bloom from the main outlines only
  // (made at half size: same look, much cheaper).
  out.push(`[nlines]split=2[nl0][nl1];`);
  out.push(`[nl1]gblur=sigma=${s1},${gain(g1 * BLOOM)}[ng1];`);
  out.push(`[nwide]gblur=sigma=${f(s2 / 2)},${gain(g2 * BLOOM)},scale=w=${W}:h=${H}:flags=bilinear[ng2];`);
  out.push(`[nl0][ng1]blend=all_mode=screen[nl01];[nl01][ng2]blend=all_mode=screen[nglow];`);
  // Background: the picture darkened, partly desaturated and tinted toward the neon, with a dark halo
  // hugging the outlines so the tubes still pop over it.
  out.push(`[nm2]gblur=sigma=${s1},format=gray,lut=c0='255-clip(val*1.5,0,${HALO})',format=gbrp[nhalo];`);
  out.push(`[nb]colorchannelmixer=${mixer}[nbg0];[nbg0][nhalo]blend=all_mode=multiply[nbg];`);
  out.push(`[nbg][nglow]blend=all_mode=screen,format=rgb24,setsar=1[out]`);
  return { inputs, filter: out.join("") };
}

// VHS Retro: washed warm tape colors, soft picture with bleeding chroma, plus optional scanlines, wobble and grain.
function buildVhs(settings, meta = {}) {
  const on = (id) => settings.vhs.includes(id);
  const w = frameWidth(settings, meta);
  const shift = Math.max(2, Math.round(w / 220)); // color fringe, in pixels
  const soft = Math.max(0.8, w / 900); // horizontal softness
  const pitch = Math.max(2, Math.round(w / 400)); // scanline spacing
  const sat = (0.8 * colorScale(settings)).toFixed(3);
  let text =
    `[0:v]${scaleFilter(settings.width)},fps=${settings.fps},` +
    `eq=saturation=${sat}:contrast=0.9:brightness=0.03:gamma=1.04,` +
    `colorbalance=rs=0.06:bs=-0.08:rm=0.06:gm=0.01:bm=-0.06:rh=0.04:bh=-0.05,` +
    `curves=all='0/0.07 0.5/0.52 1/0.93',` +
    `format=yuv444p,` +
    `gblur=sigma=${soft.toFixed(2)}:sigmaV=0.25:planes=1,` +
    `gblur=sigma=${(soft * 3).toFixed(2)}:sigmaV=0.5:planes=6,` +
    `chromashift=cbh=${shift}:crh=-${shift}:edge=smear,format=gbrp`;
  if (on("wobble")) {
    // Each line drifts sideways a little (a slow wave plus a faster ripple), the whole frame
    // jitters now and then, and a faint tracking band rolls down the screen.
    const amp = Math.max(1, w / 480);
    text +=
      // The sideways map only changes per line, so it is drawn 8x narrower, widened, and trimmed to the frame.
      `,split=2[vv][vw];[vw]format=gray,split=3[vwx][vwref][vwy];` +
      `[vwx]scale=w='ceil(iw/8)':h=ih:flags=neighbor,geq=lum='128+${amp.toFixed(2)}*sin(Y/9+T*5)+${(amp * 0.4).toFixed(2)}*sin(Y/2.3+T*23)',` +
      `scale=w=iw*8:h=ih:flags=neighbor[vwbig];[vwref][vwbig]overlay=x=0:y=0:format=gbrp[vmx];` +
      `[vwy]lut=c0=128[vmy];` +
      `[vv][vmx][vmy]displace=edge=smear,` +
      `crop=w=iw-8:h=ih-4:x='4+3*sin(t*2.3)*gt(sin(t*0.9),0.7)+random(1)-0.5':y='2+gt(sin(t*1.7),0.85)*(random(2)*2-1)',` +
      `scale=iw+8:ih+4:flags=bilinear,` +
      `drawbox=x=0:y='mod(t*ih*0.23,ih*1.3)-ih*0.15':w=iw:h='ih/28':color=white@0.07:t=fill`;
  }
  if (on("scanlines")) text += `,drawgrid=x=0:y=0:w=iw*4:h=${pitch}:t=1:color=black@0.32`;
  if (on("grain")) text += `,format=yuv444p,noise=c0s=11:c0f=t+u:c1s=5:c1f=t:c2s=5:c2f=t`;
  return `${text},vignette=angle=PI/5,format=rgb24,setsar=1[out]`;
}

// Pixel Art: big square pixels (nearest neighbor), in a limited set of colors, scaled back to full size.
function buildPixel(settings, meta = {}) {
  const w = frameWidth(settings, meta);
  const across = { small: 320, medium: 180, large: 96 }[settings.pixel.size]; // pixels across the frame
  const block = Math.max(2, Math.round(w / across));
  const retro = settings.pixel.colors === "retro16";
  const sat = ((retro ? 1.6 : 1.3) * colorScale(settings)).toFixed(3);
  const step = 51; // 6 levels per channel
  const colors = retro
    // Nearest of 16 fixed colors (ffmpeg input 1), with a small ordered dither for that 8-bit look.
    ? `[pq];[pq][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=none`
    : `,lutrgb=r='round(val/${step})*${step}':g='round(val/${step})*${step}':b='round(val/${step})*${step}'`;
  // The small frame is rounded up, so the enlarged one covers the frame; overlaying it on the frame trims it exactly.
  return (
    `[0:v]${scaleFilter(settings.width)},fps=${settings.fps},split=2[pref][ps];` +
    `[ps]scale=w='ceil(iw/${block})':h='ceil(ih/${block})':flags=area,` +
    `eq=saturation=${sat}:contrast=1.12${retro ? ":brightness=0.03" : ""},format=rgb24${colors},` +
    `scale=w=iw*${block}:h=ih*${block}:flags=neighbor[pup];` +
    `[pref][pup]overlay=x=0:y=0:format=gbrp,format=rgb24,setsar=1[out]`
  );
}

// Oil Paint: flat, crisp-edged patches of color (a Kuwahara-like median + open/close at a smaller working
// size, then quantized), with short directional brush strokes pressed in as relief, impasto highlights
// from an emboss, and darkened seams between patches. Fine outlines from the real frame are kept.
const OIL = {
  // down: working size divisor (so patches and strokes scale with the frame) · r: median radius · morph: open/close rounds
  // step: brightness levels (bigger = flatter patches) · len/passes: stroke length · sg: stroke tint
  // sr: stroke depth in the relief · relief: emboss strength · dark: seam darkness · fine: kept detail
  light: { down: 1.75, r: 2, morph: 1, step: 26, len: 5, passes: 1, sg: 0.25, sr: 0.4, relief: 0.55, dark: 1.4, fine: 0.8 },
  medium: { down: 2.5, r: 3, morph: 2, step: 34, len: 7, passes: 2, sg: 0.3, sr: 0.5, relief: 0.7, dark: 1.8, fine: 0.6 },
  strong: { down: 3.7, r: 4, morph: 3, step: 44, len: 7, passes: 2, sg: 0.35, sr: 0.6, relief: 0.85, dark: 2.2, fine: 0.4 },
};

function buildOil(settings) {
  const P = OIL[settings.oil.strength];
  const df = P.down.toFixed(4);
  const sat = (1.4 * colorScale(settings)).toFixed(3);
  // Brightness in coarse steps, color in finer steps around neutral, so patches are flat without hue jumps.
  const cs = Math.round(P.step / 3);
  const q = `format=yuv444p,lut=y='round(val/${P.step})*${P.step}':u='128+round((val-128)/${cs})*${cs}':v='128+round((val-128)/${cs})*${cs}',format=gbrp`;
  const morph = Array.from({ length: P.morph }, () => "dilation,erosion,erosion,dilation").join(",");
  // A diagonal line kernel (len long, inside a 7x7 matrix) that smears noise into strokes.
  const kernel = (dir) => {
    const m = [];
    const off = (7 - P.len) / 2;
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) m.push(y >= off && y < 7 - off && (dir > 0 ? x === y : x === 6 - y) ? 1 : 0);
    }
    return m.join(" ");
  };
  const smear = (dir) => Array.from({ length: P.passes }, () => `convolution=0m='${kernel(dir)}':0rdiv=${(1 / P.len).toFixed(4)}`).join(",");
  // Enlarged frames are rounded up, then laid over a full-size copy so they are trimmed exactly.
  const up = `scale=w='ceil(iw*${df})':h='ceil(ih*${df})'`;
  const out = [];
  out.push(`[0:v]${scaleFilter(settings.width)},fps=${settings.fps},format=gbrp,split=3[oref][os][ofine];`);
  // 1. Patches at working size.
  out.push(
    `[os]scale=w='ceil(iw/${df})':h='ceil(ih/${df})':flags=area,median=radius=${P.r},${morph},` +
    `eq=saturation=${sat}:contrast=1.08,curves=all='0/0.05 0.25/0.33 0.6/0.66 1/1',${q},split=2[osm][ostk];`,
  );
  // 2. Stroke texture: fixed noise smeared along /, \ and -, with the direction chosen per color patch.
  out.push(`[ostk]format=yuv444p,extractplanes=y+u[sa][sm];`);
  out.push(`[sa]lut=c0=128,noise=c0s=100:c0f=u,gblur=sigma=1.1,lut=c0='clip(128+(val-128)*3,0,255)',split=3[na][nb][nc];`);
  out.push(`[na]${smear(1)}[s1];[nb]${smear(-1)}[s2];[nc]avgblur=sizeX=${P.len * P.passes}:sizeY=1[s3];`);
  out.push(
    `[sm]gblur=sigma=2,lut=c0='mod(floor(val/5),3)*127',split=2[sm1][sm2];` +
    `[sm1]lut=c0='if(gt(val,100),255,0)'[smk1];[sm2]lut=c0='if(gt(val,200),255,0)'[smk2];` +
    `[s1][s2][smk1]maskedmerge[s12];[s12][s3][smk2]maskedmerge,lut=c0='clip(128+(val-128)*3,0,255)',${up}:flags=bilinear[stbig];`,
  );
  // 3. Back to full size; quantizing again after the smooth enlargement snaps the patch borders crisp.
  out.push(`[osm]${up}:flags=bicubic[oup];[oref]split=2[oref1][oref2];[oref1][oup]overlay=x=0:y=0:format=gbrp,${q},split=2[pcol][plum];`);
  out.push(`[oref2]format=gray[og];[og][stbig]overlay=x=0:y=0:format=yuv444,format=gray,split=2[st1][st2];`);
  // 4. Impasto relief (patch brightness plus strokes, embossed) and seams between patches.
  out.push(`[plum]format=gray,split=3[pl1][pl2][pl3];`);
  out.push(`[pl1][st2]lut2=c0='clip(x+(y-128)*${P.sr},0,255)',convolution=0m='-2 -1 0 -1 0 1 0 1 2':0bias=128,format=gbrp[emb];`);
  out.push(`[pl2]dilation[pld];[pl3]erosion[ple];[pld][ple]blend=all_mode=difference[pedge];`);
  // Fine outlines (tree trunks, the cliff edge) from the real frame, so they stay readable under the paint.
  out.push(`[ofine]format=gray,gblur=sigma=1,sobel,lut=c0='clip((val-40)*${P.fine},0,255)'[fedge];`);
  out.push(`[pedge][fedge]blend=all_mode=lighten,lut=c0='255-clip(val*${P.dark},0,150)',format=gbrp[odark];`);
  // 5. Stack: color, stroke tint, relief, seams.
  out.push(`[st1]format=gbrp[stc];[pcol][stc]blend=all_mode=softlight:all_opacity=${P.sg}[p1];`);
  out.push(`[p1][emb]blend=all_mode=overlay:all_opacity=${P.relief}[p2];[p2][odark]blend=all_mode=multiply,format=rgb24,setsar=1[out]`);
  return out.join("");
}

function uniqueFile(dir, base) {
  fs.mkdirSync(dir, { recursive: true });
  let candidate = path.join(dir, base);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${n}${ext}`);
    n += 1;
  }
  return candidate;
}

function exportName(input) {
  const stem = path.basename(input, path.extname(input)).replace(/[^\w .()-]+/g, "").trim() || "clip";
  return `${stem}.vibe-filter.mp4`;
}

function jobView(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputPath: job.status === "done" ? job.outputPath : null,
    fileUrl: job.status === "done" ? `/api/jobs/${job.id}/file` : null,
    mode: job.mode,
    seconds: job.target > 0 ? Math.round(job.target * 1000) / 1000 : null,
    phase: job.phase || null,
  };
}

const DEFAULT_PREVIEW_SECONDS = 10;
const MIN_PREVIEW_SECONDS = 1;

// Preview length in seconds, from previewSeconds (or the older duration field). Only a real JSON number is
// accepted; the value is clamped to the clip later, once its length is known. Returns null for "use the default".
function previewSecondsFrom(opts) {
  const raw = opts.previewSeconds !== undefined && opts.previewSeconds !== null ? opts.previewSeconds : opts.duration;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw Object.assign(new Error("Preview length must be a number of seconds"), { status: 400 });
  }
  return raw;
}

function parseOutTime(block) {
  if (block.out_time && block.out_time !== "N/A") {
    const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(block.out_time);
    if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  if (block.out_time_us) return Number(block.out_time_us) / 1e6;
  if (block.out_time_ms) return Number(block.out_time_ms) / 1e6;
  return null;
}

function measureLoudnorm(wav, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      FFMPEG,
      [
        "-hide_banner", "-nostats",
        "-i", wav,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
        "-f", "null", "-",
      ],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (onSpawn) onSpawn(null);
        const text = `${stdout || ""}\n${stderr || ""}`;
        const start = text.lastIndexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) {
          reject(new Error("Could not set the music level"));
          return;
        }
        try {
          resolve(JSON.parse(text.slice(start, end + 1)));
        } catch {
          reject(new Error("Could not set the music level"));
        }
      },
    );
    if (onSpawn) onSpawn(child);
  });
}

function loudnormFilter(measured) {
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : null;
  };
  const bits = [
    ["measured_I", measured?.input_i],
    ["measured_LRA", measured?.input_lra],
    ["measured_TP", measured?.input_tp],
    ["measured_thresh", measured?.input_thresh],
    ["offset", measured?.target_offset],
  ].map(([name, value]) => {
    const n = num(value);
    return n == null ? null : `${name}=${n}`;
  });
  if (bits.some((bit) => bit == null)) return "loudnorm=I=-16:TP=-1.5:LRA=11";
  return `loudnorm=I=-16:TP=-1.5:LRA=11:${bits.join(":")}:linear=true`;
}

// Replace plays the music on its own. Blend keeps the original and sits the
// music under it. Omit audio, or a clip with no soundtrack, is always replace.
function musicAudioFilter({ index, duration, measured, blend }) {
  const dur = Math.max(0.25, duration);
  const durText = dur.toFixed(3);
  const padText = (dur + 1).toFixed(3);
  const music =
    `[${index}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,` +
    `atrim=0:${durText},apad=whole_dur=${padText},asetpts=PTS-STARTPTS,${loudnormFilter(measured)},` +
    // A gentle top-end roll-off keeps the AAC encoder from overshooting the
    // limiter on bright transients (measured up to +2.3 dB without it).
    `lowpass=f=15500:poles=2,alimiter=limit=0.71:attack=5:release=50:level=false`;
  if (!blend) return `${music},atrim=0:${padText},asetpts=PTS-STARTPTS[aout]`;
  return (
    `${music},volume=0.35,asetpts=PTS-STARTPTS[mus];` +
    `[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,` +
    `atrim=0:${durText},apad=whole_dur=${padText},asetpts=PTS-STARTPTS[src];` +
    `[src][mus]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,` +
    `alimiter=limit=0.71:attack=5:release=50:level=false,atrim=0:${padText},asetpts=PTS-STARTPTS[aout]`
  );
}

const analysisCache = new Map();

function cachedAnalysis({ file, ss, t, length, onSpawn }) {
  const mtime = fs.statSync(file).mtimeMs;
  const key = `${file}|${mtime}|${ss}|${t}|${length}`;
  let pending = analysisCache.get(key);
  if (!pending) {
    pending = analyzeClip({ ffmpeg: FFMPEG, file, ss, t, length, onSpawn }).catch((err) => {
      analysisCache.delete(key);
      throw err;
    });
    analysisCache.set(key, pending);
  }
  return pending;
}

function startRender(opts) {
  if (activeJobId && jobs.get(activeJobId)?.status === "running") {
    throw Object.assign(new Error("A render is already running"), { status: 409 });
  }
  const file = existingFile(opts.path);
  const settings = settingsFrom(opts.settings);
  const mode = opts.mode === "export" ? "export" : "preview";
  const askedSeconds = mode === "preview" ? previewSecondsFrom(opts) : null;
  const id = randomUUID();
  const outputPath = mode === "export"
    ? uniqueFile(EXPORT_DIR, exportName(file))
    : path.join(WORK, `${id}.mp4`);

  const job = {
    id,
    status: "running",
    progress: 0,
    error: null,
    outputPath,
    mode,
    target: 0,
    process: null,
    analyze: null,
    phase: null,
    stderr: "",
    paletteFiles: [],
    musicFile: null,
  };
  jobs.set(id, job);
  activeJobId = id;

  probe(file).then(async (meta) => {
    if (job.status !== "running") return;
    let start = 0;
    let duration = meta.duration;
    if (mode === "preview") {
      // At least 1 s, at most whatever is left of the clip after the start point. No other cap.
      const clip = Math.max(MIN_PREVIEW_SECONDS, askedSeconds ?? DEFAULT_PREVIEW_SECONDS);
      start = clamp(Number(opts.start) || 0, 0, Math.max(0, meta.duration - 0.25));
      duration = Math.min(clip, Math.max(0.25, meta.duration - start));
    }
    job.target = duration;
    const omitAudio = opts.omitAudio === true;
    const args = ["-y", "-hide_banner"];
    if (mode === "preview" && start > 0) args.push("-ss", start.toFixed(3));
    if (mode === "preview") args.push("-t", duration.toFixed(3));
    args.push("-i", file);
    job.paletteFiles = palettePlan(settings).map((colors, i) => {
      const paletteFile = path.join(WORK, `${id}-palette-${i + 1}.ppm`);
      writePaletteImage(paletteFile, colors);
      args.push("-i", paletteFile);
      return paletteFile;
    });
    const { inputs, filter } = buildFilter(settings, meta, 1 + job.paletteFiles.length);
    for (const source of inputs) args.push("-f", "lavfi", "-i", source);
    const encode = [
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "animation",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-colorspace", "bt709",
      "-color_primaries", "bt709",
      "-color_trc", "bt709",
      "-color_range", "tv",
      "-movflags", "+faststart",
      "-progress", "pipe:1",
      "-nostats",
      outputPath,
    ];
    // Music off is the original command: copy safe audio, otherwise AAC, or drop it.
    if (settings.music.style === "off") {
      args.push("-filter_complex", filter, "-map", "[out]");
      if (omitAudio) args.push("-an");
      else if (MP4_SAFE_AUDIO.has(meta.audioCodec)) args.push("-map", "0:a:0?", "-c:a", "copy");
      else args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "192k");
      args.push(...encode);
      runFfmpeg(job, args, !omitAudio && meta.audioCodec != null);
      return;
    }

    job.phase = "Listening to the picture…";
    job.progress = 0.04;
    let analysis;
    try {
      analysis = await cachedAnalysis({
        file,
        ss: mode === "preview" && start > 0 ? start : 0,
        t: mode === "preview" ? duration : 0,
        length: duration,
        onSpawn: (child) => { job.analyze = child; },
      });
    } catch (err) {
      if (job.status !== "running") return;
      failJob(job, err.message || "Could not read the picture");
      return;
    }
    job.analyze = null;
    if (job.status !== "running") return;

    job.phase = "Writing the music…";
    job.progress = 0.08;
    const musicFile = path.join(WORK, `${id}-music.wav`);
    job.musicFile = musicFile;
    try {
      await renderMusic({
        analysis,
        style: settings.music.style,
        outFile: musicFile,
        shouldStop: () => job.status !== "running",
        lyrics: settings.music.lyrics,
        lyricsOn: settings.music.lyricsOn,
        oohaah: settings.music.oohaah,
      });
    } catch (err) {
      if (job.status !== "running" || err.cancelled) {
        try { fs.rmSync(musicFile, { force: true }); } catch { /* already gone */ }
        return;
      }
      failJob(job, err.message || "Could not write the music");
      return;
    }
    if (job.status !== "running") {
      try { fs.rmSync(musicFile, { force: true }); } catch { /* already gone */ }
      return;
    }

    let measured;
    try {
      measured = await measureLoudnorm(musicFile, (child) => { job.analyze = child; });
    } catch (err) {
      if (job.status !== "running") return;
      failJob(job, err.message || "Could not set the music level");
      return;
    }
    job.analyze = null;
    if (job.status !== "running") return;

    job.phase = null;
    job.progress = Math.max(job.progress, 0.12);
    args.push("-i", musicFile);
    const musicIndex = 1 + job.paletteFiles.length + inputs.length;
    // Omit audio drops the original soundtrack; the music still plays, as Replace.
    const blend = !omitAudio && meta.audioCodec != null && settings.music.mix === "blend";
    args.push("-filter_complex", `${filter};${musicAudioFilter({ index: musicIndex, duration, measured, blend })}`);
    args.push("-map", "[out]", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest");
    args.push(...encode);
    runFfmpeg(job, args, false);
  }).catch((err) => {
    if (job.status !== "running") return;
    failJob(job, err.message || "Could not read that video");
  });

  return job;
}

// Audio codecs that play everywhere inside an .mp4 and can be copied untouched.
// Anything else (Opus, Vorbis, AC-3, DTS, FLAC, PCM... common in .mkv) is converted to AAC.
const MP4_SAFE_AUDIO = new Set(["aac", "mp3", "alac"]);

function runFfmpeg(job, args, hasAudio, audioFallback = false) {
  if (job.status !== "running") return;
  const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
  job.process = child;
  if (job.status !== "running") {
    child.kill("SIGTERM");
    job.process = null;
    return;
  }
  let block = {};
  let stdoutBuf = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1).trim();
      if (key === "progress") {
        const seconds = parseOutTime(block);
        if (Number.isFinite(seconds) && job.target > 0) {
          // Music spends a little of the bar before ffmpeg starts; the encode fills the rest.
          const base = job.musicFile ? 0.12 : 0;
          const mapped = base + (1 - base) * (seconds / job.target);
          job.progress = Math.max(job.progress, Math.min(0.99, mapped));
        }
        if (value === "end") job.progress = 1;
        block = {};
      } else {
        block[key] = value;
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    job.stderr = (job.stderr + chunk.toString()).slice(-12_000);
  });

  child.on("error", (err) => failJob(job, err.message));
  child.on("close", (code) => {
    if (job.status !== "running") return;
    if (code === 0 && fs.existsSync(job.outputPath)) {
      cleanPalettes(job);
      job.status = "done";
      job.progress = 1;
      job.process = null;
      if (activeJobId === job.id) activeJobId = null;
      if (job.mode === "preview") dropOlderPreviews(job);
      return;
    }
    const audioProblem = hasAudio && !audioFallback && /audio|codec|mp4a|tag/i.test(job.stderr);
    if (audioProblem) {
      const retry = args.map((arg) => (arg === "copy" ? "aac" : arg));
      const copyAt = args.indexOf("copy");
      if (copyAt !== -1) {
        retry.splice(copyAt + 1, 0, "-b:a", "160k");
        job.stderr = "";
        job.progress = 0;
        runFfmpeg(job, retry, true, true);
        return;
      }
    }
    try { fs.rmSync(job.outputPath, { force: true }); } catch { /* already gone */ }
    const tail = job.stderr.trim().split("\n").slice(-6).join(" ");
    failJob(job, tail || `ffmpeg stopped (${code})`);
  });
}

// Only the newest preview is kept in the work folder, so long previews don't pile up. Exports are never touched.
function dropOlderPreviews(keep) {
  for (const other of jobs.values()) {
    if (other === keep || other.mode !== "preview" || other.status !== "done") continue;
    try { fs.rmSync(other.outputPath, { force: true }); } catch { /* already gone */ }
    other.status = "error";
    other.error = "Replaced by a newer preview";
  }
}

function cleanPalettes(job) {
  for (const file of job.paletteFiles || []) {
    try { fs.rmSync(file, { force: true }); } catch { /* already gone */ }
  }
  job.paletteFiles = [];
  if (job.musicFile) {
    try { fs.rmSync(job.musicFile, { force: true }); } catch { /* already gone */ }
    job.musicFile = null;
  }
}

function failJob(job, message) {
  cleanPalettes(job);
  job.status = "error";
  job.error = message;
  job.process = null;
  if (activeJobId === job.id) activeJobId = null;
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status !== "running") return job;
  cleanPalettes(job);
  job.status = "error";
  job.error = "Cancelled";
  if (job.analyze) {
    try { job.analyze.kill("SIGTERM"); } catch { /* already gone */ }
    job.analyze = null;
  }
  if (job.process) {
    job.process.kill("SIGTERM");
    job.process = null;
    setTimeout(() => fs.rmSync(job.outputPath, { force: true }), 400);
  }
  if (activeJobId === id) activeJobId = null;
  return job;
}

function contentType(file) {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(res, file) {
  const resolved = path.resolve(PUBLIC, file);
  if (!resolved.startsWith(PUBLIC + path.sep) && resolved !== path.join(PUBLIC, "index.html")) {
    send(res, 404, { error: "Not found" });
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      send(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(resolved),
      "content-length": data.length,
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function serveVideo(req, res, file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    send(res, 404, { error: "Render is gone" });
    return;
  }
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      "content-type": "video/mp4",
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": stat.size,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      serveStatic(res, "index.html");
      return;
    }
    if (req.method === "GET" && (url.pathname === "/app.js" || url.pathname === "/style.css")) {
      serveStatic(res, url.pathname.slice(1));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/probe") {
      const body = await readJson(req);
      send(res, 200, await probe(existingFile(body.path)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/choose") {
      const picked = await new Promise((resolve, reject) => {
        execFile(
          "osascript",
          ["-e", 'POSIX path of (choose file with prompt "Choose a video")'],
          (err, stdout) => {
            if (err) reject(Object.assign(new Error("No file chosen"), { status: 400 }));
            else resolve(stdout.trim());
          },
        );
      });
      send(res, 200, await probe(existingFile(picked)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upload") {
      const name = path.basename(url.searchParams.get("name") || "clip.mp4").replace(/[^\w .()-]+/g, "");
      const dest = path.join(WORK, "uploads", `${Date.now()}-${name || "clip.mp4"}`);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(dest);
        req.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        req.on("error", reject);
      });
      send(res, 200, await probe(dest));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/lyrics-fit") {
      const body = await readJson(req);
      const file = existingFile(body.path);
      const music = musicFrom({
        style: body.style,
        lyrics: body.lyrics,
        lyricsOn: true,
        oohaah: body.oohaah === true,
      });
      if (music.style === "off") {
        send(res, 200, { coverage: 0, unsungPct: 0, syllables: 0, sung: 0, lines: [] });
        return;
      }
      const meta = await probe(file);
      const startRaw = Number(body.start) || 0;
      const full = body.full === true && startRaw <= 0;
      const start = full ? 0 : clamp(startRaw, 0, Math.max(0, meta.duration - 0.25));
      const length = full
        ? meta.duration
        : Math.min(Math.max(0.25, Number(body.length) || meta.duration), Math.max(0.25, meta.duration - start));
      const analysis = await cachedAnalysis({
        file,
        ss: start > 0 ? start : 0,
        t: length,
        length,
      });
      send(res, 200, fitLyrics(analysis, music.style, music.lyrics, music.oohaah));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/render") {
      const body = await readJson(req);
      const job = startRender(body);
      send(res, 200, jobView(job));
      return;
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)(\/file|\/reveal)?$/.exec(url.pathname);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) {
        send(res, 404, { error: "No such render" });
        return;
      }
      if (req.method === "GET" && !jobMatch[2]) {
        if (job.status !== "running" && activeJobId === job.id) activeJobId = null;
        send(res, 200, jobView(job));
        return;
      }
      if (req.method === "POST" && url.pathname.endsWith("/cancel")) {
        send(res, 200, jobView(cancelJob(job.id)));
        return;
      }
      if (req.method === "GET" && jobMatch[2] === "/file") {
        if (job.status !== "done") {
          send(res, 409, { error: "Render is not ready" });
          return;
        }
        serveVideo(req, res, job.outputPath);
        return;
      }
      if (req.method === "POST" && jobMatch[2] === "/reveal") {
        if (job.status !== "done") {
          send(res, 409, { error: "Render is not ready" });
          return;
        }
        spawn("open", ["-R", job.outputPath], { stdio: "ignore" });
        send(res, 200, { ok: true });
        return;
      }
    }

    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/cancel$/.test(url.pathname)) {
      const id = url.pathname.split("/")[3];
      const job = cancelJob(id);
      if (!job) send(res, 404, { error: "No such render" });
      else send(res, 200, jobView(job));
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (err) {
    if (res.headersSent) return;
    send(res, err.status || 500, { error: err.message || "Something went wrong" });
  }
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.listen(PORT, HOST, () => {
  console.log(`Vibe Filter is at http://${HOST}:${PORT}`);
});
