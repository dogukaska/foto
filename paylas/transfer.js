import { maxPacket, unseal } from "./packet.js?v=2";

const endpoint = "https://tempfile.org";
const keyFormat = /^[A-Za-z0-9_-]{43}$/;
const idFormat = /^[A-Za-z0-9]{11}$/;

export function validShare(id, secret, version) {
  return Boolean(id && secret && idFormat.test(id) && keyFormat.test(secret) &&
    (version === "1" || version === "2"));
}

export function upload(packet, hours, progress, signal) {
  if (signal.aborted) return Promise.reject(new DOMException("İptal edildi.", "AbortError"));
  const body = new FormData();
  body.append("files", packet, "dijital-caki-dosya.bin");
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
      if (xhr.status === 413) return reject(new Error("Depolama hizmeti bu yüklemeyi büyük buldu. Daha küçük bir seçimle dene."));
      if (xhr.status === 429) return reject(new Error("Depolama hizmeti şu anda istek sınırına ulaştı. Biraz sonra dene."));
      if (xhr.status < 200 || xhr.status >= 300 || !xhr.response?.success ||
        !idFormat.test(file?.id ?? "") || file.size !== packet.size || !Number.isFinite(file.expiryTime)) {
        return reject(new Error("Dosya yüklenemedi. Yeniden dene."));
      }
      resolve({ id: file.id, expires: file.expiryTime });
    });
    xhr.send(body);
  });
}

export async function receive(id, secret, version, progress) {
  const response = await fetch(endpoint + "/" + id + "/download", { cache: "no-store", credentials: "omit" })
    .catch(() => { throw new Error("Depolama hizmetine ulaşılamadı. Yeniden dene."); });
  if (!response.ok) {
    if (response.status === 404 || response.status === 410) throw new Error("Bu bağlantının süresi dolmuş veya dosya silinmiş.");
    throw new Error("Dosya şu anda indirilemiyor. Yeniden dene.");
  }
  const length = Number(response.headers.get("Content-Length"));
  if (length > maxPacket) {
    await response.body?.cancel();
    throw new Error("Geçersiz paylaşım dosyası.");
  }
  try {
    return await unseal(response.body, secret, version, bytes => { if (length) progress(bytes, length); });
  } catch (error) {
    if (error.name !== "OperationError") throw error;
    throw new Error("Dosyanın şifresi açılamadı. Paylaşım bağlantısının tamamını kullan.");
  }
}

export async function erase(id) {
  const response = await fetch(endpoint + "/api/file/" + id, { method: "DELETE", credentials: "omit" })
    .catch(() => { throw new Error("Depolama hizmetine ulaşılamadı. Yeniden dene."); });
  if (response.status === 404 || response.status === 410) return;
  if (!response.ok || !(await response.json()).success) throw new Error("Bağlantı silinemedi. Yeniden dene.");
}
