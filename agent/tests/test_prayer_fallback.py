"""Offline prayer computation must match the server's plan (same algorithm, two implementations)
and published Umm al-Qura timetables."""
import json
from datetime import datetime

import pytest

from rec_agent.prayer_fallback import compute_day
from rec_agent.timeutil import local_time

from conftest import FIXTURES

PRAYERS = ("FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA")


def test_matches_server_plan_for_two_years():
    data = json.loads((FIXTURES / "riyadh_server_plan_2026_2027.json").read_text())
    worst = 0.0
    for day in data["days"]:
        local = {e["prayer"]: e["at"] for e in compute_day(day["date"], data["params"], [], [])}
        for p in PRAYERS:
            server = datetime.fromisoformat(day["times"][p].replace("Z", "+00:00"))
            diff = abs((local[p] - server).total_seconds())
            worst = max(worst, diff)
            assert diff <= 60, f"{day['date']} {p}: agent {local[p]} vs server {server}"
    # identical algorithm → expect exact agreement (rounded minutes)
    assert worst == 0, f"max deviation {worst}s"


def test_ramadan_isha_is_120_minutes_after_maghrib():
    params = {"latitude": 24.7136, "longitude": 46.6753, "timezone": "Asia/Riyadh", "method": "UMM_AL_QURA", "madhab": "SHAFI", "ramadanIshaExtra": True}
    e = {x["prayer"]: x["at"] for x in compute_day("2026-03-01", params, [], [])}  # 12 Ramadan 1447
    assert (e["ISHA"] - e["MAGHRIB"]).total_seconds() == 120 * 60
    e = {x["prayer"]: x["at"] for x in compute_day("2026-04-15", params, [], [])}
    assert (e["ISHA"] - e["MAGHRIB"]).total_seconds() == 90 * 60


@pytest.mark.parametrize("row", json.loads((FIXTURES / "riyadh_reference_oct2026.json").read_text())["rows"])
def test_matches_published_umm_al_qura_timetable(row):
    params = {"latitude": 24.7136, "longitude": 46.6753, "timezone": "Asia/Riyadh", "method": "UMM_AL_QURA", "madhab": "SHAFI", "ramadanIshaExtra": True}
    date, *expected = row
    got = {x["prayer"]: local_time(x["at"], "Asia/Riyadh") for x in compute_day(date, params, [], [])}
    for p, exp in zip(PRAYERS, expected):
        gh, gm = map(int, got[p].split(":"))
        eh, em = map(int, exp.split(":"))
        assert abs((gh * 60 + gm) - (eh * 60 + em)) <= 1, f"{date} {p}: {got[p]} vs published {exp}"


def test_precedence_override_fixed_offset():
    params = {"latitude": 24.7136, "longitude": 46.6753, "timezone": "Asia/Riyadh", "method": "UMM_AL_QURA", "madhab": "SHAFI", "ramadanIshaExtra": True}
    configs = [
        {"prayer": "FAJR", "adhanEnabled": True, "fileId": "f", "volume": None, "offsetMinutes": 2, "fixedTime": None},
        {"prayer": "DHUHR", "adhanEnabled": True, "fileId": "f", "volume": None, "offsetMinutes": 0, "fixedTime": "12:00"},
        {"prayer": "ASR", "adhanEnabled": False, "fileId": "f", "volume": None, "offsetMinutes": 0, "fixedTime": None},
    ]
    overrides = [{"date": "2026-10-25", "prayer": "MAGHRIB", "time": "17:20"}]
    got = {x["prayer"]: x for x in compute_day("2026-10-25", params, configs, overrides)}
    assert local_time(got["FAJR"]["at"], "Asia/Riyadh") == "04:39"  # 04:37 + 2
    assert local_time(got["DHUHR"]["at"], "Asia/Riyadh") == "12:00"
    assert got["ASR"]["adhanEnabled"] is False
    assert local_time(got["MAGHRIB"]["at"], "Asia/Riyadh") == "17:20"
