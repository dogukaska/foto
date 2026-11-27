import { $, download, element } from "/gunluk/common.js?v=1";
import qrcode from "/qr/vendor/qrcode.mjs";
import { erase, receive, upload, validShare } from "./transfer.js?v=3";
import { maxFiles, maxSize, seal, validFiles } from "./packet.js?v=1";

const message = text => { if ($("status").textContent !== text) $("status").textContent = text; };
const formatSize = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const sizeLabel = size => size >= 1_000_000 ? formatSize.format(size / 1_000_000) + " MB" :
  size >= 1000 ? formatSize.format(size / 1000) + " KB" : size + " bayt";
const dateLabel = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function progress(done, total) {
  $("progress").hidden = false;
  $("progress").value = Math.min(100, Math.floor(done * 100 / total));
}

function qrFor(url) {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const canvas = $("qr"), modules = code.getModuleCount(), pixel = 8;
  canvas.width = canvas.height = (modules + 8) * pixel;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) {
    if (code.isDark(row, col)) ctx.fillRect((col + 4) * pixel, (row + 4) * pixel, pixel, pixel);
  }
}

function setupSender() {
  $("sender").hidden = false;
  const picture = $("picture"), expiry = $("expiry");
  let files = [], controller, shared, deleting = false;

  function busy(active) {
    picture.disabled = expiry.disabled = active;
    $("start").disabled = active || !files.length;
    $("cancel").hidden = !active;
  }

  picture.addEventListener("change", () => {
    const chosen = [...picture.files];
    const total = chosen.reduce((sum, file) => sum + file.size, 0);
    files = validFiles(chosen) ? chosen : [];
    $("start").disabled = !files.length || deleting;
    $("file-info").hidden = !files.length;
    $("file-info").textContent = files.length === 1 ? files[0].name + " · " + sizeLabel(total) :
      files.length + " görsel · " + sizeLabel(total);
    if (total > maxSize) message("Bir paylaşım en fazla 100 MB olabilir.");
    else if (chosen.length > maxFiles) message("Tek bağlantı için en fazla " + maxFiles + " görsel seç.");
    else if (chosen.length && !files.length) message("Desteklenen ve boş olmayan görseller seç.");
    else message("");
  });

  $("start").addEventListener("click", async () => {
    if (!files.length || controller || deleting) return;
    controller = new AbortController();
    busy(true);
    $("share").hidden = true;
    message("Görsel şifreleniyor…");
    try {
      const { packet, secret } = await seal(files, controller.signal);
      if (controller.signal.aborted) throw new DOMException("İptal edildi.", "AbortError");
      message("Görsel yükleniyor…");
      progress(0, 1);
      shared = await upload(packet, expiry.value, progress, controller.signal);
      const url = new URL(location.href);
      url.search = "";
      url.hash = new URLSearchParams({ a: shared.id, k: secret, v: "2" });
      $("link").value = url.href;
      qrFor(url.href);
      $("expires").textContent = "Bitiş · " + dateLabel.format(shared.expires);
      $("share").hidden = false;
      message("Bağlantı hazır.");
    } catch (error) {
      message(error.name === "AbortError" ? "Yükleme iptal edildi." : error.message || "Yükleme tamamlanamadı.");
    } finally {
      controller = undefined;
      $("progress").hidden = true;
      busy(false);
    }
  });
  $("cancel").addEventListener("click", () => controller?.abort());

  $("end").addEventListener("click", async () => {
    if (!shared || controller || deleting) return;
    deleting = $("end").disabled = $("start").disabled = true;
    try {
      await erase(shared.id);
      shared = undefined;
      $("share").hidden = true;
      $("link").value = "";
      message("Bağlantı silindi.");
    } catch (error) { message(error.message || "Bağlantı silinemedi."); }
    finally {
      deleting = $("end").disabled = false;
      $("start").disabled = !files.length;
    }
  });
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("link").value);
      message("Bağlantı kopyalandı.");
    } catch {
      $("link").focus();
      $("link").select();
      message("Bağlantıyı seçili alandan kopyala.");
    }
  });
  $("save-qr").addEventListener("click", () =>
    $("qr").toBlob(blob => { if (blob) download(blob, "gorsel-paylasim-qr.png"); }, "image/png"));
  if (navigator.share) {
    $("native-share").hidden = false;
    $("native-share").addEventListener("click", () =>
      navigator.share({ title: "Orijinal görsel", url: $("link").value }).catch(() => {}));
  }
}

function setupReceiver() {
  $("receiver").hidden = false;
  $("intro").textContent = "Gönderilen görselleri orijinal dosya olarak indir.";
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get("a"), secret = params.get("k"), version = params.get("v") ?? "1";
  if (!validShare(id, secret, version)) {
    $("receive").disabled = true;
    message("Paylaşım bağlantısı eksik ya da geçersiz.");
    return;
  }
  let result;
  $("receive").addEventListener("click", async () => {
    $("receive").disabled = true;
    message("Görsel alınıyor…");
    try {
      result = await receive(id, secret, version, progress);
      $("receive").hidden = true;
      if (result.length === 1) {
        $("save").hidden = false;
        message(result[0].name + " · " + sizeLabel(result[0].blob.size) + " hazır.");
      } else {
        $("save-zip").hidden = false;
        const list = $("received-files");
        list.hidden = false;
        for (const { name, blob } of result) {
          const button = element("button", name, { type: "button", "aria-label": name + " dosyasını indir" });
          button.addEventListener("click", () => download(blob, name));
          const row = element("li");
          row.append(button);
          list.append(row);
        }
        message(result.length + " görsel · " + sizeLabel(result.reduce((sum, entry) => sum + entry.blob.size, 0)) + " hazır.");
      }
    } catch (error) {
      message(error.message || "Görsel indirilemedi.");
    } finally {
      $("progress").hidden = true;
      $("receive").disabled = Boolean(result);
    }
  });
  $("save").addEventListener("click", () => {
    if (result?.length === 1) download(result[0].blob, result[0].name);
  });
  $("save-zip").addEventListener("click", async () => {
    if (!result || $("save-zip").disabled) return;
    $("save-zip").disabled = true;
    message("ZIP hazırlanıyor…");
    try {
      const zip = await loadZip();
      const names = new Set();
      for (const { name, blob } of result) {
        let candidate = name, number = 2;
        while (names.has(candidate.toLowerCase())) candidate = name.replace(/\.[^.]+$/, ext => " (" + number++ + ")" + ext);
        names.add(candidate.toLowerCase());
        zip.file(candidate, blob);
      }
      download(await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }), "orijinal-gorseller.zip");
      message("ZIP hazır.");
    } catch { message("ZIP hazırlanamadı. Görselleri tek tek indirebilirsin."); }
    finally { $("save-zip").disabled = false; }
  });
}

async function loadZip() {
  if (!window.JSZip) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "../vendor/jszip.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }
  return new window.JSZip();
}

if (!crypto.subtle) message("Görsel paylaşımı için güncel bir tarayıcı ve HTTPS gerekli.");
else if (location.hash) setupReceiver();
else setupSender();
