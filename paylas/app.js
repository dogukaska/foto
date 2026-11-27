import { $, download } from "/gunluk/common.js?v=1";
import qrcode from "/qr/vendor/qrcode.mjs";
import { erase, isImageName, maxSize, receive, seal, upload, validShare } from "./transfer.js?v=2";

const message = text => { if ($("status").textContent !== text) $("status").textContent = text; };
const formatSize = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const sizeLabel = size => size >= 1024 ** 2 ? formatSize.format(size / 1024 ** 2) + " MB" :
  size >= 1024 ? formatSize.format(size / 1024) + " KB" : size + " bayt";
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
  let file, controller, shared, deleting = false;

  function busy(active) {
    picture.disabled = expiry.disabled = active;
    $("start").disabled = active || !file;
    $("cancel").hidden = !active;
  }

  picture.addEventListener("change", () => {
    const chosen = picture.files[0];
    file = chosen && isImageName(chosen.name) && chosen.size > 0 && chosen.size <= maxSize ? chosen : undefined;
    $("start").disabled = !file || deleting;
    $("file-info").hidden = !file;
    $("file-info").textContent = file ? file.name + " · " + sizeLabel(file.size) : "";
    message(file || !chosen ? "" : "En fazla 50 MB boyutunda desteklenen bir görsel seç.");
  });

  $("start").addEventListener("click", async () => {
    if (!file || controller || deleting) return;
    controller = new AbortController();
    busy(true);
    $("share").hidden = true;
    message("Görsel şifreleniyor…");
    try {
      const { packet, secret } = await seal(file);
      if (controller.signal.aborted) throw new DOMException("İptal edildi.", "AbortError");
      message("Görsel yükleniyor…");
      progress(0, 1);
      shared = await upload(packet, expiry.value, progress, controller.signal);
      const url = new URL(location.href);
      url.search = "";
      url.hash = new URLSearchParams({ a: shared.id, k: secret });
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
      $("start").disabled = !file;
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
  $("intro").textContent = "Gönderilen görseli orijinal dosya olarak indir.";
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get("a"), secret = params.get("k");
  if (!validShare(id, secret)) {
    $("receive").disabled = true;
    message("Paylaşım bağlantısı eksik ya da geçersiz.");
    return;
  }
  let result;
  $("receive").addEventListener("click", async () => {
    $("receive").disabled = true;
    message("Görsel alınıyor…");
    try {
      result = await receive(id, secret, progress);
      $("receive").hidden = true;
      $("save").hidden = false;
      message(result.name + " · " + sizeLabel(result.blob.size) + " hazır.");
    } catch (error) {
      message(error.message || "Görsel indirilemedi.");
    } finally {
      $("progress").hidden = true;
      $("receive").disabled = Boolean(result);
    }
  });
  $("save").addEventListener("click", () => { if (result) download(result.blob, result.name); });
}

if (!crypto.subtle) message("Görsel paylaşımı için güncel bir tarayıcı ve HTTPS gerekli.");
else if (location.hash) setupReceiver();
else setupSender();
