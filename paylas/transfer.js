const endpoint = "https://tempfile.org";
const encoder = new TextEncoder(), decoder = new TextDecoder();
const extensions = /\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i;
const keyFormat = /^[A-Za-z0-9_-]{43}$/;
const idFormat = /^[A-Za-z0-9]{11}$/;
export const maxSize = 50 * 1024 ** 2;
const maxPacket = maxSize + 4096;

export function isImageName(name) {
  return typeof name === "string" && name.length <= 255 && extensions.test(name) &&
    !/[\/\\\u0000-\u001f\u007f]/.test(name);
}

export function validShare(id, secret) {
  return Boolean(id && secret && idFormat.test(id) && keyFormat.test(secret));
}

const base64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function importKey(bytes) {
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(file) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const metadata = encoder.encode(JSON.stringify({ name: file.name, type: file.type }));
  const plain = new Uint8Array(4 + metadata.length + file.size);
  new DataView(plain.buffer).setUint32(0, metadata.length);
  plain.set(metadata, 4);
  plain.set(new Uint8Array(await file.arrayBuffer()), 4 + metadata.length);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(raw), plain);
  return { packet: new Blob([iv, encrypted], { type: "application/octet-stream" }), secret: base64(raw) };
}

async function open(data, secret) {
  if (data.byteLength < 33 || data.byteLength > maxPacket) throw new Error("Geçersiz paylaşım dosyası.");
  const raw = Uint8Array.from(atob(secret.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: new Uint8Array(data, 0, 12),
  }, await importKey(raw), new Uint8Array(data, 12));
  const length = new DataView(plain).getUint32(0);
  if (!length || length > 4000 || length + 4 >= plain.byteLength || plain.byteLength - length - 4 > maxSize) {
    throw new Error("Geçersiz paylaşım dosyası.");
  }
  const file = JSON.parse(decoder.decode(new Uint8Array(plain, 4, length)));
  if (!isImageName(file?.name)) throw new Error("Geçersiz görsel dosyası.");
  const type = typeof file.type === "string" && /^image\/(?:jpeg|png|gif|webp|avif|heic|heif|bmp|tiff)$/.test(file.type) ?
    file.type : "application/octet-stream";
  return { blob: new Blob([new Uint8Array(plain, 4 + length)], { type }), name: file.name };
}

export function upload(packet, hours, progress, signal) {
  if (signal.aborted) return Promise.reject(new DOMException("İptal edildi.", "AbortError"));
  const body = new FormData();
  body.append("files", packet, "dijital-caki-gorsel.bin");
  body.append("expiryHours", String(hours));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint + "/api/upload/local");
    xhr.responseType = "json";
    xhr.timeout = 10 * 60_000;
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.upload.addEventListener("progress", event => {
      if (event.lengthComputable) progress(event.loaded, event.total);
    });
    xhr.addEventListener("loadend", () => signal.removeEventListener("abort", abort));
    xhr.addEventListener("abort", () => reject(new DOMException("İptal edildi.", "AbortError")));
    xhr.addEventListener("timeout", () => reject(new Error("Yükleme zaman aşımına uğradı.")));
    xhr.addEventListener("error", () => reject(new Error("Depolama hizmetine ulaşılamadı. Yeniden dene.")));
    xhr.addEventListener("load", () => {
      const file = xhr.response?.files?.[0];
      if (xhr.status === 429) return reject(new Error("Depolama hizmeti şu anda istek sınırına ulaştı. Biraz sonra dene."));
      if (xhr.status < 200 || xhr.status >= 300 || !xhr.response?.success ||
        !idFormat.test(file?.id ?? "") || file.size !== packet.size || !Number.isFinite(file.expiryTime)) {
        return reject(new Error("Görsel yüklenemedi. Yeniden dene."));
      }
      resolve({ id: file.id, expires: file.expiryTime });
    });
    xhr.send(body);
  });
}

export async function receive(id, secret, progress) {
  const response = await fetch(endpoint + "/" + id + "/download", { cache: "no-store", credentials: "omit" })
    .catch(() => { throw new Error("Depolama hizmetine ulaşılamadı. Yeniden dene."); });
  if (!response.ok) {
    if (response.status === 404 || response.status === 410) throw new Error("Bu bağlantının süresi dolmuş veya görsel silinmiş.");
    throw new Error("Görsel şu anda indirilemiyor. Yeniden dene.");
  }
  const length = Number(response.headers.get("Content-Length"));
  if (length > maxPacket) throw new Error("Geçersiz paylaşım dosyası.");
  const reader = response.body.getReader();
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxPacket) throw new Error("Geçersiz paylaşım dosyası.");
      parts.push(value);
      if (length) progress(size, length);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  try { return await open(await new Blob(parts).arrayBuffer(), secret); }
  catch { throw new Error("Görselin şifresi açılamadı. Paylaşım bağlantısının tamamını kullan."); }
}

export async function erase(id) {
  const response = await fetch(endpoint + "/api/file/" + id, { method: "DELETE", credentials: "omit" })
    .catch(() => { throw new Error("Depolama hizmetine ulaşılamadı. Yeniden dene."); });
  if (response.status === 404 || response.status === 410) return;
  if (!response.ok || !(await response.json()).success) throw new Error("Bağlantı silinemedi. Yeniden dene.");
}
