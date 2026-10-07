const pathInput = document.querySelector("#path");
const chooseBtn = document.querySelector("#choose");
const drop = document.querySelector("#drop");
const meta = document.querySelector("#meta");
const previewBtn = document.querySelector("#preview");
const exportBtn = document.querySelector("#export");
const cancelBtn = document.querySelector("#cancel");
const statusEl = document.querySelector("#status");
const progressWrap = document.querySelector("#progress-wrap");
const progressBar = document.querySelector("#progress");
const player = document.querySelector("#player");
const download = document.querySelector("#download");
const revealBtn = document.querySelector("#reveal");
const saved = document.querySelector("#saved");
const startInput = document.querySelector("#start");
const muteInput = document.querySelector("#mute");
const lengthInput = document.querySelector("#length");
const lengthFull = document.querySelector("#length-full");
const lengthHint = document.querySelector("#length-hint");
const PREVIEW_SECONDS = 10;
const LENGTH_KEY = "vibeFilter.previewLength";
const SPEED_KEY = "vibeFilter.previewSpeed";
const OOH_KEY = "vibeFilter.oohaah";
const LYRICS_ON_KEY = "vibeFilter.lyricsOn";
const LYRICS_KEY = "vibeFilter.lyrics";
// Carry over settings saved under the app's old name (same address, so the browser still has them).
try {
  for (const [key, old] of [[LENGTH_KEY, "toonClip.previewLength"], [SPEED_KEY, "toonClip.previewSpeed"]]) {
    const saved = localStorage.getItem(old);
    if (saved !== null && localStorage.getItem(key) === null) localStorage.setItem(key, saved);
    localStorage.removeItem(old);
  }
} catch { /* storage off */ }

const outlineNames = ["Off", "Light", "Medium", "Bold", "Heavy"];
const detailNames = ["Fewest", "Few", "Medium", "Many", "Most"];
let clip = null;
let jobId = null;
let pollTimer = null;
let renderStarted = 0;

// Saved preview length: { seconds, full }. Anything odd falls back to the 10 second default.
function loadLength() {
  try {
    const saved = JSON.parse(localStorage.getItem(LENGTH_KEY) || "null");
    const seconds = Number(saved?.seconds);
    return {
      seconds: Number.isFinite(seconds) && seconds >= 1 ? seconds : PREVIEW_SECONDS,
      full: saved?.full === true,
    };
  } catch {
    return { seconds: PREVIEW_SECONDS, full: false };
  }
}

