import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rec_agent.cache import FileCache  # noqa: E402
from rec_agent.controller import AudioController  # noqa: E402
from rec_agent.player import NullBackend  # noqa: E402
from rec_agent.scheduler import Scheduler  # noqa: E402
from rec_agent.store import Store  # noqa: E402
from rec_agent.timeutil import FakeClock  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


class Harness:
    """Controller + scheduler wired to a fake clock and a NullBackend whose durations come from metadata."""

    def __init__(self, tmp: Path, start: datetime, durations: dict[str, float] | None = None):
        self.tmp = tmp
        self.clock = FakeClock(start)
        self.durations = durations or {}
        self.events: list[dict] = []
        self.store = Store(tmp / "agent.db")
        self.cache = FileCache(tmp / "cache", "http://127.0.0.1:9", "t")
        self.backend = NullBackend(self._dur, monotonic=lambda: self.clock.now().timestamp())
        self.controller = AudioController(
            self.backend,
            now=self.clock.now,
            mono=lambda: self.clock.now().timestamp(),
            emit=self._emit,
        )
        self.scheduler = Scheduler(self.store, self.controller, self.cache, self.clock.now)

    def _emit(self, ev: dict) -> None:
        self.events.append(ev)
        self.store.save_event(ev)

    def _dur(self, path: Path) -> float:
        return self.durations.get(Path(path).stem.split("_")[0], 10.0)

    def file(self, name: str, seconds: float) -> Path:
        p = self.tmp / f"{name}.mp3"
        p.write_bytes(b"ID3fake")
        self.durations[name] = seconds
        return p

    def statuses(self, key: str) -> list[str]:
        return [e["status"] for e in self.events if e["eventKey"] == key]

    def advance(self, seconds: float, step: float = 0.5) -> None:
        t = 0.0
        while t < seconds:
            self.clock.advance(step)
            self.controller.tick()
            t += step

    async def run(self, seconds: float, step: float = 0.5) -> None:
        t = 0.0
        while t < seconds:
            self.clock.advance(step)
            self.controller.tick()
            await self.scheduler.tick()
            t += step


@pytest.fixture
def harness(tmp_path):
    def make(start=datetime(2026, 10, 25, 5, 0, tzinfo=timezone.utc), durations=None):
        return Harness(tmp_path, start, durations)

    return make
