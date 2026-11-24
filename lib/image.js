// Fotoğraf okuma (HEIC dahil) ve kaydetme yardımcıları

const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// iPhone/iPad tarayıcıları çok büyük tuvalleri çizemez
export const MAX_PIXELS = IOS ? 16_000_000 : 120_000_000;

export const FORMATS = {
  jpg: { mime: "image/jpeg", ext: "jpg", label: "JPG", alpha: false, lossy: true },
  png: { mime: "image/png", ext: "png", label: "PNG", alpha: true, lossy: false },
  webp: { mime: "image/webp", ext: "webp", label: "WebP", alpha: true, lossy: true },
};

export function isHeicName(file) {
  return /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
}

async function sniffHeic(file) {
  const b = new Uint8Array(await file.slice(4, 12).arrayBuffer());
  const s = String.fromCharCode(...b);
  return s.startsWith("ftyp") && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(s.slice(4));
}

let heicMod = null;
async function heicToBitmap(file) {
  heicMod ??= await import("../vendor/heic-to.js");
  return heicMod.heicTo({ blob: file, type: "bitmap", options: { imageOrientation: "from-image" } });
}

/** Her türlü fotoğrafı açar. {bitmap, width, height, scaled} döner. */
export async function decode(file) {
  let bmp = null;
  if (isHeicName(file) || (await sniffHeic(file))) {
    try { bmp = await heicToBitmap(file); } catch (e) {
      // Safari HEIC'i kendisi de açabiliyor
      try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e2) {}
      if (!bmp) throw new Error("HEIC dosyası açılamadı");
    }
  } else {
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) { bmp = await viaImg(file); }
  }
  let scaled = false;
  if (bmp.width * bmp.height > MAX_PIXELS) {
    const f = Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height));
    const w = Math.floor(bmp.width * f), h = Math.floor(bmp.height * f);
    const small = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    bmp.close?.();
    bmp = small;
    scaled = true;
  }
  return { bitmap: bmp, width: bmp.width, height: bmp.height, scaled };
}

function viaImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => { try { res(await createImageBitmap(img)); } catch (e) { rej(e); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bu dosya bir fotoğraf olarak açılamadı")); };
    img.src = url;
  });
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

/** Tuvali seçilen biçimde kaydeder. Şeffaf alanlar JPG'de `bg` rengiyle doldurulur. */
export async function encode(source, fmt, quality = 0.95, bg = "#ffffff") {
  const F = FORMATS[fmt];
  let canvas = source;
  if (!F.alpha) {
    canvas = makeCanvas(source.width, source.height);
    const cx = canvas.getContext("2d");
    cx.fillStyle = bg;
    cx.fillRect(0, 0, canvas.width, canvas.height);
    cx.drawImage(source, 0, 0);
  }
  const blob = await new Promise((r) => canvas.toBlob(r, F.mime, F.lossy ? quality : undefined));
  if (canvas !== source) canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Fotoğraf kaydedilemedi (çok büyük olabilir)");
  // Bazı tarayıcılar (eski Safari) WebP yazamaz, PNG verir
  const actual = Object.keys(FORMATS).find((k) => FORMATS[k].mime === blob.type) || fmt;
  return { blob, ext: FORMATS[actual].ext, fallback: actual !== fmt };
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, "") || "foto";
}

export function fmtSize(b) {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
