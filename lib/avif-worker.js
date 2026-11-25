// AVIF kodlayıcı (Squoosh / jSquash, Apache-2.0). Yavaş olduğu için ayrı işçide çalışır.
import factory from "../vendor/avif/avif_enc.js";

let mod = null;
const base = new URL("../vendor/avif/", import.meta.url).href;
async function getMod() {
  mod ??= factory({ noInitialRun: true, locateFile: (f) => base + f });
  return mod;
}

self.onmessage = async (e) => {
  const { id, data, width, height, quality } = e.data;
  try {
    const m = await getMod();
    // quality: 0–100 (jSquash ölçeği); speed 6: kalite/hız dengesi
    const out = m.encode(new Uint8Array(data.buffer), width, height, {
      quality, qualityAlpha: -1, denoiseLevel: 0, tileColsLog2: 0, tileRowsLog2: 0, speed: 7,
      subsample: 1, chromaDeltaQ: false, sharpness: 0, tune: 0, enableSharpYUV: false, bitDepth: 8, lossless: false,
    });
    if (!out) throw new Error("AVIF oluşturulamadı");
    const buf = out.buffer.slice ? out.slice().buffer : out.buffer;
    postMessage({ id, ok: true, buf }, [buf]);
  } catch (err) {
    postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
