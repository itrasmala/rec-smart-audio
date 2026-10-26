import json
from pathlib import Path

from rec_agent.recurrence import event_key, occurrence_at, occurs_on
from rec_agent.timeutil import iso, parse_iso

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared/test-vectors/recurrence.json").read_text())


def test_shared_recurrence_vectors():
    tz = VECTORS["timezone"]
    prayers = {k: parse_iso(v) for k, v in VECTORS["prayers"].items()}
    lookup = lambda d, p: prayers.get(f"{d}:{p}")  # noqa: E731
    for case in VECTORS["cases"]:
        s = case["schedule"]
        for date, exp in case["expect"].items():
            at = occurrence_at(s, date, tz, lookup) if occurs_on(s, date) else None
            if exp is None:
                assert at is None, f"{s['id']} {date} should not occur"
            else:
                assert at is not None, f"{s['id']} {date} should occur"
                assert iso(at)[:19] == exp[0][:19], f"{s['id']} {date}: {iso(at)} != {exp[0]}"
                assert event_key(s, date, at, tz) == exp[1]
