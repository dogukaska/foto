import { $, download } from "/gunluk/common.js?v=1";
import { cleanJpeg, exifSummary, readJpeg } from "./jpeg.js?v=1";

const file = $("file");
const result = $("result");
const status = $("status");
const save = $("download");
const fields = ["gps", "date", "device"].map($);
let opened;
let generation = 0;

function update() {
  save.disabled = !opened || !fields.some(field => field.checked);
}

file.addEventListener("change", async () => {
  const current = ++generation;
  const input = file.files[0];
  opened = undefined;
  result.hidden = true;
  status.textContent = "";
  update();
  if (!input) return;
  status.textContent = "Fotoğraf okunuyor…";
  try {
    const parts = readJpeg(new Uint8Array(await input.arrayBuffer()));
    if (current !== generation) return;
    const summary = exifSummary(parts);
    for (const field of fields) {
      $(field.id + "-value").textContent = summary[field.id] || "EXIF’te bulunamadı";
      field.checked = true;
    }
    opened = { input, parts };
    result.hidden = false;
    status.textContent = "";
    update();
  } catch (error) {
    if (current === generation) status.textContent = error.message || "Fotoğraf okunamadı.";
  }
});

for (const field of fields) field.addEventListener("change", () => {
  status.textContent = "";
  update();
});

save.addEventListener("click", () => {
  if (!opened || save.disabled) return;
  try {
    const selection = Object.fromEntries(fields.map(field => [field.id, field.checked]));
    const blob = cleanJpeg(opened.parts, selection);
    const stem = opened.input.name.replace(/\.[^.]+$/, "") || "fotograf";
    download(blob, stem + "-temiz.jpg");
    status.textContent = "Temiz JPG indiriliyor.";
  } catch (error) {
    status.textContent = error.message || "Temiz JPG oluşturulamadı.";
  }
});
