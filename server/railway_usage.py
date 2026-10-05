"""Railway'deki GERCEK fatura durumunu okur.

Neden: uygulamadaki "ortak havuz" cubugu cozucunun saniyelerini sayiyor, ama
fatura dokumune gore (5 Ekim 2026) masrafin %64'u bellek, yani sunucunun bosta
ayakta durmasi. Bu yuzden cubuk %18 gosterirken gelistiricinin 5 dolari bitmis
olabiliyordu. Kullaniciya anlamli olan sayi para; burasi onu Railway'den alir.

Anahtar verilmezse (RAILWAY_API_TOKEN bos) butun fonksiyonlar None doner ve
uygulama eski davranisina, yani cozucu suresi havuzuna, duser.

Sorgu alanlari Railway'in acik GraphQL semasindan alindi (backboard /graphql/v2):
  me { workspaces { id name } }
  workspace(workspaceId:) { customer { currentUsage billingPeriod { start end } } }
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

logger = logging.getLogger("railway-usage")

ENDPOINT = "https://backboard.railway.com/graphql/v2"
TOKEN = (os.environ.get("RAILWAY_API_TOKEN") or "").strip()
WORKSPACE_ID = (os.environ.get("RAILWAY_WORKSPACE_ID") or "").strip()

# Donem basina cebimizden odemeyi goze aldigimiz tutar. Hobby planinda 5 dolar
# dahil; bunun ustu faturaya biniyor.
BUDGET_USD = float(os.environ.get("SERVER_BUDGET_USD", "5"))

# currentUsage'in birimi hesaba gore sent de olabilir dolar da. Railway dolar
# dondurur; bir aksilik olursa RAILWAY_USAGE_DIVISOR ile duzeltilir (sent icin 100).
DIVISOR = float(os.environ.get("RAILWAY_USAGE_DIVISOR", "1") or 1)

# Railway Hobby'de saatte 1000 istek siniri var; 15 dakikada bir yeter.
CACHE_SECONDS = int(os.environ.get("RAILWAY_USAGE_CACHE_SECONDS", "900"))

# Teshis: panelde "neden baglanmadi" diye bakabilmek icin son hata ve son yanit.
son_hata: Dict[str, Any] = {"mesaj": None, "yanit": None}

_lock = threading.Lock()
_cache: Dict[str, Any] = {"at": 0.0, "value": None}
_workspace: Dict[str, Any] = {"id": WORKSPACE_ID or None}


def enabled() -> bool:
    return bool(TOKEN)


def _post(query: str, variables: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    govde = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    istek = urllib.request.Request(
        ENDPOINT,
        data=govde,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {TOKEN}",
            # Railway'in onundeki Cloudflare, urllib'in varsayilan
            # "Python-urllib/3.x" kimligini bot sayip HTTP 403 / error code 1010
            # donuyordu (olculdu 5 Ekim 2026). Kendimizi tanitan duzgun bir
            # User-Agent sorunu cozuyor; anahtarla ilgisi yoktu.
            "User-Agent": "DersTimeTable/1.0 (+https://idare.ozarik.org)",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(istek, timeout=10) as cevap:
            yanit = json.loads(cevap.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        govde_metni = ""
        try:
            govde_metni = err.read().decode("utf-8")[:300]
        except Exception:  # pylint: disable=broad-except
            pass
        son_hata["mesaj"] = f"HTTP {err.code}: {govde_metni}"
        logger.warning("railway-usage-http-error: %s", son_hata["mesaj"])
        return None
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        son_hata["mesaj"] = f"{type(err).__name__}: {err}"
        logger.warning("railway-usage-request-failed: %s", err)
        return None
    if yanit.get("errors"):
        # Yanlis anahtar ya da degismis sema: sessizce eski davranisa dus.
        son_hata["mesaj"] = json.dumps(yanit["errors"][:2])[:400]
        logger.warning("railway-usage-graphql-error: %s", son_hata["mesaj"])
        return None
    son_hata["mesaj"] = None
    return yanit.get("data")


def _workspace_id() -> Optional[str]:
    """Anahtar verildiyse calisma alani kimligini kendi bulur."""
    if _workspace["id"]:
        return _workspace["id"]
    data = _post("query Me { me { id email workspaces { id name } } }")
    son_hata["yanit"] = data
    alanlar = ((data or {}).get("me") or {}).get("workspaces") or []
    if alanlar:
        # Birden fazlaysa ilki; tek calisma alani olan hesapta zaten tek secenek var.
        _workspace["id"] = alanlar[0].get("id")
        return _workspace["id"]

    # Yedek yol: bazi anahtarlar calisma alanini listelemiyor ama projeleri
    # gorebiliyor; Project.workspaceId ayni bilgiyi veriyor.
    data = _post(
        "query MyProjects { me { projects { edges { node { id name workspaceId } } } } }"
    )
    son_hata["yanit"] = son_hata["yanit"] or data
    kenarlar = (((data or {}).get("me") or {}).get("projects") or {}).get("edges") or []
    for kenar in kenarlar:
        wid = ((kenar or {}).get("node") or {}).get("workspaceId")
        if wid:
            _workspace["id"] = wid
            return wid
    return None


def status() -> Optional[Dict[str, Any]]:
    """{'billUsedUsd', 'billBudgetUsd', 'billPeriodEnd'} ya da None.

    None donmesi bir hata degildir: anahtar yoksa ya da Railway'e ulasilamazsa
    uygulama cozucu suresi havuzunu gostermeye devam eder.
    """
    if not TOKEN:
        return None
    with _lock:
        if _cache["value"] is not None and (time.time() - _cache["at"]) < CACHE_SECONDS:
            return _cache["value"]
    alan = _workspace_id()
    if not alan:
        return None
    data = _post(
        """query WorkspaceBilling($workspaceId: String!) {
             workspace(workspaceId: $workspaceId) {
               customer { currentUsage billingPeriod { start end } }
             }
           }""",
        {"workspaceId": alan},
    )
    musteri = ((data or {}).get("workspace") or {}).get("customer") or {}
    ham = musteri.get("currentUsage")
    if ham is None:
        return None
    try:
        kullanilan = float(ham) / (DIVISOR or 1)
    except (TypeError, ValueError):
        return None
    sonuc = {
        "billUsedUsd": round(kullanilan, 4),
        "billBudgetUsd": BUDGET_USD,
        "billPeriodEnd": ((musteri.get("billingPeriod") or {}).get("end")),
    }
    with _lock:
        _cache["at"] = time.time()
        _cache["value"] = sonuc
    return sonuc


def raw_usage() -> Optional[Any]:
    """Yonetici panelinde birimi dogrulamak icin ham deger (sent mi dolar mi)."""
    if not TOKEN:
        return None
    alan = _workspace_id()
    if not alan:
        return None
    data = _post(
        """query WorkspaceBilling($workspaceId: String!) {
             workspace(workspaceId: $workspaceId) {
               customer { currentUsage billingPeriod { start end } }
             }
           }""",
        {"workspaceId": alan},
    )
    return ((data or {}).get("workspace") or {}).get("customer")
