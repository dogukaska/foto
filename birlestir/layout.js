const MAX_SIDE = 4096;
const MAX_PIXELS = 12_000_000;

export function composeLayout(images, layout, columns, gap) {
  const width = Math.max(...images.map(image => image.width));
  const height = Math.max(...images.map(image => image.height));
  let positions;
  let totalWidth;
  let totalHeight;
  if (layout === "grid") {
    const count = Math.min(images.length, columns);
    positions = images.map((image, index) => {
      const factor = Math.min(width / image.width, height / image.height);
      const w = image.width * factor;
      const h = image.height * factor;
      return {
        x: (index % count) * (width + gap) + (width - w) / 2,
        y: Math.floor(index / count) * (height + gap) + (height - h) / 2,
        w, h,
      };
    });
    const rows = Math.ceil(images.length / count);
    totalWidth = count * (width + gap) - gap;
    totalHeight = rows * (height + gap) - gap;
  } else {
    const row = layout === "horizontal";
    let offset = 0;
    positions = images.map(image => {
      const w = row ? image.width * height / image.height : width;
      const h = row ? height : image.height * width / image.width;
      const position = { x: row ? offset : 0, y: row ? 0 : offset, w, h };
      offset += (row ? w : h) + gap;
      return position;
    });
    totalWidth = row ? offset - gap : width;
    totalHeight = row ? height : offset - gap;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(totalWidth, totalHeight), Math.sqrt(MAX_PIXELS / (totalWidth * totalHeight)));
  return {
    width: Math.max(1, Math.round(totalWidth * scale)),
    height: Math.max(1, Math.round(totalHeight * scale)),
    positions: positions.map(({ x, y, w, h }) => ({ x: x * scale, y: y * scale, w: w * scale, h: h * scale })),
  };
}