function typedSeconds() {
  const n = Number(lengthInput.value);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function saveLength() {
  const seconds = typedSeconds() ?? loadLength().seconds;
  try {
    localStorage.setItem(LENGTH_KEY, JSON.stringify({ seconds, full: lengthFull.checked }));
  } catch { /* storage off */ }
}

// What the server will render: at least 1 s, at most what is left of the clip after the start point.
function previewPlan() {
  const start = Number(startInput.value) || 0;
  const asked = lengthFull.checked && clip ? clip.duration : (typedSeconds() ?? PREVIEW_SECONDS);
  if (!clip) return { asked, seconds: asked, start };
  const left = Math.max(0.25, clip.duration - Math.min(start, Math.max(0, clip.duration - 0.25)));
  return { asked, seconds: Math.min(Math.max(1, asked), left), start };
}

function lengthLabel(seconds) {
  return seconds < 60 ? `${Math.round(seconds * 10) / 10} seconds` : clock(seconds);
}

function refreshLength() {
  const plan = previewPlan();
  lengthInput.disabled = !clip || lengthFull.checked || !progressWrap.hidden;
  lengthFull.disabled = !clip || !progressWrap.hidden;
  if (lengthFull.checked && clip) lengthInput.value = String(Math.round(clip.duration * 10) / 10);
  const toEnd = clip && plan.seconds < plan.asked - 0.05;
  previewBtn.textContent = lengthFull.checked && clip && plan.start <= 0
    ? "Preview full clip"
    : toEnd ? "Preview to the end" : `Preview ${lengthLabel(plan.seconds)}`;
  if (!clip) {
    lengthHint.textContent = "Load a clip to see its length.";
    return;
  }
  const parts = [`Max ${clock(clip.duration)} (the whole clip).`];
  if (toEnd || (lengthFull.checked && plan.start > 0)) parts.push(`From ${clock(plan.start)} that is ${clock(plan.seconds)} to the end.`);
  if (plan.seconds > 15) {
    const speed = Number(localStorage.getItem(SPEED_KEY));
    parts.push(Number.isFinite(speed) && speed > 0
      ? `About ${clock(plan.seconds / speed)} to render at your last speed.`
      : "Long previews take about as long as exporting that much.");
  }
  lengthHint.textContent = parts.join(" ");
}

function settings() {
  const selected = (id) => document.querySelector(`#${id} button.on`)?.dataset.value;
  return {
    style: selected("style") || "classic",
    fps: Number(selected("fps") || 12),
    width: Number(selected("width") ?? 960),
    simplify: Number(document.querySelector("#simplify").value),
    outline: Number(document.querySelector("#outline").value),
    saturation: Number(document.querySelector("#saturation").value),
    palettes: selectedPalettes(),
    paletteMode: selected("palette-mode") || "combine",
    fractal: selectedFractal(),
    neon: { color: selected("neon-color") || "rainbow", glow: selected("neon-glow") || "medium", bg: selected("neon-bg") || "medium" },
    vhs: [...document.querySelectorAll("#vhs button.on")].map((b) => b.dataset.value),
    pixel: { size: selected("pixel-size") || "medium", colors: selected("pixel-colors") || "rich" },
    oil: { strength: selected("oil-strength") || "medium" },
    music: {
      style: document.querySelector("#music button.on")?.dataset.value || "off",
      mix: document.querySelector("#music-mix button.on")?.dataset.value || "replace",
      oohaah: document.querySelector("#oohaah").classList.contains("on"),
      lyricsOn: document.querySelector("#lyrics-on").classList.contains("on"),
      lyrics: document.querySelector("#lyrics-text").value.slice(0, 4000),
    },
  };
}

function musicStyle() {
  return document.querySelector("#music button.on")?.dataset.value || "off";
}

function musicMix() {
  return document.querySelector("#music-mix button.on")?.dataset.value || "replace";
}

function lyricsOn() {
  return document.querySelector("#lyrics-on").classList.contains("on");
}

function mixHintText() {
  const style = musicStyle();
  const omit = muteInput.checked;
  if (style === "off") return "Off leaves the soundtrack as it is.";
  if (omit) return "Omit audio drops the original sound, so the music plays alone.";
  if (musicMix() === "blend") return "Music sits under the original sound.";
  return "Music replaces the original sound.";
}

// Mix is only a choice while music is on and the original soundtrack is kept.
function refreshMusic() {
  const style = musicStyle();
  const omit = muteInput.checked;
  const locked = style === "off" || omit;
  document.querySelector("#mix-wrap").classList.toggle("is-off", locked);
  for (const button of document.querySelectorAll("#music-mix button")) button.disabled = locked;
  const ooh = document.querySelector("#oohaah");
  const lyrics = document.querySelector("#lyrics-on");
  const edit = document.querySelector("#lyrics-edit");
  ooh.disabled = locked;
  lyrics.disabled = style === "off";
  edit.disabled = style === "off" || !lyrics.classList.contains("on");
  ooh.setAttribute("aria-pressed", String(ooh.classList.contains("on")));
  lyrics.setAttribute("aria-pressed", String(lyrics.classList.contains("on")));
  const hint = document.querySelector("#music-hint");
  if (style !== "off" && lyrics.classList.contains("on")) scheduleFit();
  else hint.textContent = mixHintText();
  if (clip) meta.textContent = `${clip.width}×${clip.height} · ${clip.fps} fps · ${clock(clip.duration)} · ${audioNote(clip)}`;
}

let fitTimer = null;
let fitSerial = 0;

function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(runFit, 300);
}

