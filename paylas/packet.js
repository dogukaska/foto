const encoder = new TextEncoder(), decoder = new TextDecoder();
const mime = /^image\/(?:jpeg|png|gif|webp|avif|heic|heif|bmp|tiff)$/;
const chunkSize = 2 * 1024 ** 2;
const manifestLimit = 32 * 1024;
const tagSize = 16;
const legacyLimit = 50 * 1024 ** 2;
export const maxSize = 100_000_000;
export const maxFiles = 20;
export const maxPacket = maxSize + 64 * 1024;

const mimeOf = type => typeof type === "string" && mime.test(type) ? type : "application/octet-stream";
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const importKey = bytes => crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);

function isFileName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 255 &&
    name !== "." && name !== ".." &&
    !/[\/\\\u0000-\u001f\u007f]/.test(name);
}

export function validFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > maxFiles) return false;
  let total = 0;
  for (const file of files) {
    if (!isFileName(file?.name) || !Number.isSafeInteger(file.size) || file.size < 0) return false;
    total += file.size;
  }
  return total <= maxSize;
}


function chunkCipher(key, nonce, operation) {
  let counter = 0;
  return data => {
    // A random per-packet key and a nonce prefix + counter give every chunk a distinct IV.
    const iv = new Uint8Array(12);
    iv.set(nonce);
    new DataView(iv.buffer).setUint32(8, counter++);
    return crypto.subtle[operation]({ name: "AES-GCM", iv }, key, data);
  };
}

export async function seal(files, signal) {
  if (!validFiles(files)) throw new Error("Geçerli dosyalar seç.");
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  const encrypt = chunkCipher(await importKey(raw), nonce, "encrypt");
  const manifest = encoder.encode(JSON.stringify(files.map(({ name, type, size }) => ({ name, type: mimeOf(type), size }))));
  if (manifest.length > manifestLimit) throw new Error("Dosya adları toplamda çok uzun.");
  const header = new Uint8Array(12);
  header.set(nonce);
  new DataView(header.buffer).setUint32(8, manifest.length);
  const parts = [header, await encrypt(manifest)];
  for (const file of files) {
    for (let start = 0; start < file.size; start += chunkSize) {
      signal.throwIfAborted();
      parts.push(await encrypt(await file.slice(start, start + chunkSize).arrayBuffer()));
    }
  }
  return { packet: new Blob(parts, { type: "application/octet-stream" }), secret: base64(raw) };
}

function readChunks(reader, notify) {
  let part;
  let offset = 0, total = 0;
  async function pull() {
    if (part && offset < part.length) return true;
    const { value, done } = await reader.read();
    if (done) return false;
    part = value;
    offset = 0;
    total += part.length;
    if (total > maxPacket) throw new Error("Geçersiz paylaşım dosyası.");
    notify(total);
    return true;
  }
  return {
    async exact(length) {
      const output = new Uint8Array(length);
      let written = 0;
      while (written < length && await pull()) {
        const count = Math.min(length - written, part.length - offset);
        output.set(part.subarray(offset, offset + count), written);
        written += count;
        offset += count;
      }
      if (written < length) throw new Error("Dosya aktarımı eksik kaldı.");
      return output;
    },
    async rest() {
      const parts = [];
      while (await pull()) {
        if (total > legacyLimit + 4096) throw new Error("Geçersiz paylaşım dosyası.");
        parts.push(part.subarray(offset));
        offset = part.length;
      }
      return new Blob(parts).arrayBuffer();
    },
    hasNext: pull,
  };
}

async function unsealLegacy(reader, key) {
  const data = await reader.rest();
  if (data.byteLength < 33) throw new Error("Geçersiz paylaşım dosyası.");
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: new Uint8Array(data, 0, 12),
  }, key, new Uint8Array(data, 12));
  const length = new DataView(plain).getUint32(0);
  if (!length || length > 4000 || length + 4 >= plain.byteLength || plain.byteLength - length - 4 > legacyLimit) {
    throw new Error("Geçersiz paylaşım dosyası.");
  }
  const file = JSON.parse(decoder.decode(new Uint8Array(plain, 4, length)));
  if (!isFileName(file?.name)) throw new Error("Geçersiz paylaşım dosyası.");
  return [{ blob: new Blob([new Uint8Array(plain, 4 + length)], { type: mimeOf(file.type) }), name: file.name }];
}

export async function unseal(stream, secret, version, notify) {
  const raw = Uint8Array.from(atob(secret.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  const key = await importKey(raw);
  const source = stream.getReader();
  const reader = readChunks(source, notify);
  try {
    if (version === "1") return await unsealLegacy(reader, key);
    const header = await reader.exact(12);
    const length = new DataView(header.buffer).getUint32(8);
    if (!length || length > manifestLimit) throw new Error("Geçersiz paylaşım dosyası.");
    const decrypt = chunkCipher(key, header.subarray(0, 8), "decrypt");
    const files = JSON.parse(decoder.decode(await decrypt(await reader.exact(length + tagSize))));
    if (!validFiles(files)) throw new Error("Geçersiz paylaşım dosyası.");
    const result = [];
    for (const { name, size, type } of files) {
      const parts = [];
      for (let start = 0; start < size; start += chunkSize) {
        const length = Math.min(size - start, chunkSize) + tagSize;
        parts.push(await decrypt(await reader.exact(length)));
      }
      result.push({ name, blob: new Blob(parts, { type: mimeOf(type) }) });
    }
    if (await reader.hasNext()) throw new Error("Geçersiz paylaşım dosyası.");
    return result;
  } catch (error) {
    await source.cancel().catch(() => {});
    throw error;
  } finally { source.releaseLock(); }
}
