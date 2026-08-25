# Öğretmen Giriş Akışı Revizyonu

**Tarih:** 18.10.2025  
**Hazırlayan:** Codex  

## 1. Hedef

Mevcut tek kullanımlık kod tabanlı öğretmen oturum akışı, sık sık 404 ve tüketilmiş kod sorunları yaratıyor; idareci ve öğretmen arasındaki koordinasyonu zorlaştırıyor. Amaç, kalıcı e‑posta + şifre girişini devreye alıp öğretmenlerin uygulamayı bağımsız şekilde kullanabilmesini sağlamak ve idarecilere şifreyi yönetebilecekleri basit araçlar sunmak.

## 2. Güncel Durum

- Öğretmen bağlantısı `teacher_user_links` tablosu üzerinden tutuluyor.
- Öğretmen kodu üretildiğinde `login_tokens` tablosuna tek kullanımlık kayıt düşüyor; doğrulama sonrası tüketiliyor.
- Web/admin oturumu için `users` tablosundaki kayıtlar + `login_tokens` kullanılıyor.
- `users.password_hash` alanı mevcut ancak aktif kullanılmıyor (hep `NULL`).
- Mobil uygulama, `verify` endpointi ile token alıyor; fakat kod tüketildikten sonra tekrar doğrulanamıyor.

## 3. Yeni Akış – Gereksinimler

### 3.1 Kimlik Doğrulama Modeli

- Öğretmenler e‑posta + şifre ile giriş yapacak.
- Şifreler idareci tarafından belirlenip sıfırlanacak; öğretmen adına mail gönderimi şimdilik elle (WhatsApp, e‑posta vb.).
- Şifre minimum 4 haneli rakamlardan oluşacak (ileride politika gevşetilebilir).
- Şifre değişiklikleri admin panelinden yapılacak; öğretmen uygulamasında “Şifremi unuttum” akışı yok.
- Öğretmen oturumu 90 gün geçerli refresh token mantığında devam edecek.
- Tek kullanımlık kod yalnızca idareci web girişinde (mevcut akış) kalacak; öğretmen tarafında kaldırılacak.

### 3.2 İdareci Paneli

- Öğretmen kartında “Hesap bilgileri” bölümü:
  - Öğretmen e‑posta adresi (düzenlenebilir).
  - “Şifre” alanı (maskeli) + “Göster”/“Gizle” toggle.
  - “Yeni şifre üret” butonu → rastgele 4 haneli yeni şifre oluşturup kaydeder.
  - Şifre oluşturulduğunda toast ve kopyalama butonu.
- Bağlantı oluşturma akışı sadeleşir:
  1. Öğretmen e-postası yaz → “Kaydet”.
  2. Şifre oluştur veya güncelle.
  3. Öğretmen uygulamasına e-posta+şifre ile giriş yapılır.
- İçerik: “Sadece e-postası ve şifresi olan öğretmenler uygulamaya giriş yapabilir. Şifrenizi öğretmene iletiniz.”

### 3.3 Öğretmen Uygulaması

- Ana sekmeler aynı kalır; “Öğretmen Paneli” sekmesine tıklandığında login ekranı açılır.
- Login ekranı içerik:
  - E-posta (input type email).
  - Şifre (input type password, 4+ karakter).
  - “Giriş yap” butonu.
  - “Çıkış yap” butonu (oturumlu kullanıcılar için).
- Başarılı girişte token localStorage’da tutulur (mevcut `TeacherSessionSnapshot` yapısı genişletilir).
- Oturum süresi dolduğunda tekrar login ekranı gösterilir.
- Kod girişi ekranı kaldırılır.

### 3.4 Backend / API

- **Yeni Endpointler**
  - `POST /api/auth/login-password`: e-posta + şifre ile kullanıcı doğrulama; role’a göre admin/teacher ayırımı.
  - `POST /api/auth/teacher-password/reset`: admin token ile çağrılır, belirtilen öğretmen için yeni şifre hash edilir.
  - (Opsiyonel) `POST /api/auth/teacher-password/set`: ilk kez şifre atamak için.