async function runFit() {
  const hint = document.querySelector("#music-hint");
  if (musicStyle() === "off" || !lyricsOn()) {
    hint.textContent = mixHintText();
    return;
  }
  if (!clip) {
    hint.textContent = "Load a clip to fit lyrics.";
    return;
  }
  const text = document.querySelector("#lyrics-text").value;
  if (!text.trim()) {
    hint.textContent = "Paste lyrics to sing them.";
    return;
  }
  const plan = previewPlan();
  const serial = ++fitSerial;
  try {
    const data = await postJson("/api/lyrics-fit", {
      path: clip.path,
      start: plan.start,
      length: plan.seconds,
      full: lengthFull.checked && plan.start <= 0,
      style: musicStyle(),
      lyrics: text,
      oohaah: document.querySelector("#oohaah").classList.contains("on"),
    });
    if (serial !== fitSerial || !lyricsOn() || musicStyle() === "off") return;
    if (data.unsungPct > 0) hint.textContent = `Lyrics run past the end, ${Math.round(data.unsungPct)}% won't be sung`;
    else hint.textContent = `Lyrics cover ${Math.round(data.coverage)}% of this clip`;
  } catch (err) {
    if (serial !== fitSerial) return;
    hint.textContent = "Couldn't fit lyrics.";
  }
}

function currentStyle() {
  return document.querySelector("#style button.on")?.dataset.value || "classic";
}

// Each newer style has its own small group of options under the style buttons; only the chosen one shows.
const styleOptions = { neon: "neon-wrap", vhs: "vhs-wrap", pixel: "pixel-wrap", oil: "oil-wrap" };

function refreshStyleOptions() {
  const style = currentStyle();
  for (const [id, wrap] of Object.entries(styleOptions)) document.querySelector(`#${wrap}`).hidden = style !== id;
}

function bindStyleOptions() {
  for (const id of ["neon-color", "neon-glow", "neon-bg", "pixel-size", "pixel-colors", "oil-strength"]) bindOptions(id);
  // VHS extras are toggles, and all of them may be off.
  const vhs = document.querySelector("#vhs");
  vhs.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    button.classList.toggle("on");
    button.setAttribute("aria-pressed", String(button.classList.contains("on")));
  });
}

function selectedFractal() {
  const on = [...document.querySelectorAll("#fractal button.on")].map((b) => b.dataset.value);
  return on.length ? on : ["glow"];
}

const fractalHints = {
  tendrils: "lightning branches out of the edges",
  fill: "Mandelbrot swirls in the busy areas",
  echo: "details repeat smaller toward the center",
  glow: "a shimmering noise aura on the outlines",
};

function refreshFractal() {
  const style = document.querySelector("#style button.on")?.dataset.value || "classic";
  document.querySelector("#fractal-wrap").hidden = style !== "fractal";
  const on = selectedFractal();
  const names = { tendrils: "Tendrils", fill: "Fill", echo: "Echo", glow: "Glow" };
  // Same fixed order the server stacks them in.
  const order = ["fill", "echo", "tendrils", "glow"].filter((id) => on.includes(id));
  document.querySelector("#fractal-hint").textContent = order.length === 1
    ? `${names[order[0]]}: ${fractalHints[order[0]]}. Turn on more to stack them.`
    : `Stacked in this order: ${order.map((id) => names[id]).join(", then ")}.`;
}

function bindFractal() {
  const group = document.querySelector("#fractal");
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    button.classList.toggle("on");
    // At least one effect stays on; turning them all off falls back to Glow.
    if (!group.querySelector("button.on")) group.querySelector('button[data-value="glow"]').classList.add("on");
    for (const item of group.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item.classList.contains("on")));
    refreshFractal();
  });
}

function selectedPalettes() {
  const on = [...document.querySelectorAll("#palette button.on")].map((b) => b.dataset.value);
  return on.length ? on : ["original"];
}

const paletteHints = {
  one: "Turn on one or more. Original keeps the clip's own colors.",
  combine: "Combine pools every chosen color; each patch takes the nearest one.",
  mix: "Mix renders each palette on its own, then blends them evenly.",
};

function refreshPalettes() {
  const style = document.querySelector("#style button.on")?.dataset.value || "classic";
  document.querySelector("#palette-wrap").hidden = style !== "classic";
  const count = document.querySelectorAll("#palette button.on").length;
  document.querySelector("#palette-mode").hidden = count < 2;
  const mode = document.querySelector("#palette-mode button.on")?.dataset.value || "combine";
  document.querySelector("#palette-hint").textContent = count < 2 ? paletteHints.one : paletteHints[mode];
}

