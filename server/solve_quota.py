"""Sunucu cozucusu icin kisi basina kullanim kotasi.

Neden var: /solve/cpsat kimlik istemeden herkese acikti ve tek bir kullanici
ayni cozulmeyen veriyle yuzlerce kez deneyerek aylik sunucu butcesinin
neredeyse tamamini harcadi (Eylul 2026). Sunucu masrafi cepten odendigi icin
bir kisinin digerlerinin hakkini yemesini engelliyoruz.

Kimlik sirasi: oturum varsa kullanici (e-posta hesabi), yoksa cihaz kimligi,
o da yoksa IP. Yeni e-posta acarak kota sifirlanmasin diye CIHAZ ve IP de
ayrica sayilir; bir istek, anahtarlarindan HERHANGI biri dolduysa reddedilir.

Saatlik/gunluk pencere bellekte tutulur: tek sunucu sureci var ve yeniden
baslatmada sifirlanmasi kabul edilebilir (kota bir guvenlik siniri degil, butce
freni). Kalici olanlar veritabaninda (solver_quota tablosu):
  - toplam deneme: ilk FREE_TOTAL deneme sinirsizdir. Yeni bir okul verisini
    ilk gun oturtana kadar onlarca kez dener (olculdu: 76 deneme, sonunda
    programi olustu); bu normal kullanimdir, cezalandirilmaz.
  - bonus: yoneticinin panelden verdigi ek hak. Kota doluyken harcanir.
  - requested_at: kullanici uygulamadan limit artisi istediyse.
Veritabani hatasi cozumu hicbir zaman engellemez; yalnizca bellek sinirlari kalir.

Kota dolunca istemci tarayicidaki yedek cozucuye duser; kullanici yine program
uretebilir, yalnizca sunucuyu yormaz.
"""

from __future__ import annotations

import logging
import os
import re
import time
from threading import Lock
from typing import Dict, List, Optional, Tuple

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
HOURLY_LIMIT = _env_int('SOLVER_QUOTA_HOURLY', 12, 1, 1000)
DAILY_LIMIT = _env_int('SOLVER_QUOTA_DAILY', 30, 1, 10000)
# Bir kimligin ilk bu kadar denemesi saatlik/gunluk sinira takilmaz.
FREE_TOTAL = _env_int('SOLVER_QUOTA_FREE_TOTAL', 100, 0, 100000)
# Ayni IP'nin arkasinda butun bir okul (ogretmenler odasi) olabilir; IP siniri
# bu yuzden kisi sinirindan genis tutulur.
IP_FACTOR = 4

_HOUR = 3600.0
_DAY = 86400.0

_lock = Lock()
_hits: Dict[str, List[float]] = {}
_mem_totals: Dict[str, int] = {}  # yalniz veritabani yokken (yerel gelistirme)


def identity_keys(request: Request) -> List[str]:
    """Istegin kota anahtarlari; ilki 'asil' kimliktir (kalici sayac ona yazilir)."""
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


def _limits_for(key: str) -> Tuple[int, int]:
    if key.startswith('ip:'):
        return HOURLY_LIMIT * IP_FACTOR, DAILY_LIMIT * IP_FACTOR
    return HOURLY_LIMIT, DAILY_LIMIT


def _primary(keys: List[str]) -> Optional[str]:
    """Kalici sayacin yazildigi kimlik: hesap ya da cihaz. Yalnizca IP varsa yok."""
    return keys[0] if keys and not keys[0].startswith('ip:') else None


def _user_id_of(key: str) -> Optional[int]:
    return int(key.split(':', 1)[1]) if key.startswith('user:') else None


def _db_row(key: Optional[str]) -> Dict[str, int]:
    if not key or not DATABASE_URL:
        return {'total': _mem_totals.get(key or '', 0), 'bonus': 0}
    try:
        import psycopg

        with psycopg.connect(DATABASE_URL) as conn:
            row = conn.execute('SELECT total, bonus FROM solver_quota WHERE key = %s', (key,)).fetchone()
        return {'total': int(row[0]), 'bonus': int(row[1])} if row else {'total': 0, 'bonus': 0}
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-read-failed')
        # Okunamadiysa baslangic hakki VARMIS gibi davranmayiz; bellek sinirlari gecerli olur.
        return {'total': FREE_TOTAL, 'bonus': 0}


