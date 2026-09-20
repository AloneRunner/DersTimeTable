"""Sunucu cozucusu icin kisi basina SURE butcesi.

Neden var: /solve/cpsat kimlik istemeden herkese acikti ve tek bir kullanici
ayni cozulmeyen veriyle yuzlerce kez deneyerek aylik sunucu butcesinin
neredeyse tamamini harcadi (Eylul 2026). Sunucu masrafi cepten odeniyor.

Neden SAYI degil SURE: ilk surum deneme sayisini sinirliyordu. Olculdu
(20 Eylul 2026): bir okulun 52 denemesi toplam 1-2 dakika cozucu suresi, bir
baskasinin TEK denemesi 74 saniye tutuyordu. Masraf saniyeyle dogru orantili
(vCPU-dakika = sure x arama is parcacigi). Sayiyla kisitlamak ucuz kullaniciyi
cezalandiriyor, pahaliyi durdurmuyordu.

Butce:
  - STARTER_SECONDS : her kimligin bir kerelik baslangic butcesi. Yeni bir okul
    veriyi oturtana kadar onlarca kez dener (olculdu: 76 deneme, programi
    olustu); bu normal kullanimdir ve baslangic butcesine sigar.
  - MONTHLY_SECONDS : her ay eklenen kucuk pay (donem ortasi degisiklikler icin).
    Birikir ama baslangic butcesini asamaz. 0 yazilirsa yenileme olmaz.
  - bonus (saniye)  : yoneticinin panelden verdigi ek sure; temel butce bitince harcanir.
Saatlik/gunluk pencere YOK; onun yerine harcanan sure sayilir.

Kimlikler (hepsi ayri ayri tutulur, en az kalani gecerlidir):
  - user:<id>     oturum acik hesap
  - device:<id>   cihaz kimligi -> ayni bilgisayarda yeni e-posta acmak butceyi sifirlamaz
  - school:<hash> verinin parmak izi -> yedegi indirip BASKA bilgisayarda yeni
    hesaba yuklemek de sifirlamaz. Parmak izi ogretmen adlarinin gizli bir
    anahtarla ozetlenmis halidir; ad saklanmaz, ozetten ada donulemez. Adlarin
    %60'i tutuyorsa ayni okul sayilir (ogretmen ekleyip cikarmak parmak izini
    degistirmesin diye). 5'ten az ogretmenli veri ve uygulamanin kendi ornek
    verileri parmak izine girmez; yoksa ornegi deneyen herkes tek butceyi paylasirdi.
  - ip:<adres>    yalniz bellekte, kaba kotuye kullanim freni (sayi bazli).

Veritabani hatasi cozumu hicbir zaman engellemez. Butce bitince istemci
tarayicidaki yedek cozucuye duser; kullanici yine program uretebilir.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import Request

DATABASE_URL = os.environ.get('DATABASE_URL')
logger = logging.getLogger(__name__)

_DEVICE_RE = re.compile(r'^[A-Za-z0-9-]{8,64}$')


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(os.environ.get(name, str(default)))))
    except (TypeError, ValueError):
        return default


# Ortam degiskeniyle ayarlanabilir; Railway'de degistirip yeniden dagitmak yeter.
STARTER_SECONDS = _env_int('SOLVER_BUDGET_STARTER_SECONDS', 1500, 0, 1_000_000)
MONTHLY_SECONDS = _env_int('SOLVER_BUDGET_MONTHLY_SECONDS', 300, 0, 1_000_000)
# Butcesi bitmek uzere olana bile anlamli bir arama yapilabilsin.
MIN_RUN_SECONDS = 10
# IP freni: ayni IP'nin arkasinda butun bir okul olabilir, o yuzden genis.
IP_HOURLY = _env_int('SOLVER_IP_HOURLY', 60, 1, 100000)
IP_DAILY = _env_int('SOLVER_IP_DAILY', 200, 1, 100000)
# Butceden muaf hesaplar (uygulama sahibi, magaza inceleme hesabi).
EXEMPT_EMAILS = {
    e.strip().lower()
    for e in os.environ.get('SOLVER_QUOTA_EXEMPT_EMAILS', 'kaanozarik@gmail.com,inceleme@ozarik.org').split(',')
    if e.strip()
}

FINGERPRINT_MIN_TEACHERS = 5
FINGERPRINT_MATCH = 0.6

_HOUR = 3600.0
_DAY = 86400.0

_lock = Lock()
_ip_hits: Dict[str, List[float]] = {}
_mem_rows: Dict[str, Dict[str, Any]] = {}  # yalniz veritabani yokken (yerel gelistirme)
_email_cache: Dict[int, str] = {}


# ── Kimlik ───────────────────────────────────────────────────────────────────

def identity_keys(request: Request) -> List[str]:
    """Istegin kimlik anahtarlari; ilki 'asil' kimliktir (ek sure ve istekler ona yazilir)."""
    keys: List[str] = []
    try:
        from usage import _session_user_id  # yerel ice aktarma: dongusel bagimliligi onler

        user_id = _session_user_id(request)
    except Exception:  # pylint: disable=broad-except
        user_id = None
    if user_id is not None:
        keys.append(f'user:{user_id}')

    device = (request.headers.get('x-device-id') or '').strip()
    if _DEVICE_RE.match(device):
        keys.append(f'device:{device}')

    forwarded = (request.headers.get('x-forwarded-for') or '').split(',')[0].strip()
    ip = forwarded or (request.client.host if request.client else '')
    if ip:
        keys.append(f'ip:{ip}')
    return keys or ['ip:unknown']


def _persistent(keys: List[str]) -> List[str]:
    return [k for k in keys if not k.startswith('ip:')]


def _primary(keys: List[str]) -> Optional[str]:
    """Ek surenin ve isteklerin yazildigi kimlik: hesap, yoksa cihaz."""
    kalici = [k for k in keys if k.startswith(('user:', 'device:'))]
    return kalici[0] if kalici else None


def _user_id_of(key: str) -> Optional[int]:
    return int(key.split(':', 1)[1]) if key.startswith('user:') else None


def is_exempt(keys: List[str]) -> bool:
    user_id = next((_user_id_of(k) for k in keys if k.startswith('user:')), None)
    if user_id is None or not DATABASE_URL or not EXEMPT_EMAILS:
        return False
    email = _email_cache.get(user_id)
    if email is None:
        try:
            import psycopg

            with psycopg.connect(DATABASE_URL) as conn:
                row = conn.execute('SELECT email FROM users WHERE id = %s', (user_id,)).fetchone()
            email = (row[0] or '').lower() if row else ''
            _email_cache[user_id] = email
        except Exception:  # pylint: disable=broad-except
            logger.exception('solver-quota-email-lookup-failed')
            return False
    return email in EXEMPT_EMAILS


# ── Veri parmak izi ──────────────────────────────────────────────────────────

def _salt() -> bytes:
    # Gizli anahtar: ozetlerden ada kaba kuvvetle donulmesini zorlastirir. Anahtar
    # degisirse parmak izleri sifirlanir; kabul edilebilir.
    secret = os.environ.get('SOLVER_FINGERPRINT_SALT') or os.environ.get('ADMIN_STATS_KEY') or 'ders-programi'
    return secret.encode('utf-8')


def _normalize_name(name: Any) -> str:
    text = str(name or '').replace('İ', 'i').replace('I', 'ı').casefold()
    return ' '.join(text.split())


def _name_hashes(names: List[Any]) -> Set[str]:
    salt = _salt()
    temiz = {_normalize_name(n) for n in names}
    temiz.discard('')
    return {hmac.new(salt, n.encode('utf-8'), hashlib.sha256).hexdigest()[:16] for n in temiz}


def _jaccard(a: Set[str], b: Set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / float(len(a | b))


_sample_sets: Optional[List[Set[str]]] = None


def _samples() -> List[Set[str]]:
    global _sample_sets  # pylint: disable=global-statement
    if _sample_sets is None:
        sets: List[Set[str]] = []
        try:
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sample_teacher_names.json')
            with open(path, encoding='utf-8') as fh:
                for names in json.load(fh).values():
                    sets.append(_name_hashes(names))
        except Exception:  # pylint: disable=broad-except
            logger.exception('solver-quota-samples-unreadable')
        _sample_sets = sets
    return _sample_sets


def school_key(data: Dict[str, Any]) -> Optional[str]:
    """Verinin parmak izi anahtari; yoksa (kucuk veri, ornek veri, veritabani yok) None."""
    if not DATABASE_URL:
        return None
    try:
        hashes = _name_hashes([t.get('name') for t in (data.get('teachers') or [])])
        if len(hashes) < FINGERPRINT_MIN_TEACHERS:
            return None
        if any(_jaccard(hashes, s) >= FINGERPRINT_MATCH for s in _samples()):
            return None
        import psycopg

        liste = sorted(hashes)
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            rows = conn.execute(
                "SELECT key, name_hashes FROM solver_quota WHERE key LIKE 'school:%%' AND name_hashes && %s",
                (liste,),
            ).fetchall()
            best_key, best = None, 0.0
            for key, stored in rows:
                skor = _jaccard(hashes, set(stored or []))
                if skor > best:
                    best_key, best = key, skor
            if best_key and best >= FINGERPRINT_MATCH:
                # Kadro zamanla degisir; parmak izi son hali izlesin.
                conn.execute('UPDATE solver_quota SET name_hashes = %s WHERE key = %s', (liste, best_key))
                return best_key
            key = 'school:' + hashlib.sha256(''.join(liste).encode('utf-8')).hexdigest()[:20]
            conn.execute(
                """INSERT INTO solver_quota (key, name_hashes) VALUES (%s, %s)
                   ON CONFLICT (key) DO UPDATE SET name_hashes = EXCLUDED.name_hashes""",
                (key, liste),
            )
            return key
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-fingerprint-failed')
        return None


# ── Butce hesabi ─────────────────────────────────────────────────────────────

def base_left(seconds_used: float, created_at: Optional[datetime]) -> float:
    """Temel butceden kalan saniye: baslangic + aylik pay - harcanan; baslangici asamaz."""
    months = 0
    if created_at is not None and MONTHLY_SECONDS > 0:
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        months = max(0, int((datetime.now(timezone.utc) - created_at).days // 30))
    left = STARTER_SECONDS + MONTHLY_SECONDS * months - float(seconds_used or 0)
    return min(float(STARTER_SECONDS), left)


def _rows(keys: List[str]) -> Dict[str, Dict[str, Any]]:
    """Kalici anahtarlarin satirlari. Okunamazsa BOS doner (cagiran 'butce var' saymaz)."""
    if not keys:
        return {}
    if not DATABASE_URL:
        return {k: dict(_mem_rows.get(k) or {'seconds_used': 0.0, 'bonus': 0, 'created_at': None}) for k in keys}
    import psycopg

    with psycopg.connect(DATABASE_URL) as conn:
        found = conn.execute(
            'SELECT key, seconds_used, bonus, created_at FROM solver_quota WHERE key = ANY(%s)', (keys,)
        ).fetchall()
    rows = {k: {'seconds_used': 0.0, 'bonus': 0, 'created_at': None} for k in keys}
    for key, used, bonus, created in found:
        rows[key] = {'seconds_used': float(used or 0), 'bonus': int(bonus or 0), 'created_at': created}
    return rows


def _status(keys: List[str]) -> Dict[str, Any]:
    kalici = _persistent(keys)
    primary = _primary(keys)
    rows = _rows(kalici)
    lefts = [base_left(r['seconds_used'], r['created_at']) for r in rows.values()]
    left = max(0.0, min(lefts)) if lefts else 0.0
    bonus = int(rows.get(primary, {}).get('bonus', 0)) if primary else 0
    return {'baseLeft': left, 'bonus': bonus, 'hasIdentity': bool(kalici)}


def _ip_block(keys: List[str], count: bool) -> Optional[Dict[str, Any]]:
    now = time.time()
    with _lock:
        for key in keys:
            if not key.startswith('ip:'):
                continue
            stamps = [t for t in _ip_hits.get(key, []) if now - t < _DAY]
            last_hour = [t for t in stamps if now - t < _HOUR]
            if len(stamps) >= IP_DAILY:
                return {'scope': 'daily', 'retryAfter': int(_DAY - (now - stamps[0])) + 1}
            if len(last_hour) >= IP_HOURLY:
                return {'scope': 'hourly', 'retryAfter': int(_HOUR - (now - last_hour[0])) + 1}
            if count:
                stamps.append(now)
            _ip_hits[key] = stamps
        if len(_ip_hits) > 5000:
            for key in [k for k, v in _ip_hits.items() if not v or now - v[-1] > _DAY]:
                _ip_hits.pop(key, None)
    return None


def authorize(keys: List[str], requested_seconds: int, count_ip: bool = True) -> Tuple[Optional[Dict[str, Any]], int]:
    """(engel, izin verilen arama suresi). engel None ise cozum calisabilir."""
    if is_exempt(keys):
        return None, requested_seconds
    blocked = _ip_block(keys, count_ip)
    if blocked:
        return blocked, 0
    try:
        st = _status(keys)
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-read-failed')
        return None, requested_seconds  # sayac okunamadi diye kullaniciyi engelleme
    if not st['hasIdentity']:
        return None, requested_seconds  # yalniz IP: eski istemci, IP freni yeterli
    available = st['baseLeft'] + st['bonus']
    if available <= 0:
        return {'scope': 'budget', 'retryAfter': int(_DAY)}, 0
    return None, int(max(MIN_RUN_SECONDS, min(requested_seconds, math.ceil(available))))


def charge(keys: List[str], elapsed: float, count_attempt: bool) -> None:
    """Harcanan cozucu suresini butun kalici kimliklere yazar.

    Her kimlik KENDI kalan butcesinden duser. Onceki surum hepsine "en az kalan"
    kadarini yaziyordu; bir kimlik tukendiginde digerleri hic birikmiyordu. Olculdu
    (21 Eylul 2026): butcesi bitmis ama ek suresi olan bir hesabin cihaz ve parmak
    izi satirlari 0 sn'de kaldi, ayni cihazda yeni hesap acan sifirdan 25 dk aldi.
    """
    kalici = _persistent(keys)
    if not kalici or elapsed <= 0 or is_exempt(keys):
        return
    primary = _primary(keys)
    # Oturum acikken cihaz ve parmak izi satirlarina da hesap yazilir; yonetici
    # panelinde bu satirlarin kime ait oldugu gorunsun diye (usage_events de boyle).
    session_user = next((_user_id_of(k) for k in keys if k.startswith('user:')), None)
    attempt = 1 if count_attempt else 0
    try:
        rows = _rows(kalici)
        paylar: Dict[str, float] = {}
        for key in kalici:
            row = rows.get(key) or {'seconds_used': 0.0, 'created_at': None}
            paylar[key] = min(elapsed, max(0.0, base_left(row['seconds_used'], row['created_at'])))
        # Ek sure, kimliklerin ORTAK kalanini asan kisim kadar harcanir (authorize da
        # izni ortak kalana gore veriyor).
        ortak = min(paylar.values()) if paylar else 0.0
        from_bonus = int(math.ceil(elapsed - ortak)) if elapsed > ortak else 0
        if not DATABASE_URL:
            for key in kalici:
                row = _mem_rows.setdefault(key, {'seconds_used': 0.0, 'bonus': 0, 'created_at': None})
                row['seconds_used'] += paylar[key]
            return
        import psycopg

        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            for key in kalici:
                conn.execute(
                    """INSERT INTO solver_quota (key, user_id, total, seconds_used, last_solve_at)
                       VALUES (%s, %s, %s, %s, now())
                       ON CONFLICT (key) DO UPDATE
                       SET total = solver_quota.total + EXCLUDED.total,
                           seconds_used = solver_quota.seconds_used + EXCLUDED.seconds_used,
                           user_id = COALESCE(EXCLUDED.user_id, solver_quota.user_id),
                           last_solve_at = now()""",
                    (key, _user_id_of(key) or session_user, attempt, paylar[key]),
                )
            if from_bonus and primary:
                conn.execute(
                    'UPDATE solver_quota SET bonus = GREATEST(0, bonus - %s) WHERE key = %s', (from_bonus, primary)
                )
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-charge-failed')


def remaining(keys: List[str]) -> Dict[str, Any]:
    """Istemcinin gosterdigi kalan sure. Saymaz."""
    if is_exempt(keys):
        return {'secondsLeft': STARTER_SECONDS, 'bonusSeconds': 0, 'starterSeconds': STARTER_SECONDS,
                'monthlySeconds': MONTHLY_SECONDS, 'exempt': True}
    try:
        st = _status(keys)
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-read-failed')
        st = {'baseLeft': float(STARTER_SECONDS), 'bonus': 0, 'hasIdentity': False}
    return {
        'secondsLeft': int(st['baseLeft']) if st['hasIdentity'] else STARTER_SECONDS,
        'bonusSeconds': int(st['bonus']),
        'starterSeconds': STARTER_SECONDS,
        'monthlySeconds': MONTHLY_SECONDS,
        'exempt': False,
    }


# ── Istek ve destek notu ─────────────────────────────────────────────────────

def request_increase(keys: List[str]) -> bool:
    """Kullanicinin ek sure istegini yoneticinin gorecegi sekilde isaretler."""
    primary = _primary(keys)
    if not primary or not DATABASE_URL:
        return False
    try:
        import psycopg

        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            conn.execute(
                """INSERT INTO solver_quota (key, user_id, requested_at) VALUES (%s, %s, now())
                   ON CONFLICT (key) DO UPDATE SET requested_at = now()""",
                (primary, _user_id_of(primary)),
            )
        return True
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-request-failed')
        return False


def record_attempt(keys: List[str], info: Dict[str, object]) -> None:
    """Son denemenin ayarlarini ve sonucunu kisinin satirina yazar (destek icin)."""
    primary = _primary(keys)
    if not primary or not DATABASE_URL:
        return
    try:
        import psycopg
        from psycopg.types.json import Json

        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            conn.execute(
                """INSERT INTO solver_quota (key, user_id, last_attempt) VALUES (%s, %s, %s)
                   ON CONFLICT (key) DO UPDATE SET last_attempt = EXCLUDED.last_attempt""",
                (primary, _user_id_of(primary), Json(info)),
            )
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-attempt-write-failed')
