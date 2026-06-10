from __future__ import annotations

"""Publishing layer. Finished videos go to a per-account review queue; adapters
push queue items to platforms. auto_post=false keeps everything in the queue
for manual review (recommended until each platform's API access is approved)."""

import json
import shutil
import time
from abc import ABC, abstractmethod
from pathlib import Path


class PublishAdapter(ABC):
    platform: str

    @abstractmethod
    def post(self, video: Path, metadata: dict) -> str:
        """Upload the video. Returns the platform URL/id of the post."""


def enqueue(data_dir: Path, account: str, video: Path, metadata_path: Path) -> Path:
    """Copy a finished run into the account's review queue."""
    item_dir = data_dir / account / "queue" / time.strftime("%Y%m%d-%H%M%S")
    item_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(video, item_dir / "video.mp4")
    shutil.copy2(metadata_path, item_dir / "metadata.json")
    return item_dir


def list_queue(data_dir: Path, account: str) -> list[Path]:
    qdir = data_dir / account / "queue"
    if not qdir.exists():
        return []
    return sorted(p for p in qdir.iterdir() if (p / "video.mp4").exists())


def load_item(item_dir: Path) -> tuple[Path, dict]:
    return item_dir / "video.mp4", json.loads((item_dir / "metadata.json").read_text())
