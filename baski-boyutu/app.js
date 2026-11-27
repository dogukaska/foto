import { $ } from "/gunluk/common.js?v=1";
import { readDimensions } from "../lib/image.js?v=4";

const cmPerInch = 2.54;
const decimals = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const integers = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const form = $("print-form");
const width = $("width");
const height = $("height");
const ppi = $("ppi");
const mode = $("mode");
const image = $("image");
const status = $("status");
let request = 0;

function dimension(input, pixels) {
  const raw = input.value.trim();
  const pattern = pixels ? /^\d+$/ : /^\d+(?:[.,]\d+)?$/;
  const value = Number(raw.replace(",", "."));
  if (!pattern.test(raw) || value <= 0 || value > 1_000_000) {
    throw new RangeError(pixels
      ? "Piksel ölçülerini 1 ile 1.000.000 arasında tam sayı olarak gir."
      : "Santimetre ölçülerini sıfırdan büyük ve en fazla 1.000.000 olarak gir.");
  }
  return value;
}

function calculate() {
  try {
    const pixels = mode.value === "print";
    const w = dimension(width, pixels), h = dimension(height, pixels);
    if (!ppi.value || !ppi.checkValidity()) return;
    const resolution = ppi.valueAsNumber;
    const pixelsFor = length => {
      const pixelsNeeded = length * resolution / cmPerInch;
      return Math.ceil(pixelsNeeded - Number.EPSILON * pixelsNeeded);
    };
    status.textContent = pixels
      ? "Baskı boyutu " + decimals.format(w / resolution * cmPerInch) + " × " + decimals.format(h / resolution * cmPerInch) + " cm."
      : "Gerekli piksel ölçüsü " + integers.format(pixelsFor(w)) + " × " + integers.format(pixelsFor(h)) + " px.";
  } catch (error) {
    status.textContent = error.message;
  }
}

form.addEventListener("input", event => {
  if (event.target === width || event.target === height) request++;
  status.textContent = "";
});
mode.addEventListener("change", () => {
  request++;
  const pixels = mode.value === "print";
  $("upload").hidden = !pixels;
  for (const input of [width, height]) {
    input.value = "";
    input.inputMode = pixels ? "numeric" : "decimal";
  }
  $("width-label").textContent = pixels ? "En (px)" : "En (cm)";
  $("height-label").textContent = pixels ? "Boy (px)" : "Boy (cm)";
  image.value = "";
  status.textContent = "";
});
image.addEventListener("change", async () => {
  const current = ++request;
  const file = image.files[0];
  if (!file) return;
  width.value = height.value = "";
  status.textContent = "Fotoğraf ölçüsü okunuyor…";
  try {
    const size = await readDimensions(file);
    if (current !== request) return;
    width.value = size.width;
    height.value = size.height;
    if (ppi.value && ppi.checkValidity()) calculate();
    else status.textContent = "Piksel ölçüleri okundu. Baskı çözünürlüğünü gir.";
  } catch {
    if (current === request) status.textContent = "Fotoğraf açılamadı. Piksel ölçülerini elle girebilirsin.";
  }
});
form.addEventListener("submit", event => {
  event.preventDefault();
  request++;
  calculate();
});