- **Mevcut Endpoint Güncellemeleri**
  - `GET /api/auth/session` (veya `fetchSessionInfo`) öğretmen tokenı ile de çalışacak şekilde düzenlenecek; dönülen membership listesinde `role='teacher'`.
  - `linkTeacher` akışı `user_id` yaratırken otomatik olarak `users` tablosuna kayıt yapacak.
- **Token Yapısı**
  - Admin ve öğretmen tokenı aynı `login_tokens` tablosunda tutulabilir, fakat `purpose` alanları ayrıştırılmalı (`web_session`, `teacher_session`).
  - Öğretmen session süresi: 90 gün (mevcut `TEACHER_SESSION_LIFETIME`).

### 3.5 Veri Modeli ve Migrasyon

- `users` tablosunda öğretmen kayıtlarının `password_hash` alanı doldurulacak.
- `teacher_user_links.user_id` zorunlu alan hâline getirilecek (NULL olanlar migrasyon sırasında düzeltilecek).
- Mevcut öğretmen kodları (login_tokens) kullanılmazsa, cron ile temizlenebilir.
- Geçişte:
  1. Her `teacher_user_links` için `users` tablosunda kayıt var mı kontrol et; yoksa oluştur (`role='teacher'`, `password_hash=NULL`).
  2. Şifreyi admin paneli üzerinden atanmadığı sürece null kalabilir; öğretmen giriş yapamaz ama admin uyarı görebilir.

## 4. Adım Adım Uygulama

1. **Dokümantasyon ve gereksinimler** (bu dosya + UI mocku).
2. **Backend hazırlıkları**
   - Migrasyon scripti (`alembic` veya manuel SQL) → `password_hash` güncelleme, `teacher_user_links.user_id` integrity.
   - Yeni auth endpointleri + testler.
3. **Admin Panel UI**
   - Modal yerine “Hesap” kartı.
   - Şifre görünür/gizli toggle, “Yeni şifre üret” butonu.
4. **Mobil/Teacher App**
   - Kod girişi ekranının kaldırılması.
  - E-posta+şifre login formu.
  - Token saklama güncellemeleri.
5. **Temizlik ve bakım**
   - Kullanılmayan login token kayıtları temizleme.
   - Railway tablo sadeleştirme (bir sonraki sprintte).
6. **Test ve yayın**
   - Admin -> öğretmen şifresi atama → öğretmen mobil login.
   - Token süresi dolmuş öğretmen → tekrar login.
   - Kapalı test yayın + pilot geri bildirim.

## 5. Açık Sorular

- Şifre politikası tam olarak 4 haneli mi kalacak? Daha güçlü şifre gerekirse UI/backend kontrolü güncellenecek.
- Admin’in otomatik e-posta gönderimi gerekli mi? (Şimdilik manuel paylaşım.)
- Öğretmen “Hesap” sekmesinde profil bilgilerini güncelleyebilecek mi? (Şu aşamada hayır.)
- Admin panelinde toplu şifre reset işlemi ihtiyacı var mı?

Bu doküman sonraki sprintte yapılacak geliştirmelere temel oluşturur. Onay sonrası backend ve frontend uygulamasına geçilebilir.

## Ek: API Taslakları

### `POST /api/auth/login-password`

| Alan          | Tip     | Not                                |
|---------------|---------|------------------------------------|
| `email`       | string  | zorunlu                            |
| `password`    | string  | zorunlu                            |
| `school_id`   | int     | opsiyonel (öğretmen birden fazlaysa) |

**Yanıt**

```json
{
  "session_token": "abc",
  "expires_at": "2025-12-31T12:00:00Z",
  "user": { "id": 7, "email": "teacher@example.com", "name": "Öğretmen" },
  "schools": [
    { "id": 3, "role": "teacher", "name": "Anadolu Lisesi", "teacher_id": "t123" }
  ]
}
```