function bindPalettes() {
  const group = document.querySelector("#palette");
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    button.classList.toggle("on");
    // At least one palette stays on; turning them all off falls back to Original.
    if (!group.querySelector("button.on")) group.querySelector('button[data-value="original"]').classList.add("on");
    for (const item of group.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item.classList.contains("on")));
    refreshPalettes();
  });
  bindOptions("palette-mode");
  document.querySelector("#palette-mode").addEventListener("click", refreshPalettes);
}

const styleHints = {
  classic: "Flat cel colors and an even ink line, like a 1950s short.",
  fractal: "Fractal effects seeded from the edges in every frame, so they move with the video.",
  neon: "Glowing neon outlines and details over a darkened picture.",
  vhs: "Worn tape: soft, warm, washed colors with a little color bleed.",
  pixel: "Chunky square pixels in a limited set of colors.",
  oil: "Flat patches of paint with visible brush strokes and thick-paint highlights.",
};

// Which Look sliders a style uses. The others are dimmed and ignored for that style.
const sliderUse = {
  classic: ["simplify", "outline", "saturation"],
  fractal: ["simplify", "outline", "saturation"],
  neon: [],
  vhs: ["saturation"],
  pixel: ["saturation"],
  oil: ["saturation"],
};

function simplifyLabel(simplify, style) {
  const t = Number(simplify) / 100;
  if (style === "fractal") return t > 0.66 ? "strong" : t < 0.34 ? "light" : "medium";
  const n = Math.max(3, Math.round(255 / Math.round(32 + t * 40)));
  return `${n} shades`;
}

function clock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function setStatus(text, bad = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("bad", bad);
}

function setBusy(busy) {
  previewBtn.disabled = busy || !clip;
  exportBtn.disabled = busy || !clip;
  chooseBtn.disabled = busy;
  muteInput.disabled = busy;
  cancelBtn.hidden = !busy;
  progressWrap.hidden = !busy;
  if (!busy) progressBar.style.width = "0%";
  refreshLength();
}

function refreshSliderLabels() {
  const style = currentStyle();
  document.querySelector("#style-hint").textContent = styleHints[style];
  const fractal = style === "fractal";
  document.querySelector("#simplify-name").textContent = fractal ? "Strength" : "Simplify";
  document.querySelector("#outline-name").textContent = fractal ? "Detail seeds" : "Outline";
  document.querySelector("#simplify-val").textContent = simplifyLabel(document.querySelector("#simplify").value, style);
  const outline = Number(document.querySelector("#outline").value);
  document.querySelector("#outline-val").textContent = (fractal ? detailNames : outlineNames)[outline] || String(outline);
  const saturation = Number(document.querySelector("#saturation").value);
  // Outside Classic, 1.50 keeps the clip's own colors.
  document.querySelector("#saturation-val").textContent = style !== "classic" ? `${(saturation / 1.5).toFixed(2)}×` : saturation.toFixed(2);
  const uses = sliderUse[style] || sliderUse.classic;
  for (const id of ["simplify", "outline", "saturation"]) {
    const used = uses.includes(id);
    const input = document.querySelector(`#${id}`);
    input.disabled = !used;
    input.closest(".slider").classList.toggle("off", !used);
    input.closest(".slider").title = used ? "" : "Not used by this style";
    if (!used) document.querySelector(`#${id}-val`).textContent = "not used";
  }
  document.querySelector("#start-val").textContent = clock(startInput.value);
  refreshLength();
}

function audioNote(info) {
  const style = musicStyle();
  if (!info?.audioCodec && style === "off") return "no audio track";
  const kind = info?.audioCodec
    ? `${info.audioCodec} ${info.audioChannels === 1 ? "mono" : `${info.audioChannels || ""} ch`}`
    : "no audio track";
  if (style === "off") return `${kind} · ${muteInput.checked ? "omitted" : "copied unchanged"}`;
  const label = { ambient: "Ambient", lofi: "Lo-fi", arp: "Dreamy Arp", synthwave: "Synthwave" }[style] || "Music";
  const alone = !info?.audioCodec || muteInput.checked || musicMix() === "replace";
  return `${kind} · ${label} ${alone ? "music" : "blended"}`;
}

