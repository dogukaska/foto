import { decode, encode, FORMATS, baseName, fmtSize, download, makeCanvas, fitCanvas } from "./lib/image.js?v=3";
import { removeBackground, withBackground, trimToSubject } from "./lib/bg.js";

const $ = (id) => document.getElementById(id);
const svg = (p) => `<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON_DL = svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>');
const ICON_X = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

// ---------- Sekmeler
const tabs = [...document.querySelectorAll(".tab")];
tabs.forEach((t) => t.addEventListener("click", () => {
  for (const button of tabs) {
    const selected = button === t;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected);
    button.tabIndex = selected ? 0 : -1;
  }
  $("tab-bg").classList.toggle("hidden", t.dataset.tab !== "bg");
  $("tab-conv").classList.toggle("hidden", t.dataset.tab !== "conv");
}));
tabs[0].parentElement.addEventListener("keydown", (event) => {
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  let next;
  if (event.key === "Home") next = tabs[0];
  else if (event.key === "End") next = tabs.at(-1);
  else if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
  else if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
  else return;
  event.preventDefault();
  next.focus();
  next.click();
});


function segment(el, attr, onChange) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !el.contains(b)) return;
    el.querySelectorAll("button, .colorbtn").forEach((x) => x.classList.toggle("on", x === b));
    onChange(b.dataset[attr]);
  });
}

function dropZone(el, input, onFiles) {
  input.addEventListener("change", () => { if (input.files.length) onFiles([...input.files]); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove("over"); }));
  el.addEventListener("drop", (e) => { const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); });
}

// Yapıştırma (Ctrl+V) ile fotoğraf ekleme
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  if (!$("tab-bg").classList.contains("hidden")) bgStart(files[0]); else cvAdd(files);
});

// =====================================================================
// ARKA PLAN SİLME
// =====================================================================
const bg = { file: null, bitmap: null, cut: null, color: "", fmt: "png", view: "after", trim: false };
let bgRequest = 0;

dropZone($("bg-drop"), $("bg-file"), (files) => bgStart(files[0]));

function bgStatus(text, frac, note) {
  $("bg-status").textContent = text;
  if (frac != null) $("bg-bar").style.width = `${Math.round(frac * 100)}%`;
  if (note != null) $("bg-note").textContent = note;
}

async function bgStart(file) {
  const request = ++bgRequest;
  $("bg-drop").classList.add("hidden");
  $("bg-result").classList.add("hidden");
  $("bg-work").classList.remove("hidden");
  $("bg-work").querySelector(".spinner").style.visibility = "";
  bgStatus("Fotoğraf açılıyor…", 0.02, "");
  bg.bitmap?.close?.();
  bg.bitmap = null;
  bg.cut = null;
  let img;
  try {
    img = await decode(file);
    if (request !== bgRequest) return;
    const t0 = performance.now();
    const cut = await removeBackground(img.bitmap, (m) => {
      if (request !== bgRequest) return;
      if (m.stage === "model") {
        bgStatus(`Yapay zeka modeli indiriliyor… %${Math.round(m.frac * 100)}`, 0.05 + m.frac * 0.6,
          "Yalnızca ilk kullanımda indirilir (88 MB). Sonraki seferlerde hazır olur.");
      } else if (m.stage === "prepare") {
        bgStatus("Model hazırlanıyor…", 0.7);
      } else if (m.stage === "run") {
        bgStatus("Arka plan siliniyor…", 0.8, m.backend === "webgpu"
          ? "Ekran kartı kullanılıyor."
          : "İşlemci kullanılıyor, 10–30 saniye sürebilir.");
      }
    });
    if (request !== bgRequest) {
      cut.width = cut.height = 0;
      return;
    }
    bg.bitmap = img.bitmap;
    bg.file = file;
    bg.cut = cut;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    bg.info = `${img.width} × ${img.height} piksel · ${secs} sn${img.scaled ? " · fotoğraf bu cihaz için çok büyüktü, küçültüldü" : ""}`;
    $("bg-work").classList.add("hidden");
    $("bg-result").classList.remove("hidden");
    bgRender();
  } catch (e) {
    if (request !== bgRequest) return;
    console.error(e);
    bgStatus("Olmadı: " + (e.message || e), 0, "Başka bir fotoğraf deneyebilir ya da sayfayı yenileyebilirsin.");
    $("bg-work").querySelector(".spinner").style.visibility = "hidden";
    $("bg-drop").classList.remove("hidden");
  } finally {
    if (img?.bitmap !== bg.bitmap) img?.bitmap.close?.();
  }
}

function bgFinal() {
  let c = bg.cut;
  if (bg.trim) c = trimToSubject(c);
  const color = bg.color || (bg.fmt === "jpg" ? "#ffffff" : "");
  return withBackground(c, color);
}

function bgRender() {
  $("bg-work").querySelector(".spinner").style.visibility = "";
  const src = bg.view === "before" ? bg.bitmap : bgFinal();
  const max = 1600;
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const cv = $("bg-canvas");
  cv.width = Math.max(1, Math.round(src.width * s));
  cv.height = Math.max(1, Math.round(src.height * s));
  const cx = cv.getContext("2d");
  cx.imageSmoothingQuality = "high";
  cx.clearRect(0, 0, cv.width, cv.height);
  cx.drawImage(src, 0, 0, cv.width, cv.height);
  const notes = {
    png: "PNG şeffaflığı korur, kalite kaybı olmaz.",
    webp: "WebP şeffaflığı korur, dosya PNG'den küçüktür.",
    jpg: bg.color ? "JPG şeffaflık desteklemez; seçtiğin renk arka plan olur." : "JPG şeffaflık desteklemez; arka plan beyaz olur.",
  };
  $("bg-fmt-note").textContent = notes[bg.fmt];
  $("bg-info").textContent = bg.info || "";
}

segment($("bg-view"), "v", (v) => { bg.view = v; bgRender(); });
segment($("bg-fmt"), "f", (f) => { bg.fmt = f; bgRender(); });
segment($("bg-color"), "c", (c) => { bg.color = c; bgRender(); });
$("bg-custom").addEventListener("click", (e) => { bg.color = e.target.value; markCustom(); bgRender(); });
function markCustom() {
  $("bg-color").querySelectorAll("button, .colorbtn").forEach((x) => x.classList.toggle("on", x.classList.contains("colorbtn")));
}
$("bg-custom").addEventListener("input", (e) => {
  bg.color = e.target.value;
  $("bg-color").querySelectorAll("button, .colorbtn").forEach((x) => x.classList.toggle("on", x.classList.contains("colorbtn")));
  bgRender();
});
$("bg-trim").addEventListener("change", (e) => { bg.trim = e.target.checked; bgRender(); });

$("bg-download").addEventListener("click", async () => {
  const btn = $("bg-download");
  btn.disabled = true;
  try {
    const out = bgFinal();
    const name = baseName(bg.file.name);
    const { blob, ext, fallback } = await encode(out, bg.fmt, 0.97);
    download(blob, `${name}-arkaplansiz.${ext}`);
    if (fallback) alert("Bu tarayıcı WebP kaydedemiyor, PNG olarak indirildi.");
  } catch (e) {
    alert(e.message || e);
  } finally { btn.disabled = false; }
});

$("bg-again").addEventListener("click", () => {
  $("bg-result").classList.add("hidden");
  $("bg-drop").classList.remove("hidden");
  $("bg-file").click();
});

// =====================================================================
// FORMAT DÖNÜŞTÜRME
// =====================================================================
const cv = { items: [], fmt: "jpg", q: 0.95, size: 0, busy: false };
let uid = 0;

dropZone($("cv-drop"), $("cv-file"), cvAdd);

const cvNotes = {
  jpg: "JPG her yerde açılır. Şeffaf alanlar beyaz olur.",
  png: "PNG kayıpsızdır ve şeffaflığı korur; dosya büyük olur.",
  webp: "WebP hem kaliteli hem küçüktür, şeffaflığı korur. Web siteleri için çok uygun.",
  avif: "AVIF en küçük dosyayı verir (JPG'nin yarısı kadar), şeffaflığı korur. Yeni telefon ve tarayıcılar açar; yavaş hazırlanır.",
};
segment($("cv-fmt"), "f", (f) => {
  cv.fmt = f;
  $("cv-q-row").classList.toggle("hidden", !FORMATS[f].lossy);
  $("cv-note").textContent = cvNotes[f];
  cvStale();
});
$("cv-q").addEventListener("change", (e) => { cv.q = parseFloat(e.target.value); cvStale(); });
$("cv-size").addEventListener("change", (e) => { cv.size = parseInt(e.target.value, 10); cvStale(); });

function typeLabel(f) {
  const ext = (f.name.match(/\.([^.]+)$/) || [])[1];
  return (ext || f.type.replace("image/", "") || "?").toUpperCase();
}

function cvAdd(files) {
  for (const f of files) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="thumb"></div><div class="meta"><div class="name"></div><div class="info"></div></div><button class="dl hidden">${ICON_DL} İndir</button><button class="x" title="Listeden çıkar">${ICON_X}</button>`;
    li.querySelector(".name").textContent = f.name;
    const item = { id: ++uid, file: f, li, out: null };
    li.querySelector(".info").textContent = `${typeLabel(f)} · ${fmtSize(f.size)}`;
    li.querySelector(".x").addEventListener("click", () => { cv.items = cv.items.filter((x) => x !== item); li.remove(); cvButtons(); });
    li.querySelector(".dl").addEventListener("click", () => item.out && download(item.out.blob, item.out.name));
    cv.items.push(item);
    $("cv-list").append(li);
  }
  cvButtons();
}

