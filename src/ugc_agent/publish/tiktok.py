from __future__ import annotations

"""TikTok adapter — Content Posting API.

TikTok requires an approved developer app (https://developers.tiktok.com,
"Content Posting API" product) and a user access token with video.publish
scope. Until approval, keep auto_post off and post queue items manually or via
a scheduler. The request shape below is ready; fill in the OAuth token flow
once the app is approved.
"""

import os
from pathlib import Path

import httpx

from .base import PublishAdapter

INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"


class TikTokAdapter(PublishAdapter):
    platform = "tiktok"

    def post(self, video: Path, metadata: dict) -> str:
        token = os.environ.get("TIKTOK_ACCESS_TOKEN")
        if not token:
            raise RuntimeError(
                "TIKTOK_ACCESS_TOKEN not set. TikTok posting requires an approved "
                "Content Posting API app — see module docstring."
            )
        size = video.stat().st_size
        init = httpx.post(
            INIT_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={
                "post_info": {
                    "title": metadata["caption"][:2200],
                    "privacy_level": "SELF_ONLY",  # switch to PUBLIC_TO_EVERYONE after audit
                },
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": size,
                    "chunk_size": size,
                    "total_chunk_count": 1,
                },
            },
            timeout=30,
        )
        init.raise_for_status()
        data = init.json()["data"]
        upload = httpx.put(
            data["upload_url"],
            content=video.read_bytes(),
            headers={
                "Content-Type": "video/mp4",
                "Content-Range": f"bytes 0-{size - 1}/{size}",
            },
            timeout=300,
        )
        upload.raise_for_status()
        return data["publish_id"]
