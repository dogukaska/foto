// Arka plan silme: modele 1024×1024 giriş hazırlar, maskeyi fotoğrafın tam çözünürlüğüne uygular.
import { makeCanvas } from "./image.js";

const SIZE = 1024;
let worker = null;
let seq = 0;
const pending = new Map();
let onProgress = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./bg-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") return onProgress?.(m);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.type === "done" ? p.res(m.mask) : p.rej(new Error(m.message));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.rej(new Error("Arka plan motoru başlatılamadı. Tarayıcın güncel mi?"));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** bitmap → { canvas (tam boy, şeffaf arka planlı), mask } */
export async function removeBackground(bitmap, progress) {
  onProgress = progress;
  // 1) modele giriş (1024×1024, oran gözetmeden, kaliteli küçültme)
  const small = makeCanvas(SIZE, SIZE);
  const sc = small.getContext("2d", { willReadFrequently: true });
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = "high";
  sc.fillStyle = "#fff";
  sc.fillRect(0, 0, SIZE, SIZE);
  sc.drawImage(bitmap, 0, 0, SIZE, SIZE);
  const px = sc.getImageData(0, 0, SIZE, SIZE).data;
  const N = SIZE * SIZE;
  const input = new Float32Array(3 * N);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    input[j] = (px[i] - 128) / 256;
    input[j + N] = (px[i + 1] - 128) / 256;
    input[j + 2 * N] = (px[i + 2] - 128) / 256;
  }
  small.width = small.height = 0;

  // 2) model
  const id = ++seq;
  const w = getWorker();
  const mask = await new Promise((res, rej) => {
    pending.set(id, { res, rej });
    w.postMessage({ id, input }, [input.buffer]);
  });

  // 3) maske → tam çözünürlük
  const mc = makeCanvas(SIZE, SIZE);
  const mx = mc.getContext("2d");
  const md = mx.createImageData(SIZE, SIZE);
  for (let i = 0; i < N; i++) { md.data[i * 4 + 3] = mask[i]; }
  mx.putImageData(md, 0, 0);

  const out = makeCanvas(bitmap.width, bitmap.height);
  const ox = out.getContext("2d");
  ox.drawImage(bitmap, 0, 0);
  ox.globalCompositeOperation = "destination-in";
  ox.imageSmoothingEnabled = true;
  ox.imageSmoothingQuality = "high";
  ox.drawImage(mc, 0, 0, bitmap.width, bitmap.height);
  ox.globalCompositeOperation = "source-over";
  mc.width = mc.height = 0;
  return out;
}

/** Şeffaf sonucu istenen arka plan rengiyle birleştirir (renk yoksa aynısını döner) */
export function withBackground(cut, color) {
  if (!color) return cut;
  const c = makeCanvas(cut.width, cut.height);
  const cx = c.getContext("2d");
  cx.fillStyle = color;
  cx.fillRect(0, 0, c.width, c.height);
  cx.drawImage(cut, 0, 0);
  return c;
}

/** Ana nesnenin etrafındaki boşlukları kırpar */
export function trimToSubject(cut, pad = 0.02) {
  const W = cut.width, H = cut.height;
  // hız için küçük bir kopyada ara
  const s = Math.min(1, 800 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const t = makeCanvas(w, h);
  const tx = t.getContext("2d", { willReadFrequently: true });
  tx.drawImage(cut, 0, 0, w, h);
  const d = tx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  t.width = t.height = 0;
  if (x1 < 0) return cut;
  const p = Math.round(Math.max(W, H) * pad);
  const X0 = Math.max(0, Math.floor(x0 / s) - p), Y0 = Math.max(0, Math.floor(y0 / s) - p);
  const X1 = Math.min(W, Math.ceil((x1 + 1) / s) + p), Y1 = Math.min(H, Math.ceil((y1 + 1) / s) + p);
  const c = makeCanvas(X1 - X0, Y1 - Y0);
  c.getContext("2d").drawImage(cut, X0, Y0, X1 - X0, Y1 - Y0, 0, 0, X1 - X0, Y1 - Y0);
  return c;
}
