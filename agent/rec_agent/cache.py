"""Offline audio cache. Files are stored as <sha256>.<ext> and verified after download."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from pathlib import Path
from typing import Optional

import httpx

log = logging.getLogger("rec.cache")


class FileCache:
    def __init__(self, root: Path, server_url: str, token: str, verify_tls: bool | str = True):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.verify_tls = verify_tls
        self.meta: dict[str, dict] = {}  # fileId → {sha256, format, title, durationSec, essential}
        self._locks: dict[str, asyncio.Lock] = {}
        self.last_error: Optional[str] = None

    def set_files(self, files: list[dict]) -> None:
        self.meta = {f["id"]: f for f in files}

    def path_for(self, file_id: str) -> Optional[Path]:
        m = self.meta.get(file_id)
        if not m:
            return None
        return self.root / f"{m['sha256']}.{m['format']}"

    def has(self, file_id: str) -> bool:
        p = self.path_for(file_id)
        return bool(p and p.exists())

    def duration(self, file_id: str) -> float:
        return float(self.meta.get(file_id, {}).get("durationSec") or 0.0)

    def missing(self, only_essential: bool = False) -> list[str]:
        return [fid for fid, m in self.meta.items() if (m.get("essential") or not only_essential) and not self.has(fid)]

    async def ensure(self, file_id: str, sha256: Optional[str] = None, fmt: Optional[str] = None) -> Path:
        """Return a local path for the file, downloading it if needed."""
        if file_id not in self.meta and sha256 and fmt:
            self.meta[file_id] = {"id": file_id, "sha256": sha256, "format": fmt}
        path = self.path_for(file_id)
        if path is None:
            raise FileNotFoundError(f"unknown file {file_id}")
        if path.exists():
            return path
        lock = self._locks.setdefault(file_id, asyncio.Lock())
        async with lock:
            if path.exists():
                return path
            await self._download(file_id, path)
        return path

    async def _download(self, file_id: str, dest: Path) -> None:
        expected = self.meta[file_id]["sha256"]
        tmp = dest.with_suffix(dest.suffix + ".part")
        url = f"{self.server_url}/api/agent/files/{file_id}"
        h = hashlib.sha256()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=120), verify=self.verify_tls) as client:
                async with client.stream("GET", url, headers={"Authorization": f"Bearer {self.token}"}) as r:
                    if r.status_code != 200:
                        raise IOError(f"download {file_id}: HTTP {r.status_code}")
                    with open(tmp, "wb") as f:
                        async for chunk in r.aiter_bytes(64 * 1024):
                            h.update(chunk)
                            f.write(chunk)
                        f.flush()
                        os.fsync(f.fileno())
            if h.hexdigest() != expected:
                raise IOError(f"checksum mismatch for {file_id}")
            os.replace(tmp, dest)
            self.last_error = None
            log.info("cached %s (%s)", self.meta[file_id].get("title", file_id), dest.name)
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            self.last_error = str(exc)
            raise

    async def sync(self, only_essential: bool = False) -> tuple[int, int]:
        """Download missing files (essential first). Returns (downloaded, failed)."""
        ok = failed = 0
        ess = self.missing(only_essential=True)
        rest = [] if only_essential else [f for f in self.missing() if f not in ess]
        for fid in ess + rest:
            try:
                await self.ensure(fid)
                ok += 1
            except Exception as exc:
                failed += 1
                log.warning("cache download failed for %s: %s", fid, exc)
        return ok, failed

    def gc(self) -> int:
        """Remove cached files no longer referenced by the library."""
        keep = {f"{m['sha256']}.{m['format']}" for m in self.meta.values()}
        removed = 0
        for p in self.root.iterdir():
            if p.is_file() and p.name not in keep and not p.name.startswith("_"):
                p.unlink(missing_ok=True)
                removed += 1
        return removed

    def stats(self) -> dict:
        files = [p for p in self.root.iterdir() if p.is_file()]
        return {
            "files": len(files),
            "bytes": sum(p.stat().st_size for p in files),
            "missing": len(self.missing()),
            "missingEssential": len(self.missing(only_essential=True)),
            "lastError": self.last_error,
        }
