import {decode,encode,download,fitCanvas,makeCanvas,baseName} from "../lib/image.js?v=3";
const $ = (id) => document.getElementById(id);
let ready, previewUrl;
function reset() {
  ready = null;
  $("download").disabled = true;
  $("preview").hidden = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
}
$("file").addEventListener("change",() => {
  reset();
  $("run").disabled = !$("file").files.length;
  $("status").textContent = "";
});
for (const id of ["format","limit"]) $(id).addEventListener("input",reset);
$("run").addEventListener("click",async () => {
  const file = $("file").files[0];
  const limit = Number($("limit").value);
  if (!file || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    $("status").textContent = "1 ile 10000 arasında tam bir KB değeri gir.";
    return;
  }
  const format = $("format").value;
  const bytes = limit * 1000;
  const controls = ["run","file","limit","format"];
  controls.forEach(id => { $(id).disabled = true; });
  reset();
  $("status").textContent = "Görsel hazırlanıyor…";
  let bitmap, source, resized;
  try {
    if (!file.size || file.size > 60 * 1024 * 1024) throw Error("60 MB’tan küçük, geçerli bir görsel seç.");
    const decoded = await decode(file);
    bitmap = decoded.bitmap;
    source = makeCanvas(decoded.width,decoded.height);
    source.getContext("2d").drawImage(bitmap,0,0);
    bitmap.close?.(); bitmap = null;
    const mime = format === "webp" ? "image/webp" : "image/jpeg";
    let side = Math.max(source.width,source.height);
    while (side >= 1) {
      resized = fitCanvas(source,side);
      const lowest = await encode(resized,format,.06);
      if (lowest.blob.type !== mime) throw Error("Tarayıcı bu biçime yazamıyor. JPG’yi dene.");
      if (lowest.blob.size <= bytes) {
        let best = lowest, lower = .06, upper = 1;
        for (let i=0;i<8;i++) {
          const quality = (lower+upper)/2;
          const attempt = await encode(resized,format,quality);
          if (attempt.blob.size <= bytes) { best=attempt; lower=quality; } else upper=quality;
        }
        ready = {blob:best.blob,name:baseName(file.name)+"."+best.ext};
        $("status").textContent = (ready.blob.size/1000).toLocaleString("tr",{maximumFractionDigits:2})+" KB · "+resized.width+" × "+resized.height+" piksel";
        previewUrl = URL.createObjectURL(ready.blob);
        $("preview").src = previewUrl;
        $("preview").hidden = false;
        $("download").disabled = false;
        return;
      }
      if (resized !== source) resized.width = resized.height = 0;
      resized = null;
      if (side === 1) break;
      side = Math.max(1,Math.floor(side * .72));
    }
    throw Error("Bu biçim için boyut sınırı çok düşük.");
  } catch (e) { $("status").textContent = e.message || "Görsel küçültülemedi."; }
  finally {
    bitmap?.close?.();
    if (resized) resized.width = resized.height = 0;
    if (source) source.width = source.height = 0;
    controls.forEach(id => { $(id).disabled = false; });
  }
});
$("download").addEventListener("click",() => ready && download(ready.blob,ready.name));
