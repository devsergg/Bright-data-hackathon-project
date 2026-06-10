from __future__ import annotations

"""Single gateway for all Higgsfield API calls. Every call is budget-checked
before submission and recorded after. Other modules must not import
higgsfield_client directly."""

from pathlib import Path

import httpx

from .budget import Ledger
from .config import Settings


def _client():
    try:
        import higgsfield_client
    except ImportError as e:
        raise RuntimeError(
            "higgsfield-client is not installed (pip install higgsfield-client). "
            "Set HF_API_KEY/HF_API_SECRET or HF_KEY for auth."
        ) from e
    return higgsfield_client


class Higgsfield:
    def __init__(self, settings: Settings, ledger: Ledger):
        self.settings = settings
        self.ledger = ledger

    def text_to_image(self, model: str, prompt: str, aspect_ratio: str) -> str:
        """Generate one keyframe candidate. Returns the image URL."""
        est = self.settings.credit_estimate("text_to_image")
        label = f"t2i:{model}"
        self.ledger.check(est, label)
        hf = _client()
        result = hf.subscribe(
            model,
            arguments={"prompt": prompt, "aspect_ratio": aspect_ratio},
        )
        self.ledger.record(est, label)
        return result["images"][0]["url"]

    def image_to_video(
        self,
        model: str,
        image_path: Path,
        motion_prompt: str,
        resolution: str,
        duration: int,
        final: bool = False,
    ) -> str:
        """Animate a winning keyframe. Returns the video URL.

        `duration` is always passed explicitly — some models default to 12s,
        roughly tripling the cost of a 4s clip.
        """
        kind = "image_to_video_final" if final else "image_to_video_draft"
        est = self.settings.credit_estimate(kind)
        label = f"i2v:{model}:{resolution}/{duration}s"
        self.ledger.check(est, label)
        hf = _client()
        image_url = hf.upload_file(str(image_path))
        result = hf.subscribe(
            model,
            arguments={
                "image_url": image_url,
                "prompt": motion_prompt,
                "resolution": resolution,
                "duration": duration,
            },
        )
        self.ledger.record(est, label)
        return self._video_url(result)

    @staticmethod
    def _video_url(result: dict) -> str:
        if "video" in result:
            v = result["video"]
            return v["url"] if isinstance(v, dict) else v
        if "videos" in result:
            return result["videos"][0]["url"]
        raise KeyError(f"No video URL in Higgsfield result: {list(result)}")


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return dest
