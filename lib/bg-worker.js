// Arka plan silme modeli (ISNet, fp16) — ayrı bir işçide çalışır, sayfa donmaz.
import * as ort from "../vendor/ort/ort.webgpu.bundle.min.mjs";

const MODEL_PARTS = 22;
const MODEL_SIZE = 88188479;
const CACHE = "foto-model-isnet-fp16-v1";
const SIZE = 1024;

ort.env.wasm.wasmPaths = new URL("../vendor/ort/", import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
ort.env.logLevel = "error";

let session = null;
let backend = null;
let modelBytes = null;

async function fetchPart(i, cache) {
  const url = new URL(`../model/isnet-fp16.part${String(i).padStart(2, "0")}`, import.meta.url).href;
  let res = cache ? await cache.match(url) : null;
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error("Model indirilemedi");
    if (cache) await cache.put(url, res.clone()).catch(() => {});
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function loadModel() {
  if (modelBytes) return modelBytes;
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) {}
  const out = new Uint8Array(MODEL_SIZE);
  let done = 0, offset = 0;
  // 4'erli gruplar halinde indir (sıra korunur)
  for (let i = 0; i < MODEL_PARTS; i += 4) {
    const idx = [...Array(Math.min(4, MODEL_PARTS - i)).keys()].map((k) => i + k);
    const parts = await Promise.all(idx.map((k) => fetchPart(k, cache)));
    for (const p of parts) { out.set(p, offset); offset += p.length; done++; }
    postMessage({ type: "progress", stage: "model", frac: done / MODEL_PARTS });
  }
  if (offset !== MODEL_SIZE) throw new Error("Model dosyası eksik indi, sayfayı yenileyip tekrar dene");
  modelBytes = out;
  return out;
}

async function makeSession(ep) {
  const bytes = await loadModel();
  return ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: "all" });
}

async function infer(input) {
  const tensor = new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]);
  const r = await session.run({ input: tensor }, ["output"]);
  return r.output.data;
}

const bad = (d) => { for (let i = 0; i < d.length; i += 997) if (!Number.isFinite(d[i])) return true; return false; };

async function run(input) {
  if (!session) {
    postMessage({ type: "progress", stage: "prepare" });
    // ekran kartı gerçekten kullanılabiliyorsa dene
    let adapter = null;
    try { adapter = "gpu" in navigator ? await navigator.gpu.requestAdapter() : null; } catch (e) {}
    if (adapter && adapter.features.has("shader-f16")) {
      try { session = await makeSession("webgpu"); backend = "webgpu"; } catch (e) { session = null; }
    }
    if (!session) { session = await makeSession("wasm"); backend = "wasm"; }
  }
  postMessage({ type: "progress", stage: "run", backend });
  let out;
  try {
    out = await infer(input);
    if (backend === "webgpu" && bad(out)) throw new Error("gpu sonucu bozuk");
  } catch (e) {
    if (backend !== "webgpu") throw e;
    // ekran kartı sorun çıkarırsa işlemciyle tekrar dene
    session = await makeSession("wasm"); backend = "wasm";
    postMessage({ type: "progress", stage: "run", backend });
    out = await infer(input);
  }
  const mask = new Uint8ClampedArray(SIZE * SIZE);
  for (let i = 0; i < mask.length; i++) mask[i] = out[i] * 255 + 0.5;
  return mask;
}

self.onmessage = async (e) => {
  const { id, input } = e.data;
  try {
    const mask = await run(input);
    postMessage({ type: "done", id, mask }, [mask.buffer]);
  } catch (err) {
    postMessage({ type: "error", id, message: String(err && err.message || err) });
  }
};
