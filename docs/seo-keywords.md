# Arama görünürlüğü: anahtar kelimeler ve mağaza metinleri

Bu belge iki şeyi toplar: uygulamanın hangi aramalarla bulunması gerektiği ve
Google Play / Microsoft Store listelerine yapıştırılacak metinler.

## Neyin işe yaradığı, neyin yaramadığı

- Google `<meta name="keywords">` etiketini 2009'dan beri okumuyor. Sitede
  hâlâ duruyor ama sıralamaya etkisi yok.
- Etkisi olanlar: sayfada **görünür** gerçek metin (index.html'deki
  `#hakkinda` bölümü), `<title>` ve `description`, yapısal veri (JSON-LD
  `SoftwareApplication`), canonical, sitemap ve Search Console'a gönderim.
- Uygulama tek sayfalık (SPA). Google JavaScript'i çalıştırır ama
  `#root` içine React'in yazdığı içerik güvenilir sayılmaz; bu yüzden SEO
  metni `#root` dışında, sayfanın altında duruyor.
- Mağaza aramaları (Play / Microsoft Store) site SEO'sundan bağımsızdır;
  liste başlığı, kısa açıklama ve uzun açıklamadaki kelimelere göre çalışır.

## Hedef aramalar (Türkçe, öncelik sırasıyla)

Birincil (title / description / H2'lerde geçiyor):

- ders dağıtım programı
- ders programı hazırlama programı
- otomatik ders programı
- okul ders programı hazırlama
- ücretsiz ders programı programı
- haftalık ders programı oluşturma
- çakışmasız ders programı

İkincil (sayfa metninde geçiyor):

- lise ders programı hazırlama
- ortaokul ders programı hazırlama
- öğretmen nöbet çizelgesi / nöbet programı hazırlama
- blok ders programı
- öğretmen müsaitlik ders programı
- ders programı yapma programı
- okul idaresi ders programı
- ders programı PDF

Uzun kuyruk (SSS ve özellik listesinde):

- ders programı hazırlama programı ücretsiz indir
- ders programı hazırlama web tabanlı
- ders programı hazırlama android uygulaması
- ders programı hazırlama windows programı
- sabahçı öğlenci ders programı
- imam hatip / meslek lisesi ders programı hazırlama

İngilizce (yurt dışı yüklemeler için, çoklu dil geldiğinde kullanılacak):

- school timetable generator, free timetable maker, class schedule
  generator, teacher timetable software, automatic timetable scheduling

## Search Console'da yapılacaklar

1. https://search.google.com/search-console → `idare.ozarik.org` mülkünü
   ekle (DNS TXT kaydı veya Netlify'a HTML dosyası).
2. Sitemaps → `https://idare.ozarik.org/sitemap.xml` gönder.
3. URL Inspection → `https://idare.ozarik.org/` → "Request indexing".
4. 2–4 hafta sonra Performance sekmesinde hangi sorgularla gösterim
   alındığına bak; bu listeyi ona göre güncelle. Gerçek arama hacmini
   ancak orada görürsün.
5. Rich results test: https://search.google.com/test/rich-results ile
   JSON-LD'nin hatasız okunduğunu doğrula.

## Google Play listesi

**Uygulama adı** (en fazla 30 karakter):

    Ders Dağıtım - DersTimeTable

**Kısa açıklama** (en fazla 80 karakter):

    Okullar için çakışmasız ders dağıtım ve haftalık ders programı hazırlama aracı

(Kısa açıklamada "ücretsiz" yok: Play meta veri kuralları fiyat/tanıtım
ifadelerini başlık ve kısa açıklamada hoş karşılamıyor.)

**Uzun açıklama** (en fazla 4000 karakter):

    DersTimeTable, okul idareleri için ücretsiz ders dağıtım programıdır.
    Öğretmen müsaitliklerini, haftalık ders yüklerini, blok dersleri ve sınıf
    kısıtlarını dikkate alarak çakışmasız haftalık ders programını saniyeler
    içinde otomatik hazırlar.

    ÖZELLİKLER
    • Otomatik, çakışmasız ders dağıtımı (CP-SAT kısıt çözücü)
    • Öğretmen müsaitlik takvimi ve haftalık azami ders saati
    • 2'li ve 3'lü blok ders tanımı
    • Aynı gün içinde bölünmeyen dersler, aynı güne gelmemesi gereken dersler
    • Ders başına ardışık saat sınırı
    • Laboratuvar, spor salonu gibi mekan çakışması kontrolü
    • Sabit (kilitli) ders saatleri
    • Nöbet çizelgesi ve nöbetçi öğretmen dağıtımı
    • Sınıf, öğretmen ve toplu A4 çizelge olarak PDF çıktısı
    • Sürükle-bırak ile elle düzenleme
    • Program öncesi kontrol: eksik saat, öğretmensiz ders, yetmeyen müsaitlik
    • Bulut senkronizasyonu (web, Android, Windows) ve JSON yedekleme

    KİMLER İÇİN
    Ders programı hazırlamakla görevli okul müdürleri, müdür yardımcıları ve
    öğretmenler. Ortaokul, Anadolu lisesi, fen lisesi, imam hatip ve meslek
    lisesi; tam gün, sabahçı ve öğlenci düzeni.

    NASIL ÇALIŞIR
    1. Öğretmenleri, sınıfları ve dersleri girin.
    2. Müsaitlikleri, blok dersleri ve günlük ders saatlerini belirleyin.
    3. "Program Oluştur" deyin; tüm kısıtları sağlayan program hazırlanır.
    4. Gerekirse düzenleyin, PDF alıp öğretmenlerle WhatsApp veya e-postayla paylaşın.

    Aynı hesabı bilgisayarda web sürümünden (idare.ozarik.org) ve Microsoft
    Store'daki Windows uygulamasından da kullanabilirsiniz. Tamamen ücretsizdir;
    abonelik veya uygulama içi satın alma yoktur.

    Destek: kaanozarik@gmail.com

## Microsoft Store listesi

**Ad** (rezerve): `DersTimeTable - Okul Ders Programı`

**Kısa açıklama**:

    Ortaokul ve liseler için ücretsiz otomatik ders programı ve nöbet çizelgesi.

**Açıklama**: Google Play uzun açıklamasının aynısı; sondaki paragrafı şöyle
değiştir:

    Aynı hesabı web sürümünden (idare.ozarik.org) ve Google Play'deki Android
    uygulamasından da kullanabilirsiniz.

**Arama terimleri** (Partner Center, en fazla 7 adet, her biri ≤ 30 karakter):

    ders programı
    ders programı hazırlama
    okul ders programı
    nöbet çizelgesi
    haftalık ders programı
    timetable
    school schedule

## Bakım

- Yeni bir özellik eklendiğinde index.html'deki özellik listesini ve mağaza
  açıklamalarını birlikte güncelle.
- `public/sitemap.xml` içindeki `lastmod` tarihini büyük içerik
  değişikliklerinde ilerlet.