### `POST /api/auth/teacher-password/reset`

Admin bearer token ile çağrılır.

| Alan          | Tip     | Not             |
|---------------|---------|-----------------|
| `teacher_id`  | string  | zorunlu         |
| `school_id`   | int     | zorunlu         |
| `password`    | string  | opsiyonel; gönderilmezse random üret |

**Yanıt**

```json
{
  "ok": true,
  "password": "4821"
}
```

> Not: Şifre, admin panelinde göstermek için JSON cevabında dönecek; loglarda maskelemek için dikkat edilmeli.

### `POST /api/auth/teacher-password/set`

İlk kez şifre atamak için kullanılır (opsiyonel, reset endpointi ile birleşebilir).

### `GET /api/auth/session`

Öğretmen tokenı gönderildiğinde de çalışacak; `role='teacher'` membership’ler dönecek. Öğretmenin başka okulu varsa `school_id` query paramı ile seçilebilir.

## Ek: Migrasyon Taslağı

1. `users` tablosunda `role='teacher' AND password_hash IS NULL` kayıtları listele; bu kayıtlara şimdilik `NULL` kalacak ama admin paneli uyarı gösterebilir.
2. `teacher_user_links` tablosunda `user_id` boş olan kayıtlar için:
   - Eğer aynı e-posta ile `users` kaydı varsa `user_id` güncelle.
   - Yoksa `users` tablosuna `role='teacher'` yeni kayıt ekle, `user_id` bağla.
3. Yeni endpointler devredeyken eski tek kullanımlık kodlar temizlenebilir:
   - `login_tokens` tablosunda `purpose='teacher_code'` gibi kayıtları migrate sonrası sil.
4. Gerekirse `teacher_user_links` tablosuna `password_updated_at` alanı ekleyerek son reset tarihini tutabiliriz (isteğe bağlı).

## Ek: UI / UX Taslakları

### Admin Paneli – Öğretmen Hesap Kartı

```
Öğretmen Hesabı
------------------------------
E-posta        [ ogretmen@example.com ] (düzenlenebilir input)
Şifre          [ **** ] (Göz simgesi ile göster/gizle)
[ Yeni Şifre Üret ]  [ Kopyala ]
Son güncelleme: 18.10.2025 14:32

Bilgi kutusu:
- Şifre en az 4 haneli rakamdır.
- Öğretmen şifresini unutursa bu karttan yenileyebilirsiniz.
```

- “Yeni Şifre Üret” butonu random 4 hane üretir; modal veya toast ile “Yeni şifre: 4821” mesajı gösterir.
- “Kopyala” butonu clipboard’a metni alır.
- Eğer `password_hash` boşsa kart üstünde sarı uyarı banner: “Bu öğretmen için henüz şifre atanmadı.”

### Öğretmen Mobil Uygulaması – Giriş Ekranı

```
Öğretmen Girişi
------------------------------
E-posta    [              ]
Şifre      [              ]

[ Giriş Yap ]

Alt bilgi: “Şifrenizi okul idarecisinden alabilirsiniz.”

Oturum açıksa:
------------------------------
Merhaba, {Öğretmen Adı}
[ Öğretmen Paneline Git ]
[ Çıkış Yap ]
```

- “Öğretmen” sekmesine ilk tıklamada login diyaloğu açılır; giriş başarılıysa sekme içerikleri (program, nöbet vs.) görünür.
- Çıkış yapıldığında cache temizlenir, form tekrar gösterilir.

### Öğretmen Paneli (Web)

- Kod girişi modalı kaldırılacak.
- Giriş ekranı: e-posta + şifre alanları, “Hatırla” checkbox (opsiyonel).
- Kod akışı ile ilgili metinler yeni şifre akışı ile değiştirilecek.
