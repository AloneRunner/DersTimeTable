Netlify dağıtım notları — DersTimeTable

Gerekli Netlify Build Ayarları (repo içindeki `netlify.toml` ile uyumlu):

- Build command: npm run build
- Publish directory: dist
- Functions directory: netlify/functions
- Base directory: / (varsayılan)

Öneriler:

- Node sürümü: 18 (`.nvmrc` ile sabitlenmiştir)
- Netlify CLI ile önizleme çalıştırmak için `netlify dev` komutunu kullanabilirsiniz; proje kökünde `netlify.toml` dev bloğu Vite'i `--host 0.0.0.0 --port 8888` ile başlatır.

CP-SAT sunucusu (Python) notları:

- `server/` içinde Python tabanlı CP-SAT çözümü var. Netlify Functions Node.js çalıştırır; uzun süreli Python süreçlerini Netlify Functions içinde çalıştırmak uygun değildir.
- CP-SAT sunucusunu canlıya almak istiyorsanız öneriler:
  - CP-SAT sunucusunu Railway/Heroku/Fly gibi bir Python destekleyen servise deploy edin ve frontend'den bu API'yi çağırın.
  - Veya CP-SAT fonksiyonlarını destekleyen bir serverless platform kullanın.

Railway crash ve hata günlükleri için hızlı adımlar:

1) Railway dashboard'a gidin: proje → Deploys → failed deploy üzerine tıklayın.
2) Deploy loglarını okuyun; Python import hataları veya ortools yükleme hataları (binary uyumsuzluğu) sık rastlanan sebeplerdir.
3) Ortaya çıkan hata `ModuleNotFoundError: ortools` veya benzeri ise: Railway'nin Python runtime sürümünü (3.10–3.12) ile `ortools` sürümünün uyumlu olduğundan emin olun. `requirements.txt` içinde `ortools==9.14.6206` yazıyor; Railway ortamında wheel binary bulunmuyor olabilir, bu durumda build zamanında pip derlemesi (compilation) gerekebilir.

Hızlı rollback:

- Railway veya GitHub'da deploy hatası varsa, Netlify/Railway üzerinde doğrudan deploy geçmişinden bir önceki başarılı sürümü geri alabilirsiniz.
- Git komutları ile yerel olarak hızlıca eski bir commit'e dönmek isterseniz söyleyin, size `git revert` ya da `git checkout` komutlarını hazırlayayım.

Eğer isterseniz şimdi:
- Railway loglarını nasıl alacağınızı adım adım yazayım.
- Ya da hızlıca repository'den son değişiklikleri geri alan bir `git revert` komutu hazırlayayım.

