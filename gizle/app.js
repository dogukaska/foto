import {decode,download,baseName} from "../lib/image.js?v=3";
const $ = (id) => document.getElementById(id);
const canvas = $("preview");
let bitmap, name, crop, masks = [], history = [], tool = "blur", start, current, request = 0;
let faces = [], faceScan = 0;
const sample = document.createElement("canvas");

function blurArea(target, ctx, box, sx, sy) {
  const x = Math.max(0,Math.floor((box.x-crop.x)*sx));
  const y = Math.max(0,Math.floor((box.y-crop.y)*sy));
  const right = Math.min(target.width,Math.ceil((box.x+box.w-crop.x)*sx));
  const bottom = Math.min(target.height,Math.ceil((box.y+box.h-crop.y)*sy));
  const w = right-x, h = bottom-y;
  if (w < 1 || h < 1) return;
  const ratio = Math.min(.25, 12/Math.max(w,h));
  sample.width = Math.max(1, Math.round(w*ratio));
  sample.height = Math.max(1, Math.round(h*ratio));
  const smooth = sample.getContext("2d");
  smooth.imageSmoothingQuality = "high";
  smooth.drawImage(target,x,y,w,h,0,0,sample.width,sample.height);
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(x,y,w,h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sample,x,y,w,h);
  ctx.restore();
}

function clearFaces() {
  faceScan++;
  faces = [];
  $("blur-faces").hidden = $("clear-faces").hidden = true;
}

function snapshot() { history.push({crop:{...crop},masks:[...masks]}); }
function paint(target, preview) {
  const ctx = target.getContext("2d");
  const sx = target.width/crop.w, sy = target.height/crop.h;
  ctx.setTransform(sx,0,0,sy,0,0);
  ctx.clearRect(0,0,crop.w,crop.h);
  ctx.drawImage(bitmap,crop.x,crop.y,crop.w,crop.h,0,0,crop.w,crop.h);
  for (const box of masks) if (box.kind === "blur") blurArea(target,ctx,box,sx,sy);
  ctx.fillStyle = "#171717";
  for (const box of masks) if (box.kind === "redact") ctx.fillRect(box.x-crop.x,box.y-crop.y,box.w,box.h);
  if (preview && faces.length) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3/sx;
    ctx.shadowColor = "#171717";
    ctx.shadowBlur = 3;
    for (const box of faces) ctx.strokeRect(box.x-crop.x,box.y-crop.y,box.w,box.h);
    ctx.shadowBlur = 0;
  }
  if (preview && start && current) {
    const box = rectangle(start,current);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3/sx;
    ctx.strokeRect(box.x,box.y,box.w,box.h);
    ctx.strokeStyle = "#171717";
    ctx.lineWidth = 1/sx;
    ctx.strokeRect(box.x,box.y,box.w,box.h);
  }
}
function draw() {
  const scale = Math.min(1,960/Math.max(crop.w,crop.h));
  canvas.width = Math.max(1,Math.round(crop.w*scale));
  canvas.height = Math.max(1,Math.round(crop.h*scale));
  paint(canvas,true);
  $("undo").disabled = history.length === 0;
  $("download").disabled = history.length === 0;
}
function coordinates(event) {
  const rect = canvas.getBoundingClientRect();
  return {x:Math.max(0,Math.min(crop.w,Math.round((event.clientX-rect.left)*crop.w/rect.width))),
    y:Math.max(0,Math.min(crop.h,Math.round((event.clientY-rect.top)*crop.h/rect.height)))};
}
function rectangle(a,b) {
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)};
}
function apply(box) {
  if (!bitmap || !crop) return;
  const x = Math.max(0,Math.min(crop.w,box.x)), y = Math.max(0,Math.min(crop.h,box.y));
  const w = Math.min(crop.w-x,box.w), h = Math.min(crop.h-y,box.h);
  if (w < 1 || h < 1) {
    $("status").textContent = "Görselin içinde geçerli bir alan seç.";
    return;
  }
  const area = {x:crop.x+x,y:crop.y+y,w,h};
  clearFaces();
  snapshot();
  if (tool === "crop") crop=area; else masks.push({...area,kind:tool});
  const messages = {crop:"Görsel kırpıldı.",blur:"Alan bulanıklaştırıldı.",redact:"Alan opak renkle kapatıldı."};
  $("status").textContent = messages[tool];
  draw();
}
$("file").addEventListener("change",async () => {
  const file = $("file").files[0];
  const id = ++request;
  $("file").value = "";
  if (!file) return;
  bitmap?.close?.();
  bitmap = null;
  clearFaces();
  $("editor").hidden = true;
  $("find-faces").hidden = true;
  $("file-name").textContent = "";
  $("file-label").textContent = "Görsel seç";
  $("status").textContent = "Görsel açılıyor…";
  try {
    if (file.size > 60 * 1024 * 1024) throw Error("60 MB’tan küçük bir görsel seç.");
    const result = await decode(file);
    if (id !== request) { result.bitmap.close?.(); return; }
    bitmap = result.bitmap;
    name = baseName(file.name);
    crop = {x:0,y:0,w:result.width,h:result.height};
    masks = []; history = []; start = current = null;
    $("editor").hidden = false;
    $("find-faces").hidden = false;
    $("file-name").textContent = file.name;
    $("file-label").textContent = "Görsel değiştir";
    $("status").textContent = crop.w+" × "+crop.h+" piksel";
    draw();
  } catch (e) { if (id===request) $("status").textContent = e.message || "Görsel açılamadı."; }
});
for (const id of ["redact","blur","crop"]) $(id).addEventListener("click",() => {
  tool = id;
  for (const key of ["redact","blur","crop"]) $(key).setAttribute("aria-pressed",key === tool);
});
canvas.addEventListener("pointerdown",(e) => {
  if (!bitmap || e.button !== 0) return;
  start = current = coordinates(e);
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove",(e) => {
  if (!start) return;
  current = coordinates(e);
  paint(canvas,true);
});
canvas.addEventListener("pointerup",(e) => {
  if (!start) return;
  const box = rectangle(start,coordinates(e));
  start = current = null;
  apply(box);
  paint(canvas,true);
});
canvas.addEventListener("pointercancel",() => { start = current = null; if(bitmap) paint(canvas,true); });
$("rect").addEventListener("submit",(e) => {
  e.preventDefault();
  apply(Object.fromEntries(["x","y","w","h"].map(id => [id,Number($(id).value)])));
});
$("undo").addEventListener("click",() => {
  const previous = history.pop();
  if (!previous) return;
  clearFaces();
  ({crop,masks} = previous);
  $("status").textContent = "Son işlem geri alındı.";
  draw();
});

