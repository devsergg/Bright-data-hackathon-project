from __future__ import annotations

"""Assemble winning clips into the final video with ffmpeg, and write the
posting metadata next to it."""

import json
import shutil
import subprocess
from pathlib import Path

from .scripting import VideoScript


def _require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH — install it to assemble videos.")


def concat_clips(clips: list[Path], out_path: Path) -> Path:
    """Concatenate clips, re-encoding so mixed draft/final renders still join."""
    _require_ffmpeg()
    list_file = out_path.parent / "concat.txt"
    list_file.write_text("".join(f"file '{c.resolve()}'\n" for c in clips))
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
            "-movflags", "+faststart", str(out_path),
        ],
        check=True,
        capture_output=True,
    )
    return out_path


def add_voiceover(video: Path, audio: Path, out_path: Path) -> Path:
    """Mux a voiceover track (e.g. from edge-tts) over the assembled video."""
    _require_ffmpeg()
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video), "-i", str(audio),
            "-c:v", "copy", "-c:a", "aac", "-shortest", str(out_path),
        ],
        check=True,
        capture_output=True,
    )
    return out_path


def write_metadata(run_dir: Path, script: VideoScript, extra: dict) -> Path:
    meta = {
        "title": script.title,
        "caption": script.caption,
        "hashtags": script.hashtags,
        "affiliate_cta": script.affiliate_cta,
        "shots": [s.model_dump() for s in script.shots],
        **extra,
    }
    path = run_dir / "metadata.json"
    path.write_text(json.dumps(meta, indent=2))
    return path