function cvStale() {
  for (const it of cv.items) {
    it.failed = false;
    it.out = null;
    it.li.querySelector(".dl").classList.add("hidden");
    it.li.querySelector(".info").textContent = `${typeLabel(it.file)} · ${fmtSize(it.file.size)}`;
  }
  cvButtons();
}

function cvSummary() {
  const done = cv.items.filter((x) => x.out);
  const el = $("cv-sum");
  if (!done.length) { el.classList.add("hidden"); return; }
  const a = done.reduce((s, x) => s + x.file.size, 0), b = done.reduce((s, x) => s + x.out.blob.size, 0);
  const pct = Math.round((1 - b / a) * 100);
  el.textContent = `${done.length} fotoğraf: ${fmtSize(a)} → ${fmtSize(b)}${pct > 0 ? ` (%${pct} küçüldü)` : ""}`;
  el.classList.remove("hidden");
}

function cvButtons() {
  cvSummary();
  const done = cv.items.filter((x) => x.out).length;
  const pending = cv.items.some((x) => !x.out);
  $("cv-actions").classList.toggle("hidden", !cv.items.length && !cv.busy);
  $("cv-go").classList.toggle("hidden", !pending && !cv.busy);
  if (!cv.busy) $("cv-go").textContent = cv.items.some((x) => x.failed) ? "Kalanı yeniden dene" : "Dönüştür";
  $("cv-all").classList.toggle("hidden", !done);
  $("cv-all").innerHTML = ICON_DL + (done > 1 ? " Hazır olanları indir (ZIP)" : " Hazır olanı indir");
}

