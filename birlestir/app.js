import { $, download, element } from "/gunluk/common.js?v=1";
import { decode, encode, fitCanvas } from "../lib/image.js?v=4";
import { composeLayout } from "./layout.js?v=1";

const images = [];
const input = $("files");
const list = $("images");
const preview = $("preview");
const ctx = preview.getContext("2d");
const layout = $("layout");
const format = $("format");
const background = $("background");
const status = $("status");
const save = $("download");
const limit = 12;
let busy = false;

function release(bitmap) {
  if (bitmap instanceof HTMLCanvasElement) bitmap.width = 0;
  else bitmap.close?.();
}

function move(from, to, action) {
  [images[from], images[to]] = [images[to], images[from]];
  renderList();
  render();
  const buttons = list.children[to].querySelectorAll("button");
  (buttons[action].disabled ? buttons[1 - action] : buttons[action]).focus();
}

function makeButton(text, label, callback, disabled = false) {
  const button = element("button", text, { type: "button", "aria-label": label });
  button.disabled = disabled;
  button.addEventListener("click", callback);
  return button;
}

function renderList() {
  list.hidden = images.length === 0;
  list.replaceChildren(...images.map(({ name }, index) => {
    const item = element("li");
    const actions = element("div", undefined, { class: "image-actions" });
    actions.append(
      makeButton("↑", name + " görselini yukarı taşı", () => move(index, index - 1, 0), index === 0),
      makeButton("↓", name + " görselini aşağı taşı", () => move(index, index + 1, 1), index === images.length - 1),
      makeButton("Kaldır", name + " görselini kaldır", () => {
        const [removed] = images.splice(index, 1);
        release(removed.bitmap);
        status.textContent = "";
        renderList();
        render();
        if (images.length) list.children[Math.min(index, images.length - 1)].querySelector("button:last-child").focus();
        else input.focus();
      }),
    );
    item.append(element("span", name, { class: "image-name" }), actions);
    return item;
  }));
}

function render() {
  $("work").hidden = images.length < 2;
  if (images.length < 2) {
    preview.width = preview.height = 1;
    save.disabled = true;
    return;
  }
  $("columns-field").hidden = layout.value !== "grid";
  const transparent = format.value === "png";
  $("transparent").hidden = $("transparent").disabled = !transparent;
  if (!transparent && background.value === "transparent") background.value = "#ffffff";
  const gap = Math.max(0, Math.min(100, Math.round(Number($("gap").value))));
  const output = composeLayout(images, layout.value, Number($("columns").value), gap);
  preview.width = output.width;
  preview.height = output.height;
  ctx.imageSmoothingQuality = "high";
  if (background.value !== "transparent") {
    ctx.fillStyle = background.value;
    ctx.fillRect(0, 0, preview.width, preview.height);
  }
  output.positions.forEach(({ x, y, w, h }, index) => ctx.drawImage(images[index].bitmap, x, y, w, h));
  $("dimensions").textContent = output.width + " × " + output.height + " px";
  save.disabled = busy;
}

input.addEventListener("change", async () => {
  const files = Array.from(input.files);
  input.value = "";
  if (!files.length || busy) return;
  if (images.length + files.length > limit) {
    status.textContent = "Birleştirmek için en fazla 12 fotoğraf seç.";
    return;
  }
  const unreadable = [];
  busy = input.disabled = save.disabled = true;
  status.textContent = "Fotoğraflar hazırlanıyor…";
  for (const file of files) {
    let original;
    try {
      ({ bitmap: original } = await decode(file));
      const bitmap = fitCanvas(original, 1200);
      images.push({ name: file.name, width: bitmap.width, height: bitmap.height, bitmap });
      if (bitmap === original) original = undefined;
    } catch {
      unreadable.push(file.name);
    } finally {
      if (original) release(original);
    }
  }
  busy = input.disabled = false;
  status.textContent = unreadable.length ? "Açılamayan fotoğraflar: " + unreadable.join(", ") :
    images.length === 1 ? "Bir fotoğraf daha seç." : "";
  renderList();
  render();
});

for (const control of [layout, $("columns"), $("gap"), format, background]) control.addEventListener("input", render);

save.addEventListener("click", async () => {
  if (busy || images.length < 2) return;
  busy = input.disabled = save.disabled = true;
  try {
    const { blob, ext } = await encode(preview, format.value);
    download(blob, "birlesik-fotograf." + ext);
  } catch {
    status.textContent = "Görsel hazırlanamadı. Farklı bir düzen dene.";
  } finally {
    busy = input.disabled = false;
    save.disabled = images.length < 2;
  }
});
