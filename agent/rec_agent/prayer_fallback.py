"""Local prayer-time computation, used only when the server-provided plan does not cover a date
(e.g. the device stayed offline for longer than the plan horizon).

Uses `adhanpy` (port of the same `adhan` library the server uses) so results match the plan;
see tests/test_prayer_fallback.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from .timeutil import zoned_to_utc

PRAYERS = ("FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA")


def _is_ramadan(date_str: str) -> bool:
    try:
        from hijridate import Gregorian

        y, m, d = (int(x) for x in date_str.split("-"))
        return Gregorian(y, m, d).to_hijri().month == 9
    except Exception:  # out of supported range or library missing
        return False


def _round_like_adhan_js(when: datetime) -> datetime:
    """adhan-js rounding: seconds >= 30 → next minute, else floor.
    (adhanpy uses Python's banker's rounding and drops the carry at minute 59, which makes
    e.g. 08:59:40 become 08:59 instead of 09:00 — see tests/test_prayer_fallback.py.)"""
    base = when.replace(second=0, microsecond=0)
    return base + timedelta(minutes=1) if when.second >= 30 else base


def _prayer_times_cls():
    from adhanpy.PrayerTimes import PrayerTimes

    class _PrayerTimes(PrayerTimes):
        def _rounded_minute(self, adjustments, method_adjustments, prayer_name, temp_prayer):  # noqa: D401
            adj = getattr(adjustments, prayer_name) + getattr(method_adjustments, prayer_name)
            return _round_like_adhan_js(temp_prayer + timedelta(minutes=adj))

    return _PrayerTimes


def compute_astronomical(date_str: str, params: dict) -> dict[str, datetime]:
    PrayerTimes = _prayer_times_cls()
    from adhanpy.calculation.CalculationMethod import CalculationMethod
    from adhanpy.calculation.CalculationParameters import CalculationParameters
    from adhanpy.calculation.Madhab import Madhab

    method_name = params.get("method", "UMM_AL_QURA")
    method = getattr(CalculationMethod, method_name, CalculationMethod.UMM_AL_QURA)
    cp = CalculationParameters(method=method)
    cp.madhab = Madhab.HANAFI if params.get("madhab") == "HANAFI" else Madhab.SHAFI
    if method_name == "UMM_AL_QURA" and params.get("ramadanIshaExtra", True) and _is_ramadan(date_str):
        cp.isha_interval = 120
    y, m, d = (int(x) for x in date_str.split("-"))
    pt = PrayerTimes((params["latitude"], params["longitude"]), datetime(y, m, d), calculation_parameters=cp)
    out = {"FAJR": pt.fajr, "DHUHR": pt.dhuhr, "ASR": pt.asr, "MAGHRIB": pt.maghrib, "ISHA": pt.isha}
    return {k: (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(timezone.utc) for k, v in out.items()}


def compute_day(date_str: str, params: dict, configs: list[dict], overrides: list[dict]) -> list[dict]:
    """Same precedence as the server: date override > fixed time (+offset) > computed (+offset)."""
    astro = compute_astronomical(date_str, params)
    tzname = params.get("timezone", "Asia/Riyadh")
    cfg_map = {c["prayer"]: c for c in configs}
    entries = []
    for prayer in PRAYERS:
        cfg = cfg_map.get(prayer, {"adhanEnabled": True, "fileId": None, "volume": None, "offsetMinutes": 0, "fixedTime": None})
        ov: Optional[dict] = next((o for o in overrides if o["date"] == date_str and o["prayer"] == prayer), None)
        offset = timedelta(minutes=int(cfg.get("offsetMinutes") or 0))
        if ov:
            at = zoned_to_utc(date_str, ov["time"], tzname)
        elif cfg.get("fixedTime"):
            at = zoned_to_utc(date_str, cfg["fixedTime"], tzname) + offset
        else:
            at = astro[prayer] + offset
        entries.append(
            {
                "key": f"adhan:{date_str}:{prayer}",
                "date": date_str,
                "prayer": prayer,
                "at": at,
                "adhanEnabled": bool(cfg.get("adhanEnabled", True)),
                "fileId": cfg.get("fileId"),
                "volume": cfg.get("volume"),
                "fallback": True,
            }
        )
    return entries
