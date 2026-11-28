const EXIF_HEADER = "Exif\0\0";
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
const EXIF = 0x8769;
const GPS = 0x8825;
const DATE_TAGS = new Set([0x0132, 0x9003, 0x9004, 0x9010, 0x9011, 0x9012, 0x9290, 0x9291, 0x9292]);
const DEVICE_TAGS = new Set([0x010f, 0x0110, 0x0131, 0xa420, 0xa430, 0xa431, 0xa432, 0xa433, 0xa434, 0xa435, 0xa436, 0xa437]);
// Only retain known TIFF/EXIF values. Pointer-based previews and opaque maker data
// can contain copies of the selected fields and cannot safely be copied.
const ROOT_TAGS = new Set([0x0100, 0x0101, 0x010f, 0x0110, 0x0112, 0x011a, 0x011b, 0x0128, 0x0131, 0x0132, 0x0211, 0x0212, 0x0213, 0x0214]);
const EXIF_TAGS = new Set([
  0x829a, 0x829d, 0x8822, 0x8827, 0x8830, 0x8831, 0x8832, 0x8833, 0x8834, 0x8835,
  0x9000, 0x9003, 0x9004, 0x9010, 0x9011, 0x9012, 0x9101, 0x9102,
  0x9201, 0x9202, 0x9203, 0x9204, 0x9205, 0x9206, 0x9207, 0x9208, 0x9209, 0x920a, 0x9214,
  0x9290, 0x9291, 0x9292, 0xa000, 0xa001, 0xa002, 0xa003,
  0xa20b, 0xa20e, 0xa20f, 0xa210, 0xa214, 0xa215, 0xa217,
  0xa300, 0xa301, 0xa302, 0xa401, 0xa402, 0xa403, 0xa404, 0xa405, 0xa406, 0xa407, 0xa408, 0xa409, 0xa40a, 0xa40c,
  0xa420, 0xa430, 0xa431, 0xa432, 0xa433, 0xa434, 0xa435, 0xa436, 0xa437,
]);
const rootError = "JPEG dosyası okunamadı.";
const exifError = "EXIF bilgisi okunamadı. Güvenli çıktı oluşturulamadı.";

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function startsWith(bytes, prefix) {
  return [...prefix].every((character, index) => bytes[index] === character.charCodeAt(0));
}

function nextMarker(bytes, offset) {
  for (let start = bytes.indexOf(0xff, offset); start >= 0;) {
    let position = start + 1;
    while (bytes[position] === 0xff) position++;
    const code = bytes[position];
    if (code !== undefined && code !== 0 && !(code >= 0xd0 && code <= 0xd7)) return start;
    start = bytes.indexOf(0xff, position + 1);
  }
  throw new Error(rootError);
}

export function readJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPG veya JPEG dosyası seç.");
  const parts = [{ raw: bytes.subarray(0, 2), code: 0xd8 }];
  const input = view(bytes);
  let position = 2;
  let hasScan = false;
  while (position < bytes.length) {
    const start = position;
    if (bytes[position++] !== 0xff) throw new Error(rootError);
    while (bytes[position] === 0xff) position++;
    const code = bytes[position++];
    if (code === 0xd9 && hasScan) {
      parts.push({ code, raw: bytes.subarray(start, position) });
      return parts;
    }
    if (code === 0x01) {
      parts.push({ code, raw: bytes.subarray(start, position) });
      continue;
    }
    if (!code || (code >= 0xd0 && code <= 0xd9) || position + 2 > bytes.length) throw new Error(rootError);
    const length = input.getUint16(position);
    const end = position + length;
    if (length < 2 || end > bytes.length) throw new Error(rootError);
    const data = bytes.subarray(position + 2, end);
    position = code === 0xda ? nextMarker(bytes, end) : end;
    if (code === 0xda) hasScan = true;
    const exif = code === 0xe1 && startsWith(data, EXIF_HEADER) ? readTiff(data.subarray(EXIF_HEADER.length)) : undefined;
    parts.push({ code, data, exif, raw: bytes.subarray(start, position) });
  }
  throw new Error(rootError);
}

function readTiff(bytes) {
  const input = view(bytes);
  const little = startsWith(bytes, "II");
  if (bytes.length < 14 || (!little && !startsWith(bytes, "MM")) || input.getUint16(2, little) !== 42) {
    throw new Error(exifError);
  }
  const u16 = offset => input.getUint16(offset, little);
  const u32 = offset => input.getUint32(offset, little);
  const directories = new Set();
  function directory(offset, accepts) {
    if (offset < 8 || offset + 2 > bytes.length || directories.has(offset)) throw new Error(exifError);
    directories.add(offset);
    const entries = [];
    const count = u16(offset);
    if (offset + 2 + count * 12 + 4 > bytes.length) throw new Error(exifError);
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const tag = u16(entry);
      if (!accepts(tag)) continue;
      const type = u16(entry + 2);
      const elements = u32(entry + 4);
      const size = TYPE_SIZE[type] * elements;
      if (!size || !Number.isSafeInteger(size)) throw new Error(exifError);
      const start = size <= 4 ? entry + 8 : u32(entry + 8);
      if (start < 8 || start + size > bytes.length) throw new Error(exifError);
      entries.push({ tag, type, count: elements, data: bytes.subarray(start, start + size) });
    }
    return entries;
  }
  const primary = directory(u32(4), tag => ROOT_TAGS.has(tag) || tag === EXIF || tag === GPS);
  function child(tag, accepts) {
    const pointer = primary.find(entry => entry.tag === tag);
    if (!pointer) return [];
    if (![4, 13].includes(pointer.type) || pointer.count !== 1) throw new Error(exifError);
    const offset = view(pointer.data).getUint32(0, little);
    return offset ? directory(offset, accepts) : [];
  }
  return {
    little,
    root: primary.filter(entry => entry.tag !== EXIF && entry.tag !== GPS),
    capture: child(EXIF, tag => EXIF_TAGS.has(tag)),
    location: child(GPS, tag => tag <= 31),
  };
}