def _db_count(key: Optional[str], use_bonus: bool) -> bool:
    """Denemeyi kalici sayaca yazar. use_bonus ise bir ek hak harcar; hak yoksa False."""
    if not key:
        return not use_bonus
    if not DATABASE_URL:
        if use_bonus:
            return False
        _mem_totals[key] = _mem_totals.get(key, 0) + 1
        return True
    try:
        import psycopg

        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            if use_bonus:
                row = conn.execute(
                    """UPDATE solver_quota SET bonus = bonus - 1, total = total + 1, last_solve_at = now()
                       WHERE key = %s AND bonus > 0 RETURNING bonus""",
                    (key,),
                ).fetchone()
                return row is not None
            conn.execute(
                """INSERT INTO solver_quota (key, user_id, total, last_solve_at) VALUES (%s, %s, 1, now())
                   ON CONFLICT (key) DO UPDATE SET total = solver_quota.total + 1, last_solve_at = now()""",
                (key, _user_id_of(key)),
            )
        return True
    except Exception:  # pylint: disable=broad-except
        logger.exception('solver-quota-write-failed')
        return not use_bonus


def _window_block(key: str, now: float) -> Optional[Dict[str, int]]:
    stamps = [t for t in _hits.get(key, []) if now - t < _DAY]
    _hits[key] = stamps
    hourly, daily = _limits_for(key)
    last_hour = [t for t in stamps if now - t < _HOUR]
    if len(stamps) >= daily:
        return {'scope': 'daily', 'retryAfter': int(_DAY - (now - stamps[0])) + 1}
    if len(last_hour) >= hourly:
        return {'scope': 'hourly', 'retryAfter': int(_HOUR - (now - last_hour[0])) + 1}
    return None


def check_and_count(keys: List[str]) -> Optional[Dict[str, int]]:
    """Kota doluysa {'scope': ..., 'retryAfter': sn} doner, degilse sayar ve None doner."""
    now = time.time()
    primary = _primary(keys)
    in_free = primary is not None and _db_row(primary)['total'] < FREE_TOTAL
    blocked = None
    with _lock:
        for key in keys:
            # Baslangic hakki suruyorsa kisinin kendi siniri uygulanmaz; IP siniri
            # her zaman gecerli (cihaz kimligini sifirlayip sinirsiz deneme olmasin).
            if in_free and not key.startswith('ip:'):
                continue
            blocked = _window_block(key, now)
            if blocked:
                break
    if blocked:
        # Yoneticinin verdigi ek hak varsa onu harca ve izin ver.
        if not _db_count(primary, use_bonus=True):
            return blocked
    else:
        _db_count(primary, use_bonus=False)
    with _lock:
        for key in keys:
            # Baslangic hakkindaki denemeler kisinin penceresine yazilmaz; yoksa hak
            # bittigi anda saatlik/gunluk sinir de dolmus olur ve kisi bir gun bekler.
            if in_free and not key.startswith('ip:'):
                continue
            _hits.setdefault(key, []).append(now)
        # Bellek sizmasin: uzun suredir gorulmeyen anahtarlari at.
        if len(_hits) > 5000:
            for key in [k for k, v in _hits.items() if not v or now - v[-1] > _DAY]:
                _hits.pop(key, None)
    return None


def remaining(keys: List[str]) -> Dict[str, int]:
    """Kimligin kalan hakki (anahtarlari arasinda en dusuk olan). Saymaz."""
    primary = _primary(keys)
    row = _db_row(primary)
    free_left = max(0, FREE_TOTAL - row['total']) if primary else 0
    now = time.time()
    hourly_left, daily_left = HOURLY_LIMIT, DAILY_LIMIT
    with _lock:
        for key in keys:
            if free_left > 0 and not key.startswith('ip:'):
                continue
            stamps = [t for t in _hits.get(key, []) if now - t < _DAY]
            hourly, daily = _limits_for(key)
            hourly_left = min(hourly_left, hourly - len([t for t in stamps if now - t < _HOUR]))
            daily_left = min(daily_left, daily - len(stamps))
    return {
        'hourlyLeft': max(0, hourly_left),
        'hourlyLimit': HOURLY_LIMIT,
        'dailyLeft': max(0, daily_left),
        'dailyLimit': DAILY_LIMIT,
        'freeLeft': free_left,
        'bonus': row['bonus'],
    }


def request_increase(keys: List[str]) -> bool:
    """Kullanicinin limit artisi istegini yoneticinin gorecegi sekilde isaretler."""
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


def window_used(key: str) -> Dict[str, int]:
    """Yonetici paneli icin: kimligin bellekteki son 1 saat / 24 saat denemesi."""
    now = time.time()
    with _lock:
        stamps = [t for t in _hits.get(key, []) if now - t < _DAY]
    return {'hour': len([t for t in stamps if now - t < _HOUR]), 'day': len(stamps)}
