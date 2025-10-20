from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, Optional

RC_API_BASE = os.environ.get("RC_API_BASE_URL", "https://api.revenuecat.com")
RC_SECRET_KEY = os.environ.get("RC_SECRET_API_KEY") or os.environ.get("RC_SECRET_KEY")
RC_ENTITLEMENT_ID = os.environ.get("RC_ENTITLEMENT_ID")


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except ValueError:
        return None


def fetch_entitlement(app_user_id: str, entitlement_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not RC_SECRET_KEY:
        return None
    entitlement_key = entitlement_id or RC_ENTITLEMENT_ID
    if not entitlement_key:
        return None

    encoded_user = urllib.parse.quote(app_user_id, safe="")
    url = f"{RC_API_BASE.rstrip('/')}/v1/subscribers/{encoded_user}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {RC_SECRET_KEY}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, socket.timeout, TimeoutError, json.JSONDecodeError):
        return None

    subscriber = payload.get("subscriber")
    if not isinstance(subscriber, dict):
        return None

    entitlements = subscriber.get("entitlements")
    if not isinstance(entitlements, dict):
        return None

    entitlement = entitlements.get(entitlement_key)
    if not isinstance(entitlement, dict):
        return None

    entitlement["parsed_expires_date"] = _parse_datetime(entitlement.get("expires_date"))
    entitlement["parsed_purchase_date"] = _parse_datetime(entitlement.get("original_purchase_date"))
    return entitlement