function entryText(entries, tag) {
  const entry = entries.find(item => item.tag === tag && item.type === 2);
  return entry ? new TextDecoder().decode(entry.data).split("\0", 1)[0].trim() : "";
}

function coordinate(entries, reference, tag, little) {
  const direction = entryText(entries, reference).toUpperCase();
  const entry = entries.find(item => item.tag === tag && item.type === 5 && item.count === 3);
  if (!entry || !(reference === 1 ? /^[NS]$/ : /^[EW]$/).test(direction)) return NaN;
  const input = view(entry.data);
  const part = index => input.getUint32(index * 8, little) / input.getUint32(index * 8 + 4, little);
  const absolute = part(0) + part(1) / 60 + part(2) / 3600;
  return direction === "S" || direction === "W" ? -absolute : absolute;
}

export function exifSummary(parts) {
  const result = { gps: "", date: "", device: "" };
  for (const { exif } of parts) {
    if (!exif) continue;
    const { little, root, capture, location } = exif;
    if (!result.gps && location.length) {
      const lat = coordinate(location, 1, 2, little);
      const lon = coordinate(location, 3, 4, little);
      result.gps = Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? lat.toFixed(6) + ", " + lon.toFixed(6) : "Konum etiketi var";
    }
    if (!result.date) result.date = entryText(capture, 0x9003) || entryText(capture, 0x9004) ||
      entryText(root, 0x0132) || entryText(location, 29);
    if (!result.device) result.device = [...new Set([entryText(root, 0x010f), entryText(root, 0x0110)].filter(Boolean))].join(" ") ||
      entryText(capture, 0xa434) || entryText(root, 0x0131);
  }
  return result;
}

function segment(code, data) {
  if (data.length > 65533) throw new Error(exifError);
  const result = new Uint8Array(data.length + 4);
  result.set([0xff, code]);
  view(result).setUint16(2, data.length + 2);
  result.set(data, 4);
  return result;
}

function filterTiff(exif, selection) {
  const { little } = exif;
  const omit = entry => (selection.date && DATE_TAGS.has(entry.tag)) || (selection.device && DEVICE_TAGS.has(entry.tag));
  const root = exif.root.filter(entry => !omit(entry));
  const capture = exif.capture.filter(entry => !omit(entry));
  const location = selection.gps ? [] : exif.location.filter(entry => !selection.date || ![7, 29].includes(entry.tag));
  if (!root.length && !capture.length && !location.length) return;

  function addPointer(tag) {
    const data = new Uint8Array(4);
    root.push({ tag, type: 4, count: 1, data });
    return view(data);
  }
  const capturePointer = capture.length ? addPointer(EXIF) : undefined;
  const gpsPointer = location.length ? addPointer(GPS) : undefined;
  const directories = [root, capture, location].filter(entries => entries.length);
  const tableSize = entries => 6 + entries.length * 12;
  const padded = length => length + (length % 2);
  const tableEnd = directories.reduce((offset, entries) => offset + tableSize(entries), 8);
  const length = directories.flat().reduce((offset, entry) => offset + (entry.data.length > 4 ? padded(entry.data.length) : 0), tableEnd);
  if (length + EXIF_HEADER.length > 65533) throw new Error(exifError);
  const output = new Uint8Array(EXIF_HEADER.length + length);
  output.set(new TextEncoder().encode(EXIF_HEADER));
  const tiff = output.subarray(EXIF_HEADER.length);
  tiff.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  const target = view(tiff);
  target.setUint16(2, 42, little);
  target.setUint32(4, 8, little);
  capturePointer?.setUint32(0, 8 + tableSize(root), little);
  gpsPointer?.setUint32(0, 8 + tableSize(root) + (capture.length ? tableSize(capture) : 0), little);

  let table = 8;
  let dataOffset = tableEnd;
  for (const entries of directories) {
    target.setUint16(table, entries.length, little);
    entries.sort((a, b) => a.tag - b.tag).forEach((entry, index) => {
      const offset = table + 2 + index * 12;
      target.setUint16(offset, entry.tag, little);
      target.setUint16(offset + 2, entry.type, little);
      target.setUint32(offset + 4, entry.count, little);
      if (entry.data.length <= 4) {
        tiff.set(entry.data, offset + 8);
      } else {
        target.setUint32(offset + 8, dataOffset, little);
        tiff.set(entry.data, dataOffset);
        dataOffset += padded(entry.data.length);
      }
    });
    table += tableSize(entries);
  }
  return segment(0xe1, output);
}

export function cleanJpeg(parts, selection) {
  const output = [];
  for (const part of parts) {
    const { code, data, exif, raw } = part;
    if (exif) {
      const rebuilt = filterTiff(exif, selection);
      if (rebuilt) output.push(rebuilt);
    } else if (code === 0xe0 && data.length >= 14 && startsWith(data, "JFIF\0")) {
      // The JFIF header may carry a separate embedded thumbnail.
      const header = data.slice(0, 14);
      header.fill(0, 12, 14);
      output.push(segment(code, header));
    } else if ((code === 0xe2 && startsWith(data, "ICC_PROFILE\0")) ||
      (code === 0xee && startsWith(data, "Adobe")) ||
      ((code < 0xe0 || code > 0xef) && code !== 0xfe)) {
      output.push(raw);
    }
  }
  return new Blob(output, { type: "image/jpeg" });
}
