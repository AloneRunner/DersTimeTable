"""Cozum bulunamayinca SEBEBINI bulan katman.

Neden var: kullanici "Bu kurallarla program olusturmak mumkun degil" mesajini
aliyor ama ekranda duzeltecek kirmizi uyari YOK. Program Oncesi Kontrol yalnizca
tek tek toplamlara bakiyor (sinifin saati, ogretmenin toplam yuku); kurallarin
BIRBIRIYLE cakismasini goremiyor. Olculdu (16 Eylul 2026): 30 gunde 164 denemenin
104'u basarisiz ve kullanicilar ayni veriyle tekrar tekrar deniyor.

Yontem: modeli degistirmeden GIRDIYI gevsetip yeniden cozuyoruz. Hangi gevsetme
programi mumkun kiliyorsa engel odur.

SIRALAMA ONEMLI, iki kez yanlis yapildi:
1) Ilk surumde once musaitlik deneniyordu; musaitligi tamamen acmak neredeyse
   her seyi cozdugu icin blok ya da sabit ders yuzunden cikmayan programlar da
   "ogretmen musaitligi" diye raporlaniyordu.
2) Ikinci surumde sabitlenen ogretmenler basa alindi. Gercek bir okulda
   (20 Eylul 2026) engel "art arda en fazla 3 ders" varsayilaniydi, 4 yapmak
   yetiyordu; ama butun sabitlemeleri kaldirmak da programi cozdugu icin
   kullaniciya "sabitlediginiz ogretmen dersleri karsilamiyor" dendi. Yanlis ve
   uygulanmasi cok daha zor bir tavsiye.
Kural: kullanicinin EN KOLAY duzeltebilecegi gevsetme once denenir. Tek bir
sayiyi/secenegi degistirmek (art arda sinir, ayni gun bolunme, gunluk sinir,
bosluk siniri) basta; verinin buyuk kismini degistirmeyi gerektirenler (butun
sabitlemeler, butun musaitlikler) sonda.

Tanimli olmayan kural HIC denenmez: hem sure kazandirir hem olmayan bir kurali
suclamayi onler.

Maliyet: her deneme kisa sureli (varsayilan 8 sn) ve toplam sure butcesi var.
Butce asilirsa elde ne varsa onunla donuyoruz.
"""

from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple
import time

from solver_cpsat import solve_cp_sat


def _is_solved(result: Dict[str, Any]) -> bool:
    return bool(result.get('schedule'))


# ── Girdi gevsetmeleri ───────────────────────────────────────────────────────

