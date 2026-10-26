"""Local persistent state (SQLite). Survives restarts and network loss.

Tables:
  kv          — last config snapshot, device volume, misc.
  executed    — event keys already triggered (prevents double adhan/announcement).
  events      — playback log entries; `synced=0` until the server acknowledges them.
  commands    — processed command ids (idempotent delivery).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS executed (key TEXT PRIMARY KEY, at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  key TEXT PRIMARY KEY, body TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0, updated REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS events_unsynced ON events(synced, updated);
CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, at REAL NOT NULL);
"""


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")  # durability over speed: power loss must not replay adhan
        self._db.executescript(SCHEMA)

    # ---- kv ----
    def get(self, k: str, default: Any = None) -> Any:
        with self._lock:
            row = self._db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, k: str, v: Any) -> None:
        with self._lock:
            self._db.execute("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))

    # ---- executed keys ----
    def try_mark_executed(self, key: str) -> bool:
        """Atomically mark a key. Returns False if it was already executed."""
        with self._lock:
            cur = self._db.execute("INSERT OR IGNORE INTO executed(key, at) VALUES(?, ?)", (key, time.time()))
            return cur.rowcount == 1

    def is_executed(self, key: str) -> bool:
        with self._lock:
            return self._db.execute("SELECT 1 FROM executed WHERE key=?", (key,)).fetchone() is not None

    # ---- events ----
    def save_event(self, ev: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO events(key, body, synced, updated) VALUES(?,?,0,?) "
                "ON CONFLICT(key) DO UPDATE SET body=excluded.body, synced=0, updated=excluded.updated",
                (ev["eventKey"], json.dumps(ev, ensure_ascii=False), time.time()),
            )

    def unsynced_events(self, limit: int = 200) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT body FROM events WHERE synced=0 ORDER BY updated LIMIT ?", (limit,)
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def mark_synced(self, keys: list[str], sent_before: float | None = None) -> None:
        """Mark keys synced. If an event changed after it was sent (updated > sent_before) keep it pending."""
        if not keys:
            return
        with self._lock:
            for k in keys:
                if sent_before is None:
                    self._db.execute("UPDATE events SET synced=1 WHERE key=?", (k,))
                else:
                    self._db.execute("UPDATE events SET synced=1 WHERE key=? AND updated<=?", (k, sent_before))

    def recent_events(self, limit: int = 20) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT body FROM events ORDER BY updated DESC LIMIT ?", (limit,)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def unsynced_count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM events WHERE synced=0").fetchone()[0]

    # ---- commands ----
    def command_seen(self, cid: str) -> bool:
        with self._lock:
            cur = self._db.execute("INSERT OR IGNORE INTO commands(id, at) VALUES(?, ?)", (cid, time.time()))
            return cur.rowcount == 0

    # ---- housekeeping ----
    def prune(self, keep_days: int = 14) -> None:
        cutoff = time.time() - keep_days * 86400
        with self._lock:
            self._db.execute("DELETE FROM executed WHERE at < ?", (cutoff,))
            self._db.execute("DELETE FROM events WHERE synced=1 AND updated < ?", (cutoff,))
            self._db.execute("DELETE FROM commands WHERE at < ?", (cutoff,))

    def close(self) -> None:
        with self._lock:
            self._db.close()
