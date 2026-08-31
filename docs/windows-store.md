# Microsoft Store yayın hazırlığı

DersTimeTable, Microsoft Store'a PWA olarak gönderilecektir. Bu yöntem mevcut web ve Android uygulamalarından bağımsız bir paket üretir; canlı sitenin çalışma biçimini değiştirmez.

## Projede hazır olanlar

- HTTPS ile çalışan canlı adres: `https://idare.ozarik.org/`
- Web uygulaması manifesti ve 192/512 piksel simgeler
- Güvenli, ağ öncelikli servis çalışanı
- İnternet kesildiğinde açıklayıcı çevrimdışı ekranı
- Bağımsız pencere görünümü (`standalone`)
- `npm run pwa:check` ile yerel doğrulama

## Partner Center adımları

1. Bireysel geliştirici hesabıyla Partner Center'a girin.
2. **Apps and games > New product > MSIX or PWA app** yolunu açın.
3. Uygulama adını ayırtın. Önerilen ad: **DersTimeTable - Okul Ders Programı**.
4. **Product identity** sayfasındaki Package ID, Publisher ID ve Publisher display name değerlerini kaydedin.
5. `https://www.pwabuilder.com/` adresinde `https://idare.ozarik.org/` bağlantısını test edin.
6. Windows paketi oluştururken Partner Center'daki üç kimlik değerini girin.
7. Oluşan mağaza paketini Partner Center'a yükleyin.

## Mağaza kaydı için hazırlanacaklar

- Türkçe kısa ve uzun açıklama
- En az bir uygulama ekran görüntüsü
- Kare uygulama logosu
- Eğitim kategorisi ve yaş derecelendirme formu
- Gizlilik politikası bağlantısı
- Destek e-posta adresi veya destek sayfası

Paket kimlikleri kullanıcı hesabına bağlı olduğu için son MSIX paketi, uygulama adı Partner Center'da ayrıldıktan sonra oluşturulmalıdır.