function uniqueNames(items) {
  const seen = new Set();
  for (const it of items) {
    let name = it.out.name;
    let suffix = 2;
    while (seen.has(name.toLowerCase())) {
      name = it.out.name.replace(/(\.[^.]+)$/, ` (${suffix++})$1`);
    }
    seen.add(name.toLowerCase());
    it.out.zipName = name;
  }
}

$("cv-go").addEventListener("click", async () => {
  if (cv.busy) return;
  const go = $("cv-go");
  const controls = [go, $("cv-all"), $("cv-q"), $("cv-size"), ...$("cv-fmt").querySelectorAll("button")];
  cv.busy = true;
  controls.forEach((control) => { control.disabled = true; });
  const { size, fmt, q } = cv;
  const todo = cv.items.filter((x) => !x.out);
  let i = 0;
  for (const it of todo) {
    i++;
    go.textContent = `Dönüştürülüyor… ${i}/${todo.length}`;
    const info = it.li.querySelector(".info");
    info.textContent = "Dönüştürülüyor…";
    try {
      const img = await decode(it.file);
      // önizleme
      const t = makeCanvas(108, 108);
      const tx = t.getContext("2d");
      const s = Math.max(108 / img.width, 108 / img.height);
      tx.drawImage(img.bitmap, (108 - img.width * s) / 2, (108 - img.height * s) / 2, img.width * s, img.height * s);
      const th = document.createElement("img");
      th.className = "thumb"; th.src = t.toDataURL("image/jpeg", 0.8); th.alt = "";
      it.li.querySelector(".thumb").replaceWith(th);
      // tam boy çiz ve kaydet
      const full = makeCanvas(img.width, img.height);
      full.getContext("2d").drawImage(img.bitmap, 0, 0);
      img.bitmap.close?.();
      const c = fitCanvas(full, size);
      if (fmt === "avif") info.textContent = "AVIF hazırlanıyor… (biraz sürebilir)";
      const { blob, ext, fallback } = await encode(c, fmt, q);
      const outW = c.width, outH = c.height;
      c.width = c.height = 0; full.width = full.height = 0;
      it.out = { blob, name: `${baseName(it.file.name)}.${ext}` };
      it.failed = false;
      const warn = [fallback ? "bu tarayıcı WebP yazamıyor, PNG yapıldı" : "", img.scaled ? "çok büyüktü, küçültüldü" : ""].filter(Boolean).join(" · ");
      const pct = Math.round((1 - blob.size / it.file.size) * 100);
      const gain = pct > 0 ? ` · %${pct} küçük` : pct < 0 ? ` · %${-pct} büyük` : "";
      const output = document.createElement("span");
      output.className = "ok";
      output.textContent = `${ext.toUpperCase()} ${fmtSize(blob.size)}`;
      info.replaceChildren(`${typeLabel(it.file)} ${fmtSize(it.file.size)} → `, output, `${gain} · ${outW}×${outH}`);
      if (warn) {
        const warning = document.createElement("span");
        warning.className = "warn";
        warning.textContent = warn;
        info.append(" · ", warning);
      }
      it.li.querySelector(".dl").classList.remove("hidden");
    } catch (e) {
      console.error(e);
      it.failed = true;
      const error = document.createElement("span");
      error.className = "err";
      error.textContent = `Açılamadı: ${e.message || "Bilinmeyen dosya"}`;
      info.replaceChildren(error);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  cv.busy = false;
  controls.forEach((control) => { control.disabled = false; });
  cvButtons();
});

$("cv-all").addEventListener("click", async () => {
  const done = cv.items.filter((x) => x.out);
  if (!done.length || cv.busy) return;
  if (done.length === 1) return download(done[0].out.blob, done[0].out.name);
  const btn = $("cv-all");
  btn.disabled = true;
  btn.textContent = "ZIP hazırlanıyor…";
  const extension = FORMATS[cv.fmt].ext;
  try {
    uniqueNames(done);
    const zip = new window.JSZip();
    for (const it of done) zip.file(it.out.zipName, it.out.blob);
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    download(blob, `fotograflar-${extension}.zip`);
  } catch (e) {
    alert("ZIP hazırlanamadı. Dosyaları tek tek indirmeyi dene.");
  } finally { btn.disabled = cv.busy; cvButtons(); }
});

$("cv-clear").addEventListener("click", () => {
  cv.items = [];
  $("cv-list").replaceChildren();
  cvButtons();
});
