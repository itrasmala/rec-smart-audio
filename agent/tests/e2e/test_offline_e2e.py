"""End-to-end: real server + real agent process + a TCP proxy we can cut to simulate an internet outage.

Run (server must be running and an admin account must exist):
    REC_E2E_SERVER=http://localhost:4000 REC_E2E_USER=admin REC_E2E_PASSWORD='...' \
        python -m pytest -m e2e tests/e2e -s

Scenario
  1. create a device + upload an announcement + schedule it ~1 minute ahead
  2. start the agent (null audio backend) behind the proxy; live "play" command round-trip
  3. cut the proxy → agent offline
  4. scheduled time passes → agent plays it from its local schedule (offline)
  5. restart the agent process while still offline → must NOT replay the announcement
  6. restore the proxy → agent reconnects and syncs the log: exactly one row, offline=True, COMPLETED
"""
from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

SERVER = os.environ.get("REC_E2E_SERVER", "http://localhost:4000")
USER = os.environ.get("REC_E2E_USER", "admin")
PASSWORD = os.environ.get("REC_E2E_PASSWORD", "")
AGENT_DIR = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.e2e


class CuttableProxy:
    """Minimal TCP proxy (localhost:listen → server) that can be switched off and on."""

    def __init__(self, target_host: str, target_port: int):
        self.target = (target_host, target_port)
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        self.port = s.getsockname()[1]
        s.close()
        self.loop = asyncio.new_event_loop()
        self.server = None
        self.conns: set[asyncio.StreamWriter] = set()
        threading.Thread(target=self.loop.run_forever, daemon=True).start()

    async def _pipe(self, r, w):
        try:
            while data := await r.read(65536):
                w.write(data)
                await w.drain()
        except Exception:
            pass
        finally:
            w.close()

    async def _handle(self, cr, cw):
        try:
            sr, sw = await asyncio.open_connection(*self.target)
        except OSError:
            cw.close()
            return
        self.conns.update({cw, sw})
        await asyncio.gather(self._pipe(cr, sw), self._pipe(sr, cw))

    def up(self):
        async def start():
            self.server = await asyncio.start_server(self._handle, "127.0.0.1", self.port)
        asyncio.run_coroutine_threadsafe(start(), self.loop).result()

    def down(self):
        async def stop():
            if self.server:
                self.server.close()  # stop accepting (don't await wait_closed: it waits for live conns)
                self.server = None
            for w in list(self.conns):
                w.transport.abort()
            self.conns.clear()
        asyncio.run_coroutine_threadsafe(stop(), self.loop).result()


def wait_for(pred, timeout, step=0.5, what="condition"):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = pred()
        if v:
            return v
        time.sleep(step)
    raise AssertionError(f"timeout waiting for {what}")


@pytest.fixture(scope="module")
def api():
    if not PASSWORD:
        pytest.skip("set REC_E2E_PASSWORD")
    c = httpx.Client(base_url=SERVER, timeout=20)
    r = c.post("/api/auth/login", json={"username": USER, "password": PASSWORD})
    r.raise_for_status()
    yield c
    c.close()


