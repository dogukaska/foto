# Foto Araçları

Tarayıcıda çalışan iki basit araç. Fotoğraflar hiçbir sunucuya yüklenmez, her şey kendi cihazında yapılır.

**Adres:** https://dogukaska.github.io/foto/

## ✂️ Arka planı sil
- Yapay zeka (ISNet modeli) ana nesneyi ayırır. Sonuç fotoğrafın **orijinal çözünürlüğünde** çıkar.
- Arka plan şeffaf, beyaz, siyah ya da istediğin bir renk olabilir.
- "Boşlukları kırp" seçeneği nesnenin etrafındaki fazlalığı keser.
- PNG (kayıpsız, şeffaf), WebP (şeffaf, küçük) ya da JPG olarak indirilir.
- Model ilk kullanımda bir kere indirilir (88 MB), sonra tarayıcıda saklanır.
- Ekran kartı (WebGPU) varsa onu kullanır. Yoksa işlemciyle çalışır, bu 10–30 saniye sürer.

## 🔄 Format dönüştür
- Girdi: HEIC/HEIF (iPhone), JPG, PNG, WebP, GIF, BMP, AVIF.
- Çıktı: JPG, PNG, WebP. Çözünürlük değişmez. Kalite varsayılan olarak %95'tir, istersen %100 seçebilirsin.
- Birden fazla fotoğraf bir seferde dönüştürülür, hepsi tek ZIP olarak indirilebilir.
- Fotoğraflar sayfaya sürüklenebilir ya da Ctrl+V ile yapıştırılabilir.

Not: Yeni dosyaya fotoğrafın konum/tarih bilgileri (EXIF) aktarılmaz. Fotoğrafın yönü doğru kalır.

## Yayınlama
Settings → Pages → Branch: `main` / `(root)` → Save.

Yerelde denemek için: `python3 -m http.server` komutunu çalıştır, tarayıcıda `http://localhost:8000` adresini aç.

## Dosyalar
- `index.html`, `style.css`, `app.js`: arayüz
- `lib/image.js`: fotoğraf açma (HEIC dahil) ve kaydetme
- `lib/bg.js`, `lib/bg-worker.js`: arka plan silme
- `model/`: ISNet modeli (4 MB'lık parçalar halinde)
- `vendor/`: ONNX Runtime Web, heic-to (libheif), JSZip

## Lisanslar
Model ve arka plan silme yöntemi [@imgly/background-removal](https://github.com/imgly/background-removal-js) projesinden alındı (AGPL-3.0). Bu yüzden proje AGPL-3.0 lisanslıdır (`LICENSE`). Kullanılan diğer kütüphaneler: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), [heic-to](https://github.com/hoppergee/heic-to) / [libheif](https://github.com/strukturag/libheif) (LGPL-3.0), [JSZip](https://github.com/Stuk/jszip) (MIT). Modelin aslı: [DIS / ISNet](https://github.com/xuebinqin/DIS) (Apache-2.0).
