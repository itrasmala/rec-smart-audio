"""Time helpers. Local dates are 'YYYY-MM-DD', local times 'HH:mm' in the org time zone."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


class Clock:
    """Real clock. Tests substitute FakeClock."""

    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class FakeClock(Clock):
    def __init__(self, start: datetime):
        self._now = start

    def now(self) -> datetime:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)

    def set(self, dt: datetime) -> None:
        self._now = dt


def tz(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def local_date(dt: datetime, tzname: str) -> str:
    return dt.astimezone(tz(tzname)).strftime("%Y-%m-%d")


def local_time(dt: datetime, tzname: str) -> str:
    return dt.astimezone(tz(tzname)).strftime("%H:%M")


def zoned_to_utc(date_str: str, time_str: str, tzname: str) -> datetime:
    y, m, d = (int(x) for x in date_str.split("-"))
    hh, mm = (int(x) for x in time_str.split(":"))
    return datetime(y, m, d, hh, mm, tzinfo=tz(tzname)).astimezone(timezone.utc)


def add_days(date_str: str, days: int) -> str:
    return (date.fromisoformat(date_str) + timedelta(days=days)).isoformat()


def weekday_of(date_str: str) -> int:
    """0 = Sunday … 6 = Saturday (same convention as the server)."""
    return (date.fromisoformat(date_str).weekday() + 1) % 7


def parse_iso(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