def test_offline_schedule_restart_and_sync(api, tmp_path):
    # ---------- 1. setup ----------
    r = api.post("/api/devices", json={"name": f"E2E {int(time.time())}", "outputType": "AUX"})
    r.raise_for_status()
    device_id, token = r.json()["device"]["id"], r.json()["token"]

    sys.path.insert(0, str(AGENT_DIR))
    from rec_agent.tone import make_test_tone

    wav = make_test_tone(tmp_path / "e2e.wav")
    with open(wav, "rb") as f:
        r = api.post("/api/files", data={"category": "ADMIN_ALERT", "title": "E2E announcement"}, files={"file": ("e2e.wav", f, "audio/wav")})
    r.raise_for_status()
    file_id = r.json()["file"]["id"]

    tz = ZoneInfo("Asia/Riyadh")
    fire = (datetime.now(tz) + timedelta(seconds=80)).replace(second=0, microsecond=0)
    if fire - datetime.now(tz) < timedelta(seconds=45):
        fire += timedelta(minutes=1)
    r = api.post("/api/schedules", json={
        "name": "E2E offline schedule", "fileId": file_id, "recurrence": "ONCE", "anchor": "FIXED_TIME",
        "time": fire.strftime("%H:%M"), "startDate": fire.strftime("%Y-%m-%d"), "allDevices": False, "deviceIds": [device_id],
    })
    r.raise_for_status()
    schedule_id = r.json()["schedule"]["id"]
    key = f"sched:{schedule_id}:{fire.strftime('%Y-%m-%d')}T{fire.strftime('%H:%M')}"

    host, port = SERVER.split("://")[1].split(":")
    proxy = CuttableProxy(host, int(port))
    proxy.up()
    data_dir = tmp_path / "agent-data"
    cfg = tmp_path / "config.toml"
    cfg.write_text(
        f'server_url = "http://127.0.0.1:{proxy.port}"\ntoken = "{token}"\ndata_dir = "{data_dir.as_posix()}"\n'
        'backend = "null"\nhealth_port = 0\ninternet_check = "127.0.0.1:9"\nstatus_interval = 2\n'
    )
    log_file = open(tmp_path / "agent.log", "w")

    def start_agent():
        return subprocess.Popen([sys.executable, "-m", "rec_agent", "--config", str(cfg)], cwd=AGENT_DIR, stdout=log_file, stderr=subprocess.STDOUT)

    def device():
        return next(d for d in api.get("/api/devices").json()["devices"] if d["id"] == device_id)

    agent = start_agent()
    try:
        # ---------- 2. online + live command ----------
        wait_for(lambda: device()["isOnline"] and device()["configRevision"] > 0, 30, what="agent online with config")
        r = api.post(f"/api/devices/{device_id}/commands", json={"type": "test_speakers", "payload": {}, "wait": True})
        assert r.json()["ack"]["ok"] is True, r.text

        # ---------- 3. cut the network ----------
        proxy.down()
        wait_for(lambda: not device()["isOnline"], 60, what="server to see the agent offline")

        # ---------- 4. scheduled time passes while offline ----------
        wait_for(lambda: datetime.now(tz) > fire + timedelta(seconds=4), 200, step=1, what="schedule time")
        logs = api.get("/api/logs/playback", params={"deviceId": device_id}).json()["rows"]
        assert not any(r["eventKey"] == key for r in logs), "server cannot know yet — agent is offline"

        # ---------- 5. restart the agent while still offline ----------
        agent.terminate()
        agent.wait(15)
        agent = start_agent()
        time.sleep(6)

        # ---------- 6. restore network → sync ----------
        proxy.up()
        rows = wait_for(
            lambda: [r for r in api.get("/api/logs/playback", params={"deviceId": device_id}).json()["rows"] if r["eventKey"] == key and r["status"] == "COMPLETED"],
            60, what="offline playback synced")
        assert len(rows) == 1
        assert rows[0]["offline"] is True
        all_rows = [r for r in api.get("/api/logs/playback", params={"deviceId": device_id, "pageSize": 200}).json()["rows"] if r["eventKey"] == key]
        assert len(all_rows) == 1, "exactly one log entry — no duplicate after restart/sync"
        started = datetime.fromisoformat(rows[0]["startedAt"].replace("Z", "+00:00"))
        assert abs((started - fire).total_seconds()) < 3, f"played at {started}, scheduled {fire}"
        log_text = (tmp_path / "agent.log").read_text()
        assert log_text.count(f"▶ ANNOUNCEMENT [SCHEDULE] E2E offline schedule") == 1, "played exactly once"
    finally:
        agent.terminate()
        try:
            agent.wait(10)
        except subprocess.TimeoutExpired:
            agent.kill()
        proxy.down()
        api.delete(f"/api/schedules/{schedule_id}")
        api.post(f"/api/devices/{device_id}/revoke")
        api.delete(f"/api/devices/{device_id}")