function detectFaces(pixels) {
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL("./face-worker.js?v=1",import.meta.url),{type:"module"});
    const finish = () => {clearTimeout(timer);worker.terminate();};
    const timer = setTimeout(() => {finish();reject(Error("Yüz araması zaman aşımına uğradı."));},30000);
    worker.onmessage = ({data}) => {
      finish();
      if (data.error) reject(Error("Yüz algılama motoru açılamadı. Alanı elle seçebilirsin."));
      else resolve(data.boxes);
    };
    worker.onerror = () => {finish();reject(Error("Yüz algılama çalışmadı. Alanı elle seçebilirsin."));};
    worker.postMessage(pixels,[pixels.buffer]);
  });
}

$("find-faces").addEventListener("click", async () => {
  if (!bitmap) return;
  clearFaces();
  const scan = faceScan;
  draw();
  $("find-faces").disabled = true;
  $("status").textContent = "Yüzler aranıyor…";
  const input = document.createElement("canvas");
  input.width = 320;
  input.height = 240;
  const ctx = input.getContext("2d",{willReadFrequently:true});
  ctx.fillStyle = "#fff";
  ctx.fillRect(0,0,320,240);
  ctx.drawImage(canvas,0,0,320,240);
  try {
    const boxes = await detectFaces(ctx.getImageData(0,0,320,240).data);
    if (scan !== faceScan) return;
    faces = boxes.map(box => {
      const padX = (box.right-box.left)*.13, padY = (box.bottom-box.top)*.15;
      const x = Math.floor(Math.max(0,box.left-padX)*crop.w);
      const y = Math.floor(Math.max(0,box.top-padY)*crop.h);
      const right = Math.ceil(Math.min(1,box.right+padX)*crop.w);
      const bottom = Math.ceil(Math.min(1,box.bottom+padY)*crop.h);
      return {x:crop.x+x,y:crop.y+y,w:right-x,h:bottom-y,kind:"blur"};
    });
    $("blur-faces").hidden = $("clear-faces").hidden = faces.length === 0;
    $("status").textContent = faces.length
      ? faces.length+" yüz bulundu. İşaretli alanları kontrol edip bulanıklaştırabilirsin."
      : "Yüz bulunamadı. İstersen alanı elle işaretle.";
    draw();
  } catch(error) {
    if (scan === faceScan) $("status").textContent = error.message;
  } finally { $("find-faces").disabled = false; }
});

$("blur-faces").addEventListener("click",() => {
  if (!faces.length) return;
  snapshot();
  masks.push(...faces);
  $("status").textContent = faces.length+" yüz bulanıklaştırıldı.";
  clearFaces();
  draw();
});
$("clear-faces").addEventListener("click",() => {
  clearFaces();
  $("status").textContent = "Yüz seçimi kaldırıldı.";
  draw();
});
$("download").addEventListener("click",() => {
  if (!bitmap || !history.length) return;
  const output = document.createElement("canvas");
  output.width=crop.w; output.height=crop.h;
  const filename=name+"-duzenlenmis.png";
  paint(output,false);
  output.toBlob(blob => {
    if (blob) download(blob,filename);
    else $("status").textContent = "PNG kaydedilemedi.";
    output.width=output.height=0;
  },"image/png");
});
