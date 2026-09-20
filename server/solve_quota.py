"""Sunucu cozucusu icin kisi basina kullanim kotasi.

Neden var: /solve/cpsat kimlik istemeden herkese acikti ve tek bir kullanici
ayni cozulmeyen veriyle yuzlerce kez deneyerek aylik sunucu butcesinin
neredeyse tamamini harcadi (Eylul 2026). Sunucu masrafi cepten odendigi icin
bir kisinin digerlerinin hakkini yemesini engelliyoruz.

Kimlik sirasi: oturum varsa kullanici (e-posta hesabi), yoksa cihaz kimligi,
o da yoksa IP. Yeni e-posta acarak kota sifirlanmasin diye CIHAZ ve IP de
ayrica sayilir; bir istek, anahtarlarindan HERHANGI biri dolduysa reddedilir.

Sayac bellekte tutulur: tek sunucu sureci var ve yeniden baslatmada
sifirlanmasi kabul edilebilir (kota bir guvenlik siniri degil, butce freni).

Kota dolunca istemci tarayicidaki yedek cozucuye duser; kullanici yine program
uretebilir, yalnizca sunucuyu yormaz.
"""

from __future__ import annotations

import os
import re
import time
from threading import Lock
from typing import Dict, List, Optional, Tuple

from fastapi import Request

_DEVICE_RE = re.compile(r'^[A-Za-z0-9-]{8,64}$')


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(os.environ.get(name, str(default)))))
    except (TypeError, ValueError):
        return default


# Ortam degiskeniyle ayarlanabilir; Railway'de degistirip yeniden dagitmak yeter.
HOURLY_LIMIT = _env_int('SOLVER_QUOTA_HOURLY', 12, 1, 1000)
DAILY_LIMIT = _env_int('SOLVER_QUOTA_DAILY', 30, 1, 10000)
# Ayni IP'nin arkasinda butun bir okul (ogretmenler odasi) olabilir; IP siniri
# bu yuzden kisi sinirindan genis tutulur.
IP_FACTOR = 4

_HOUR = 3600.0
_DAY = 86400.0

_lock = Lock()
_hits: Dict[str, List[float]] = {}


def identity_keys(request: Request) -> List[str]:
    """Istegin kota anahtarlari; ilki 'asil' kimliktir (geri cekilme ona yazilir)."""
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


def check_and_count(keys: List[str]) -> Optional[Dict[str, int]]:
    """Kota doluysa {'scope': ..., 'retryAfter': sn} doner, degilse sayar ve None doner."""
    now = time.time()
    with _lock:
        for key in keys:
            stamps = [t for t in _hits.get(key, []) if now - t < _DAY]
            _hits[key] = stamps
            hourly, daily = _limits_for(key)
            last_hour = [t for t in stamps if now - t < _HOUR]
            if len(stamps) >= daily:
                return {'scope': 'daily', 'retryAfter': int(_DAY - (now - stamps[0])) + 1}
            if len(last_hour) >= hourly:
                return {'scope': 'hourly', 'retryAfter': int(_HOUR - (now - last_hour[0])) + 1}
        for key in keys:
            _hits.setdefault(key, []).append(now)
        # Bellek sizmasin: uzun suredir gorulmeyen anahtarlari at.
        if len(_hits) > 5000:
            for key in [k for k, v in _hits.items() if not v or now - v[-1] > _DAY]:
                _hits.pop(key, None)
    return None


def remaining(keys: List[str]) -> Dict[str, int]:
    """Kimligin kalan hakki (anahtarlari arasinda en dusuk olan). Saymaz."""
    now = time.time()
    hourly_left, daily_left = HOURLY_LIMIT, DAILY_LIMIT
    with _lock:
        for key in keys:
            stamps = [t for t in _hits.get(key, []) if now - t < _DAY]
            hourly, daily = _limits_for(key)
            hourly_left = min(hourly_left, hourly - len([t for t in stamps if now - t < _HOUR]))
            daily_left = min(daily_left, daily - len(stamps))
    return {
        'hourlyLeft': max(0, hourly_left),
        'hourlyLimit': HOURLY_LIMIT,
        'dailyLeft': max(0, daily_left),
        'dailyLimit': DAILY_LIMIT,
    }