function showClip(info) {
  clip = info;
  pathInput.value = info.path;
  pathInput.title = info.path;
  requestAnimationFrame(() => {
    pathInput.scrollLeft = pathInput.scrollWidth;
  });
  meta.textContent = `${info.width}×${info.height} · ${info.fps} fps · ${clock(info.duration)} · ${audioNote(info)}`;
  startInput.disabled = false;
  startInput.max = String(Math.max(0, info.duration));
  if (Number(startInput.value) > info.duration) startInput.value = "0";
  lengthInput.max = String(Math.round(info.duration * 10) / 10);
  if (!lengthFull.checked) lengthInput.value = String(loadLength().seconds);
  refreshSliderLabels();
  setBusy(false);
  setStatus("");
  if (lyricsOn()) scheduleFit();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadPath(filePath) {
  setStatus("Reading the clip…");
  try {
    showClip(await postJson("/api/probe", { path: filePath }));
  } catch (err) {
    clip = null;
    setBusy(false);
    meta.textContent = "No clip loaded.";
    setStatus(err.message, true);
  }
}

function bindOptions(id) {
  const group = document.querySelector(`#${id}`);
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const item of group.querySelectorAll("button")) item.classList.toggle("on", item === button);
  });
}

async function render(mode) {
  if (!clip) return;
  setBusy(true);
  download.hidden = true;
  revealBtn.hidden = true;
  saved.textContent = "";
  const plan = previewPlan();
  setStatus(mode === "export" ? "Exporting the full clip…" : `Rendering a ${lengthLabel(plan.seconds)} preview…`);
  renderStarted = Date.now();
  try {
    const job = await postJson("/api/render", {
      path: clip.path,
      mode,
      start: Number(startInput.value) || 0,
      previewSeconds: plan.asked,
      omitAudio: muteInput.checked,
      settings: settings(),
    });
    jobId = job.id;
    poll();
  } catch (err) {
    setBusy(false);
    setStatus(err.message, true);
  }
}

async function poll() {
  clearTimeout(pollTimer);
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || "Lost the render");
    progressBar.style.width = `${Math.round((job.progress || 0) * 100)}%`;
    if (job.status === "running") {
      const pct = Math.round((job.progress || 0) * 100);
      setStatus(job.phase || `Rendering ${pct}%`);
      pollTimer = setTimeout(poll, 400);
      return;
    }
    setBusy(false);
    if (job.status === "done" && job.seconds > 0 && renderStarted) {
      // Seconds of video per second of rendering, for the estimate next to long preview lengths.
      const speed = job.seconds / Math.max(0.5, (Date.now() - renderStarted) / 1000);
      try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* storage off */ }
      renderStarted = 0;
      refreshLength();
    }
    if (job.status === "error") {
      setStatus(job.error || "Render failed", true);
      return;
    }
    player.src = `${job.fileUrl}?t=${Date.now()}`;
    player.play().catch(() => {});
    download.href = job.fileUrl;
    download.hidden = false;
    revealBtn.hidden = job.mode !== "export";
    saved.textContent = job.mode === "export"
      ? job.outputPath
      : "Preview only. Export saves the full clip in Movies.";
    setStatus(job.mode === "export" ? "Export ready." : "Preview ready.");
  } catch (err) {
    setBusy(false);
    setStatus(err.message, true);
  }
}

try {
  if (localStorage.getItem(OOH_KEY) === "1") document.querySelector("#oohaah").classList.add("on");
  if (localStorage.getItem(LYRICS_ON_KEY) === "1") document.querySelector("#lyrics-on").classList.add("on");
  const savedLyrics = localStorage.getItem(LYRICS_KEY);
  if (savedLyrics) document.querySelector("#lyrics-text").value = savedLyrics;
} catch { /* storage off */ }

