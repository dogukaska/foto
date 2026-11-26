import {decode,download,baseName} from "../lib/image.js?v=2";
const $ = (id) => document.getElementById(id);
const canvas = $("preview");
let bitmap, name, crop, masks = [], history = [], tool = "redact", start, current, request = 0;

function snapshot() { history.push({crop:{...crop},masks:[...masks]}); }
function paint(target, preview) {
  const ctx = target.getContext("2d");
  const sx = target.width/crop.w, sy = target.height/crop.h;
  ctx.setTransform(sx,0,0,sy,0,0);
  ctx.drawImage(bitmap,crop.x,crop.y,crop.w,crop.h,0,0,crop.w,crop.h);
  ctx.fillStyle = "#171717";
  for (const box of masks) ctx.fillRect(box.x-crop.x,box.y-crop.y,box.w,box.h);
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
  snapshot();
  if (tool === "crop") crop=area; else masks.push(area);
  $("status").textContent = tool === "crop" ? "Görsel kırpıldı." : "Alan opak renkle kapatıldı.";
  draw();
}
$("file").addEventListener("change",async () => {
  const file = $("file").files[0];
  const id = ++request;
  $("file").value = "";
  if (!file) return;
  bitmap?.close?.();
  bitmap = null;
  $("editor").hidden = true;
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
    $("status").textContent = crop.w+" × "+crop.h+" piksel";
    draw();
  } catch (e) { if (id===request) $("status").textContent = e.message || "Görsel açılamadı."; }
});
for (const id of ["redact","crop"]) $(id).addEventListener("click",() => {
  tool = id;
  for (const key of ["redact","crop"]) $(key).setAttribute("aria-pressed",key === tool);
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
  ({crop,masks} = previous);
  $("status").textContent = "Son işlem geri alındı.";
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
