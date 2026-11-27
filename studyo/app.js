import { download } from "/gunluk/common.js?v=1";

const $ = id => document.getElementById(id);
const preview = $("preview");
const context = preview.getContext("2d", { willReadFrequently: true });
const maxPixels = 24_000_000;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
let main, logo, busy = false, queued = [], zipReady;
const loading = new Set();
const state = {};
const status = message => { $("status").textContent = message; };
async function readStatic(file) {
  try { return await createImageBitmap(file); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const picture = new Image();
      await new Promise((resolve, reject) => {
        picture.onload = resolve; picture.onerror = reject; picture.src = url;
      });
      return picture;
    } finally { URL.revokeObjectURL(url); }
  }
}

async function readPicture(file, allowGif) {
  if (file.size > 35 * 1024 ** 2) throw new Error("35 MB’tan küçük bir görsel seç.");
  const data = await file.arrayBuffer();
  const header = new TextDecoder().decode(data.slice(0, 6));
  if (/^GIF8[79]a$/.test(header)) {
    if (!allowGif) throw new Error("Bu alanda JPG veya PNG seç.");
    const module = await import("./gif-reader.js");
    const { parseGIF, decompressFrames } = module.default;
    const parsed = parseGIF(data);
    const { width, height } = parsed.lsd;
    const imageFrames = parsed.frames.filter(frame => frame.image);
    const pixels = imageFrames.reduce((sum, frame) => sum + frame.image.descriptor.width * frame.image.descriptor.height, 0);
    if (!width || !height || width * height * imageFrames.length > 64_000_000 || pixels > 64_000_000 || imageFrames.length > 220) {
      throw new Error("Bu GIF tarayıcıda işlemek için fazla büyük.");
    }
    const frames = decompressFrames(parsed, true);
    if (!frames.length) throw new Error("GIF karesi okunamadı.");
    const loopData = parsed.frames.find(frame => frame.application?.id === "NETSCAPE2.0")?.application?.blocks;
    const repeat = loopData?.length >= 3 && loopData[0] === 1 ? loopData[1] | (loopData[2] << 8) : -1;
    return { width, height, frames, repeat, type: "image/gif", name: file.name };
  }
  const image = await readStatic(file);
  if (image.width * image.height > maxPixels) { image.close?.(); throw new Error("24 megapikselden küçük bir görsel seç."); }
  const type = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "image/png";
  return { image, width: image.width, height: image.height, type, name: file.name };
}

function gifPlayer(picture) {
  const canvas = document.createElement("canvas"), patch = document.createElement("canvas");
  canvas.width = picture.width; canvas.height = picture.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let previous, snapshot;
  return {
    frame(frame) {
      if (previous?.disposalType === 2) {
        const { left, top, width, height } = previous.dims;
        ctx.clearRect(left, top, width, height);
      } else if (previous?.disposalType === 3 && snapshot) ctx.putImageData(snapshot, 0, 0);
      snapshot = frame.disposalType === 3 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
      const { left, top, width, height } = frame.dims;
      if (width && height) {
        patch.width = width; patch.height = height;
        patch.getContext("2d").putImageData(new ImageData(frame.patch, width, height), 0, 0);
        ctx.drawImage(patch, left, top);
      }
      previous = frame;
      return canvas;
    },
    clear() { canvas.width = canvas.height = patch.width = patch.height = 0; },
  };
}

function watermark(ctx, photo, w, h) {
  ctx.drawImage(photo, 0, 0, w, h);
  const words = $("text").value.trim();
  const amount = Math.max(5, Math.min(75, $("size").valueAsNumber || 20)) / 100;
  const margin = Math.max(2, Math.min(w, h) * .045);
  const markWidth = w * amount;
  const scale = logo ? Math.min(markWidth / logo.width, h * .45 / logo.height) : 0;
  const iw = logo ? logo.width * scale : 0, ih = logo ? logo.height * scale : 0;
  const fontPx = Math.min(h * .2, Math.max(7, markWidth / Math.max(3, words.length) * 1.8));
  const textHeight = words ? fontPx * 1.3 : 0;
  const width = Math.max(iw, words ? markWidth : 0), height = ih + textHeight;
  const location = $("position").value;
  const x = location === "c" ? (w - width) / 2 : location.endsWith("l") ? margin : w - width - margin;
  const y = location === "c" ? (h - height) / 2 : location.startsWith("t") ? margin : h - height - margin;
  ctx.save();
  ctx.globalAlpha = Math.max(1, Math.min(100, $("opacity").valueAsNumber || 75)) / 100;
  if (logo) ctx.drawImage(logo.image, x + (width - iw) / 2, y, iw, ih);
  if (words) {
    ctx.font = "700 " + fontPx + "px " + $("font").value;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#212121"; ctx.fillStyle = "#faf8f3"; ctx.lineWidth = Math.max(1, fontPx * .13);
    const args = [words, x + width / 2, y + ih + textHeight / 2, width];
    ctx.strokeText(...args); ctx.fillText(...args);
  }
  ctx.restore();
}

function paint(canvas, photo, factor = 1, picture = main) {
  const w = Math.max(1, Math.round(picture.width * factor));
  const h = Math.max(1, Math.round(picture.height * factor));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas === preview ? context : canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  watermark(ctx, photo, w, h);
  return ctx;
}