def _acik_musaitlik(data: Dict[str, Any], teacher_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    kopya = deepcopy(data)
    hedef = set(teacher_ids) if teacher_ids else None
    for t in kopya.get('teachers', []) or []:
        if hedef is not None and t.get('id') not in hedef:
            continue
        gunler = t.get('availability') or []
        t['availability'] = [[True for _ in (gun or [])] for gun in gunler]
    return kopya


def _bloksuz(data: Dict[str, Any]) -> Dict[str, Any]:
    kopya = deepcopy(data)
    for s in kopya.get('subjects', []) or []:
        s['blockHours'] = 0
        s['tripleBlockHours'] = 0
    return kopya


def _ardisik_sinirsiz(data: Dict[str, Any]) -> Dict[str, Any]:
    kopya = deepcopy(data)
    for s in kopya.get('subjects', []) or []:
        s['maxConsec'] = None
    return kopya


def _haftalik_sinirsiz(data: Dict[str, Any]) -> Dict[str, Any]:
    kopya = deepcopy(data)
    for t in kopya.get('teachers', []) or []:
        t['maxWeeklyHours'] = None
    return kopya


def _ayni_gun_serbest(data: Dict[str, Any]) -> Dict[str, Any]:
    kopya = deepcopy(data)
    for s in kopya.get('subjects', []) or []:
        s['notSameDayWith'] = []
    return kopya


def _sabit_dersler_kaldir(data: Dict[str, Any]) -> Dict[str, Any]:
    kopya = deepcopy(data)
    kopya['fixedAssignments'] = []
    return kopya


def _sabit_ogretmen_kaldir(data: Dict[str, Any]) -> Dict[str, Any]:
    kopya = deepcopy(data)
    for s in kopya.get('subjects', []) or []:
        s['pinnedTeacherByClassroom'] = {}
    return kopya


# ── Kural var mi? (yoksa denenmez) ───────────────────────────────────────────

def _sabit_ders_sayisi(data: Dict[str, Any]) -> int:
    return len(data.get('fixedAssignments', []) or [])


def _sabit_ogretmen_sayisi(data: Dict[str, Any]) -> int:
    return sum(len(s.get('pinnedTeacherByClassroom') or {}) for s in (data.get('subjects', []) or []))


def _blok_var(data: Dict[str, Any]) -> bool:
    for s in data.get('subjects', []) or []:
        if int(s.get('blockHours') or 0) > 0 or int(s.get('tripleBlockHours') or 0) > 0:
            return True
    return False


def _ayni_gun_kurali_var(data: Dict[str, Any]) -> bool:
    return any((s.get('notSameDayWith') or []) for s in (data.get('subjects', []) or []))


def _ardisik_sinir_var(data: Dict[str, Any], default_max_consec: Optional[int]) -> bool:
    if default_max_consec is not None:
        return True
    return any(s.get('maxConsec') is not None for s in (data.get('subjects', []) or []))


def _haftalik_sinir_var(data: Dict[str, Any]) -> bool:
    return any(t.get('maxWeeklyHours') is not None for t in (data.get('teachers', []) or []))


# ── Ogretmen sikisikligi ─────────────────────────────────────────────────────

def _teacher_pressure(data: Dict[str, Any]) -> List[Tuple[str, float]]:
    """Ogretmenleri 'sikisiklik' sirasina dizer: ders yuku / musait saat.

    Butun kadroyu tek tek denemeye vakit yok; en sikisik ogretmenden baslamak
    dogru ogretmeni ilk birkac denemede bulma sansini yukseltiyor.
    """
    teachers = data.get('teachers', []) or []
    subjects = data.get('subjects', []) or []
    classrooms = {c['id']: c for c in (data.get('classrooms', []) or [])}

    demand: Dict[str, float] = {t['id']: 0.0 for t in teachers}
    for s in subjects:
        hours = int(s.get('weeklyHours', 0) or 0)
        if hours <= 0:
            continue
        pinned_map = s.get('pinnedTeacherByClassroom') or {}
        for cid in (s.get('assignedClassIds', []) or []):
            if cid not in classrooms:
                continue
            pinned = pinned_map.get(cid)
            if pinned and isinstance(pinned, list):
                for tid in pinned:
                    if tid in demand:
                        demand[tid] += hours
                continue
            level = classrooms[cid].get('level')
            adaylar = []
            for t in teachers:
                if level == 'Ortaokul' and not t.get('canTeachMiddleSchool', False):
                    continue
                if level == 'Lise' and not t.get('canTeachHighSchool', False):
                    continue
                branches = t.get('branches') or []
                if branches and s.get('name') not in branches:
                    continue
                adaylar.append(t['id'])
            if adaylar:
                pay = hours / float(len(adaylar))
                for tid in adaylar:
                    demand[tid] += pay

    sirali: List[Tuple[str, float]] = []
    for t in teachers:
        musait = sum(1 for gun in (t.get('availability') or []) for saat in (gun or []) if saat)
        if musait <= 0:
            sirali.append((t['id'], float('inf')))
            continue
        sirali.append((t['id'], demand.get(t['id'], 0.0) / float(musait)))
    sirali.sort(key=lambda p: p[1], reverse=True)
    return sirali


def _ogretmen_adi(data: Dict[str, Any], teacher_id: str) -> str:
    for t in data.get('teachers', []) or []:
        if t.get('id') == teacher_id:
            return str(t.get('name') or 'Bir öğretmen')
    return 'Bir öğretmen'


# ── Ana islev ────────────────────────────────────────────────────────────────

def diagnose_infeasible(
    data: Dict[str, Any],
    school_hours: Dict[str, List[int]],
    default_max_consec: Optional[int],
    preferences: Optional[Dict[str, Any]],
    probe_seconds: int = 8,
    budget_seconds: int = 45,
) -> Dict[str, Any]:
    """Kurallari dardan genise gevseterek engeli bulur.

    Donen sozluk:
      found   : engel bulundu mu
      blocker : makine tarafi etiket (fixed, blocks, availability_teacher, ...)
      message : kullaniciya gosterilecek Turkce cumle
      teacher : varsa engelin bagli oldugu ogretmen adi
      tried   : denenen gevsetmelerin etiketleri (olcum icin)
    """
    basladi = time.time()
    prefs = dict(preferences or {})
    denenen: List[str] = []

    def kalan() -> float:
        return budget_seconds - (time.time() - basladi)

    def dene(etiket: str, yeni_data: Dict[str, Any], yeni_prefs: Optional[Dict[str, Any]] = None,
             yeni_max_consec: Any = '_ayni_') -> bool:
        if kalan() <= 1:
            return False
        denenen.append(etiket)
        sure = int(max(3, min(probe_seconds, kalan())))
        sonuc = solve_cp_sat(
            yeni_data,
            school_hours,
            sure,
            default_max_consec=(default_max_consec if yeni_max_consec == '_ayni_' else yeni_max_consec),
            preferences=(prefs if yeni_prefs is None else yeni_prefs),
            stop_at_first=True,
        )
        return _is_solved(sonuc)

    def bulundu(blocker: str, message: str, teacher: Optional[str] = None) -> Dict[str, Any]:
        return {'found': True, 'blocker': blocker, 'teacher': teacher, 'message': message, 'tried': denenen}

    # 1) Art arda ders siniri. Once yalnizca BIR artirilir: kullaniciya "siniri kaldir"
    # degil "3'u 4 yap" diyebilmek icin.
    if _ardisik_sinir_var(data, default_max_consec):
        if default_max_consec is not None and dene('max_consec+1', deepcopy(data), None, int(default_max_consec) + 1):
            return bulundu('max_consec', (
                f"\"Art arda en fazla {default_max_consec} ders\" sınırı {int(default_max_consec) + 1} yapılınca program oluşuyor. "
                "Sınıflar ve bazı öğretmenler tam dolu olduğu için aynı dersin saatleri yan yana gelmek zorunda kalıyor. "
                f"Gelişmiş ayarlardaki art arda ders sınırını {int(default_max_consec) + 1} yapıp tekrar deneyin."
            ))

    # Blok dersler. Tek bir secenekle (bloklari esnet) duzeldigi icin basta; gercek bir
    # okulda bloklu 90 sn'de cikmayan program bloksuz 6 sn'de cikti.
    if _blok_var(data) and dene('blocks', _bloksuz(data)):
        return bulundu('blocks', (
            "2'li ve 3'lü blok kuralları kaldırılınca program oluşuyor. Blok istenen dersler "
            "öğretmenin müsait olduğu ardışık saatlere sığmıyor. \"Yer bulamazsa blokları esnet\" "
            "seçeneğini açabilir ya da bir dersin blok saatini azaltabilirsiniz."
        ))

    # 2) Dersin ayni gun bolunememesi.
    if not prefs.get('allowSameDaySplit'):
        gevsek = dict(prefs)
        gevsek['allowSameDaySplit'] = True
        if dene('same_day_split', deepcopy(data), gevsek):
            return bulundu('same_day_split', (
                "Bir dersin aynı gün içinde bölünebilmesine izin verilince program oluşuyor. "
                "CP-SAT ayarlarından \"aynı gün bölünebilsin\" seçeneğini açabilirsiniz."
            ))

    # 3) Ogretmenin gunluk ders siniri.
    if prefs.get('teacherDailyMaxHours') is not None:
        gevsek = dict(prefs)
        gevsek.pop('teacherDailyMaxHours', None)
        if dene('daily_max', deepcopy(data), gevsek):
            return bulundu('daily_max', (
                f"Öğretmen günlük en fazla {prefs.get('teacherDailyMaxHours')} ders sınırı kaldırılınca "
                "program oluşuyor. Bu sınırı bir artırmak yeterli olabilir."
            ))

    # 4) Ogretmen bosluk siniri.
    if prefs.get('maxTeacherGapHours') is not None:
        gevsek = dict(prefs)
        gevsek.pop('maxTeacherGapHours', None)
        if dene('gap_limit', deepcopy(data), gevsek):
            return bulundu('gap_limit', (
                "Öğretmen boşluk sınırı kaldırılınca program oluşuyor. Bu sınırı gevşetin ya da kapatın."
            ))

    # Art arda siniri tamamen kaldirmak (bir artirmak yetmediyse).
    if _ardisik_sinir_var(data, default_max_consec) and dene('max_consec', _ardisik_sinirsiz(data), None, None):
        return bulundu('max_consec', (
            "Art arda ders sınırı kaldırılınca program oluşuyor. Bir dersin günde en fazla kaç saat "
            "üst üste olabileceği ayarı fazla dar; artırıp tekrar deneyin."
        ))

    # 5) "Ayni gun olamaz" eslestirmeleri.
    if _ayni_gun_kurali_var(data) and dene('not_same_day', _ayni_gun_serbest(data)):
        return bulundu('not_same_day', (
            "\"Aynı gün olamaz\" kuralları kaldırılınca program oluşuyor. Bu şekilde eşleştirdiğiniz "
            "derslerden birkaçını serbest bırakın."
        ))

    # 6) Saate sabitlenmis dersler.
    sabit = _sabit_ders_sayisi(data)
    if sabit > 0 and dene('fixed', _sabit_dersler_kaldir(data)):
        return bulundu('fixed', (
            f"Belirli saate sabitlenmiş {sabit} ders kaldırılınca program oluşuyor. Sabitlediğiniz "
            "saatler diğer kurallarla çakışıyor; birkaç sabitlemeyi kaldırıp tekrar deneyin."
        ))

    # 7) Ogretmenin haftalik ust siniri.
    if _haftalik_sinir_var(data) and dene('weekly_max', _haftalik_sinirsiz(data)):
        return bulundu('weekly_max', (
            "Öğretmenlerin haftalık üst sınırları kaldırılınca program oluşuyor. Bir öğretmenin "
            "haftalık ders sınırı, ona verilen derslerden az. Sınırı yükseltin ya da dersin bir "
            "kısmını başka öğretmene verin."
        ))

    # 8) Derse sabitlenen ogretmen.
    pinned = _sabit_ogretmen_sayisi(data)
    if pinned > 0 and dene('pinned', _sabit_ogretmen_kaldir(data)):
        return bulundu('pinned_teacher', (
            "Derslere sabitlenen öğretmenler serbest bırakılınca program oluşuyor. Sabitlediğiniz "
            "öğretmenin saatleri o dersleri karşılamıyor; dersi başka bir öğretmene de açın."
        ))

    # 9) Ogretmen musaitligi. En genis gevsetme, bu yuzden EN SONDA.
    if dene('availability', _acik_musaitlik(data)):
        for teacher_id, _skor in _teacher_pressure(data)[:8]:
            if kalan() <= 3:
                break
            if dene(f'availability:{teacher_id}', _acik_musaitlik(data, [teacher_id])):
                ad = _ogretmen_adi(data, teacher_id)
                return bulundu('availability_teacher', (
                    f"{ad} adlı öğretmenin müsait saatleri açılırsa program oluşuyor. Bu öğretmenin "
                    "girdiği sınıfların boş saatleriyle müsaitliği çakışmıyor; bir gün daha müsait "
                    "işaretlemek ya da derslerinden birini başka öğretmene vermek yeterli."
                ), ad)
        return bulundu('availability', (
            "Öğretmen müsaitlikleri açılırsa program oluşuyor. Tek bir öğretmen değil, birkaç "
            "öğretmenin müsait saatleri birlikte darlık yaratıyor. En dolu öğretmenlere bir gün daha "
            "müsaitlik eklemeyi deneyin."
        ))

    return {
        'found': False,
        'blocker': 'unknown',
        'teacher': None,
        'message': (
            "Kuralları tek tek gevşeterek denedim ama engelin hangisi olduğunu bulamadım; kurallar "
            "birlikte çakışıyor olabilir. Aynı veriyle tekrar denemek sonucu değiştirmez. En dolu "
            "öğretmenlerin müsaitliğini ve blok/sabitleme kurallarını gevşetip öyle deneyin; sorun "
            "sürerse ekran görüntüsüyle bize yazın."
        ),
        'tried': denenen,
    }
