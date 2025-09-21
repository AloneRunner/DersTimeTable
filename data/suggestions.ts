const rawSubjects = [
  // Ortaokul - Zorunlu
  "Türkçe",
  "Matematik",
  "Fen Bilimleri",
  "Sosyal Bilgiler",
  "T.C. İnkılap Tarihi ve Atatürkçülük",
  "Yabancı Dil",
  "İngilizce",
  "Din Kültürü ve Ahlak Bilgisi",
  "Görsel Sanatlar",
  "Müzik",
  "Beden Eğitimi ve Spor",
  "Teknoloji ve Tasarım",
  "Rehberlik ve Kariyer Planlama",

  // Ortaokul - Seçmeli
  "Kur'an-ı Kerim",
  "Hz. Muhammed'in Hayatı",
  "Temel Dini Bilgiler",
  "Yazarlık ve Yazma Becerileri",
  "Okuma Becerileri",
  "Yaşayan Diller ve Lehçeler",
  "Bilim Uygulamaları",
  "Matematik Uygulamaları",
  "Bilişim Teknolojileri ve Yazılım",
  "Çevre Eğitimi ve İklim Değişikliği",
  "Spor ve Fiziki Etkinlikler",
  "Drama",
  "Zekâ Oyunları",
  "Halk Kültürü",
  "Medya Okuryazarlığı",
  "Hukuk ve Adalet",

  // Lise - Ortak
  "Türk Dili ve Edebiyatı",
  "Tarih",
  "Coğrafya",
  "Fizik",
  "Kimya",
  "Biyoloji",
  "Sağlık Bilgisi ve Trafik Kültürü",
  "Felsefe",
  "Rehberlik ve Yönlendirme",

  // Lise - Alan
  "İleri Düzey Matematik",
  "İleri Düzey Fizik",
  "İleri Düzey Kimya",
  "İleri Düzey Biyoloji",
  "Çağdaş Türk ve Dünya Tarihi",
  "Sosyoloji",
  "Psikoloji",
  "Mantık",
  "Sosyal Bilim Çalışmaları",

  // İmam Hatip
  "Arapça",
  "Hadis",
  "Tefsir",
  "Fıkıh",
  "Siyer",
  "Akaid ve Kelam",
  "Hitabet ve Mesleki Uygulama",
  "İslam Kültür ve Medeniyeti",
  "Dinler Tarihi",
  "İslam Tarihi",

  // Meslek Lisesi - Bilişim
  "Programlama Temelleri",
  "Ağ Temelleri",
  "Web Tasarımı ve Programlama",
  "Veri Tabanı",
  "Grafik ve Canlandırma",

  // Meslek Lisesi - Elektrik
  "Elektrik Devreleri",
  "Endüstriyel Kontrol ve Arıza Analizi",
  "Görüntü ve Ses Sistemleri",
  "Güvenlik Sistemleri",

  // Meslek Lisesi - Adalet
  "Hukuk Dili ve Terminolojisi",
  "Klavye Teknikleri",
  "Kalem Mevzuatı",
  "İnfaz ve Koruma",
  "Zabıt Kâtipliği",

  // Meslek Lisesi - Sağlık
  "Anatomi ve Fizyoloji",
  "Meslek Esasları ve Tekniği",
  "Sağlık Hizmetlerinde İletişim",
  "Hemşire Yardımcılığı",
  "Ebe Yardımcılığı",

  // Meslek Lisesi - Turizm
  "Konaklama ve Seyahat Hizmetleri",
  "Yiyecek İçecek Hizmetleri",
  "Kat Hizmetleri",
  "Ön Büro",

  // Meslek Lisesi - Diğer
  "Giyim Üretim Teknolojisi",
  "Kalıp Hazırlama",
  "Tekstil Teknolojisi",
  "Deri Giyim",
  "Depolama",
  "Gümrük",
  "Taşıma Modelleri",
  "Otomotiv Elektromekaniği",
  "Diyagnostik",
  "Erken Çocuklukta Gelişim",
  "Oyun ve Oyun Etkinlikleri",
  "Çocuk Ruh Sağlığı",

  // Güzel Sanatlar
  "Müziksel İşitme, Okuma ve Yazma",
  "Bireysel Çalgı Eğitimi",
  "Koro Eğitimi",
  "Türk ve Batı Müziği Tarihi",
  "Desen",
  "İki Boyutlu Sanat Atölyesi",
  "Üç Boyutlu Sanat Atölyesi",
  "Sanat Tarihi",
  "Grafik Tasarım",

  // Spor Lisesi
  "Temel Spor Eğitimi",
  "Antrenman Bilgisi",
  "Spor ve Beslenme",
  "Spor Psikolojisi",
  "Spor Anatomisi ve Fizyolojisi",
  "Takım Sporları",
  "Bireysel Sporlar",

  // Genel Seçmeli
  "Demokrasi ve İnsan Hakları",
  "Girişimcilik",
  "İşletme / Ekonomi",
  "Uluslararası İlişkiler",
  "Yönetim Bilimi",
  "İkinci Yabancı Dil",
  "Almanca",
  "Fransızca",
  "Osmanlı Türkçesi",
  "Diksiyon ve Hitabet",
  "Bilgisayar Bilimi",
  "Astronomi ve Uzay Bilimleri",
  "Proje Hazırlama",
  "Bilgi Kuramı",
  "Fiziksel Etkinlikler",
  "Çağdaş Dünya Sanatı"
];

export const subjectSuggestions = [...new Set(rawSubjects)].sort((a, b) => a.localeCompare(b, 'tr'));