function refresh() {
  const ready = Boolean(main);
  preview.hidden = !ready;
  $("frame-note").hidden = !main?.frames || main.frames.length <= 1;
  $("download").disabled = busy || loading.size > 0 || !ready || (!$("text").value.trim() && !logo);
  if (!ready) return;
  const player = main.frames ? gifPlayer(main) : null;
  try {
    const picture = player ? player.frame(main.frames[0]) : main.image;
    const factor = Math.min(1, 680 / Math.max(main.width, main.height));
    paint(preview, picture, factor);
  } finally { player?.clear(); }
}

for (const id of ["file", "logo"]) $(id).addEventListener("change", async () => {
  const version = state[id] = (state[id] || 0) + 1;
  const selected = [...$(id).files];
  const [file, ...other] = selected;
  loading.add(id);
  $("download").disabled = true;
  try {
    if (selected.length > 16 || selected.reduce((sum, item) => sum + item.size, 0) > 90 * 1024 ** 2) {
      throw new Error("Bir seferde toplam 90 MB’ı geçmeyen en fazla 16 görsel seç.");
    }
    status(file ? "Görsel hazırlanıyor…" : "");
    const image = file ? await readPicture(file, id === "file") : undefined;
    if (state[id] !== version) { image?.image?.close?.(); return; }
    if (id === "file") {
      main?.image?.close?.(); main = image; queued = other;
      $("file-selection").textContent = other.length ? selected.length + " görsel seçildi. İlk görsel önizlenir." : "";
    }
    if (id === "logo") { logo?.image.close?.(); logo = image; }
    status("");
  } catch (error) {
    if (state[id] !== version) return;
    $(id).value = "";
    if (id === "file") { main?.image?.close?.(); main = null; queued = []; $("file-selection").textContent = ""; }
    if (id === "logo") { logo?.image.close?.(); logo = null; }
    status(error.message || "Görsel açılamadı.");
  } finally {
    if (state[id] === version) { loading.delete(id); refresh(); }
  }
});
for (const id of ["text", "position", "font", "size", "opacity"]) $(id).addEventListener("input", refresh);

async function exportGif(canvas, picture) {
  const { GIFEncoder, quantize, applyPalette } = await import("/video/vendor/gifenc.js");
  const player = gifPlayer(picture), gif = GIFEncoder();
  try {
    for (const [index, frame] of picture.frames.entries()) {
      const ctx = paint(canvas, player.frame(frame), 1, picture);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true, clearAlpha: true });
      const transparentIndex = palette.findIndex(color => color[3] === 0);
      gif.writeFrame(applyPalette(rgba, palette, "rgba4444"), canvas.width, canvas.height, {
        palette, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex),
        delay: frame.delay, dispose: 2, repeat: picture.repeat,
      });
      if (index % 4 === 0) { status((index + 1) + " / " + picture.frames.length + " kare…"); await pause(); }
    }
    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
  } finally { player.clear(); }
}

async function exportPicture(canvas, picture) {
  let blob;
  if (picture.frames) blob = await exportGif(canvas, picture);
  else {
    paint(canvas, picture.image, 1, picture);
    blob = await new Promise(resolve => canvas.toBlob(resolve, picture.type, .94));
  }
  if (!blob) throw new Error("Görsel kodlanamadı.");
  const ext = blob.type === "image/gif" ? "gif" : blob.type === "image/jpeg" ? "jpg" : "png";
  const base = picture.name.replace(/\.[^.]+$/, "") || "gorsel";
  return { blob, name: base + "-filigran." + ext };
}

function loadZip() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "../vendor/jszip.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("ZIP aracı yüklenemedi."));
    document.head.append(script);
  });
}

async function exportBatch(canvas) {
  zipReady ??= loadZip().catch(error => { zipReady = undefined; throw error; });
  await zipReady;
  const zip = new window.JSZip();
  const first = await exportPicture(canvas, main);
  zip.file(first.name, first.blob);
  const skipped = [];
  for (const [i, file] of queued.entries()) {
    let picture;
    try {
      status((i + 2) + " / " + (queued.length + 1) + " görsel…");
      picture = await readPicture(file, true);
      const output = await exportPicture(canvas, picture);
      let name = output.name;
      if (zip.file(name)) name = (i + 2) + "-" + name;
      zip.file(name, output.blob);
    } catch { skipped.push(file.name); }
    finally { picture?.image?.close?.(); }
  }
  download(await zip.generateAsync({ type: "blob" }), "filigranli-gorseller.zip");
  return skipped.length ? "ZIP hazır. İşlenemeyen görseller " + skipped.join(", ") : "ZIP indirilmeye hazır.";
}

$("download").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  for (const input of document.querySelectorAll("input, select")) input.disabled = true;
  $("download").disabled = true;
  status("Görsel kaydediliyor…");
  const canvas = document.createElement("canvas");
  try {
    if (queued.length) status(await exportBatch(canvas));
    else {
      const { blob, name } = await exportPicture(canvas, main);
      download(blob, name);
      status("Görsel indirilmeye hazır.");
    }
  } catch (error) { status(error.message || "Görsel kaydedilemedi."); }
  finally {
    canvas.width = canvas.height = 0;
    busy = false;
    for (const input of document.querySelectorAll("input, select")) input.disabled = false;
    refresh();
  }
});
refresh();
