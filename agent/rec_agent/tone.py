"""Generates the speaker-test chime locally (no file needed from the server)."""
from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

RATE = 44100


def make_test_tone(path: Path) -> Path:
    """Three ascending tones (C5, E5, G5), 0.45 s each with soft envelope → ~1.6 s chime."""
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = bytearray()
    for freq in (523.25, 659.25, 783.99):
        n = int(RATE * 0.45)
        for i in range(n):
            env = min(1.0, i / (RATE * 0.02)) * min(1.0, (n - i) / (RATE * 0.12))
            s = int(0.55 * env * 32767 * math.sin(2 * math.pi * freq * i / RATE))
            frames += struct.pack("<hh", s, s)
        frames += b"\x00\x00\x00\x00" * int(RATE * 0.08)
    tmp = path.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
    tmp.replace(path)
    return path


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())
