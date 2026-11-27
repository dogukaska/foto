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

## Lisanslar
Model ve arka plan silme yöntemi [@imgly/background-removal](https://github.com/imgly/background-removal-js) projesinden alındı (AGPL-3.0). Bu yüzden proje AGPL-3.0 lisanslıdır (`LICENSE`). Kullanılan diğer kütüphaneler: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT), [heic-to](https://github.com/hoppergee/heic-to) / [libheif](https://github.com/strukturag/libheif) (LGPL-3.0), [JSZip](https://github.com/Stuk/jszip) (MIT). Modelin aslı: [DIS / ISNet](https://github.com/xuebinqin/DIS) (Apache-2.0).

Fotoğraf Araçları’nda AVIF ve boyut küçültme desteğine Claude, fotoğraf küçültme ve görsel gizleme araçlarının geliştirme ve test çalışmalarına OpenAI Codex katkıda bulundu.

Görsele Filigran, GIF karelerini okumak için [gifuct-js](https://github.com/matt-way/gifuct-js) ve çıktı için [gifenc](https://github.com/mattdesl/gifenc) kullanır.

Görsele Filigran aracının geliştirilmesi ve GIF testleri OpenAI Codex desteğiyle yapıldı.

[Dosya Paylaşımı](https://dogukaska.github.io/foto/paylas/) her gönderide toplam 100 MB’a ve 20 dosyaya kadar bağlantı veya QR kodla paylaşım sağlar. Alıcı dosyaları tek tek veya JSZip ile hazırlanmış tek bir ZIP olarak indirebilir. Dosyalar ve adları önce tarayıcıda AES‑GCM ile şifrelenir. Şifreli dosya [TempFile.org](https://tempfile.org/api) üzerinden 1, 6, 24 veya 48 saat saklanır. Şifreleme anahtarı paylaşım URL’sinin tarayıcıya özel parçasında kalır. Uygulama ve aktarım testleri OpenAI Codex desteğiyle geliştirildi.

100 MB sınırı, farklı dosya türleriyle çoklu paylaşım, parçalı AES‑GCM işleme ve ZIP indirme OpenAI Codex desteğiyle geliştirildi.

Fotoğraf Baskı Boyutu ve fotoğrafın özgün piksel ölçülerini okuma özelliği OpenAI Codex desteğiyle eklendi.