bindOptions("style");
bindOptions("fps");
bindOptions("width");
bindOptions("music");
bindOptions("music-mix");
document.querySelector("#music").addEventListener("click", refreshMusic);
document.querySelector("#music-mix").addEventListener("click", refreshMusic);
document.querySelector("#oohaah").addEventListener("click", () => {
  const button = document.querySelector("#oohaah");
  if (button.disabled) return;
  button.classList.toggle("on");
  try { localStorage.setItem(OOH_KEY, button.classList.contains("on") ? "1" : "0"); } catch { /* storage off */ }
  refreshMusic();
});
document.querySelector("#lyrics-on").addEventListener("click", () => {
  const button = document.querySelector("#lyrics-on");
  if (button.disabled) return;
  button.classList.toggle("on");
  try { localStorage.setItem(LYRICS_ON_KEY, button.classList.contains("on") ? "1" : "0"); } catch { /* storage off */ }
  refreshMusic();
});
document.querySelector("#lyrics-edit").addEventListener("click", () => {
  if (document.querySelector("#lyrics-edit").disabled) return;
  document.querySelector("#lyrics-modal").hidden = false;
  document.querySelector("#lyrics-text").focus();
});
document.querySelector("#lyrics-close").addEventListener("click", () => {
  document.querySelector("#lyrics-modal").hidden = true;
});
document.querySelector("#lyrics-modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.hidden = true;
});
document.querySelector("#lyrics-text").addEventListener("input", () => {
  const value = document.querySelector("#lyrics-text").value.slice(0, 4000);
  try { localStorage.setItem(LYRICS_KEY, value); } catch { /* storage off */ }
  scheduleFit();
});
refreshMusic();
bindPalettes();
bindFractal();
bindStyleOptions();
document.querySelector("#style").addEventListener("click", refreshSliderLabels);
document.querySelector("#style").addEventListener("click", refreshPalettes);
document.querySelector("#style").addEventListener("click", refreshFractal);
document.querySelector("#style").addEventListener("click", refreshStyleOptions);
refreshPalettes();
refreshFractal();
refreshStyleOptions();
for (const id of ["simplify", "outline", "saturation", "start"]) {
  document.querySelector(`#${id}`).addEventListener("input", refreshSliderLabels);
}
document.querySelector("#start").addEventListener("input", scheduleFit);
{
  const saved = loadLength();
  lengthInput.value = String(saved.seconds);
  lengthFull.checked = saved.full;
}
lengthInput.addEventListener("input", () => {
  if (typedSeconds() !== null) saveLength();
  refreshLength();
  scheduleFit();
});
lengthInput.addEventListener("change", () => {
  // Leaving the field with junk or less than 1 s snaps back to the last good value.
  if (typedSeconds() === null) lengthInput.value = String(loadLength().seconds);
  saveLength();
  refreshLength();
  scheduleFit();
});
lengthFull.addEventListener("change", () => {
  if (!lengthFull.checked) lengthInput.value = String(loadLength().seconds);
  saveLength();
  refreshLength();
  scheduleFit();
});
refreshSliderLabels();
muteInput.addEventListener("change", refreshMusic);

pathInput.addEventListener("change", () => {
  if (pathInput.value.trim()) loadPath(pathInput.value.trim());
});

chooseBtn.addEventListener("click", async () => {
  setStatus("Choose a video…");
  try {
    const res = await fetch("/api/choose", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No file chosen");
    showClip(data);
  } catch (err) {
    setStatus(err.message, true);
  }
});

previewBtn.addEventListener("click", () => render("preview"));
exportBtn.addEventListener("click", () => render("export"));
cancelBtn.addEventListener("click", async () => {
  if (!jobId) return;
  await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
});
revealBtn.addEventListener("click", () => {
  if (jobId) fetch(`/api/jobs/${jobId}/reveal`, { method: "POST" });
});

for (const eventName of ["dragenter", "dragover"]) {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.add("hot");
  });
}
drop.addEventListener("dragleave", () => drop.classList.remove("hot"));
drop.addEventListener("drop", async (event) => {
  event.preventDefault();
  drop.classList.remove("hot");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await upload(file);
});

async function upload(file) {
  setStatus(`Copying ${file.name}…`);
  setBusy(true);
  try {
    const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    showClip(data);
  } catch (err) {
    setBusy(false);
    setStatus(err.message, true);
  }
}

document.body.addEventListener("dragover", (event) => event.preventDefault());
document.body.addEventListener("drop", (event) => event.preventDefault());
