from __future__ import annotations

"""Instagram Reels adapter — Meta Graph API.

Requirements: Instagram Business/Creator account linked to a Facebook Page, a
Meta app with instagram_content_publish permission (app review required), and
the video hosted at a public URL (Graph API pulls by URL — host the queue dir
or upload to object storage first).

Set IG_USER_ID and IG_ACCESS_TOKEN once approved.
"""

import os
import time
from pathlib import Path

import httpx

from .base import PublishAdapter

GRAPH = "https://graph.facebook.com/v21.0"


class InstagramAdapter(PublishAdapter):
    platform = "instagram"

    def post(self, video: Path, metadata: dict) -> str:
        user_id = os.environ.get("IG_USER_ID")
        token = os.environ.get("IG_ACCESS_TOKEN")
        video_url = metadata.get("public_video_url")
        if not (user_id and token):
            raise RuntimeError("IG_USER_ID / IG_ACCESS_TOKEN not set — see module docstring.")
        if not video_url:
            raise RuntimeError(
                "Instagram Graph API ingests by URL: upload the video to public "
                "storage and put the URL in metadata['public_video_url']."
            )
        caption = metadata["caption"] + "\n\n" + " ".join(metadata.get("hashtags", []))
        create = httpx.post(
            f"{GRAPH}/{user_id}/media",
            data={
                "media_type": "REELS",
                "video_url": video_url,
                "caption": caption[:2200],
                "access_token": token,
            },
            timeout=30,
        )
        create.raise_for_status()
        container_id = create.json()["id"]

        for _ in range(60):  # wait for Meta to ingest the video
            status = httpx.get(
                f"{GRAPH}/{container_id}",
                params={"fields": "status_code", "access_token": token},
                timeout=30,
            ).json()
            if status.get("status_code") == "FINISHED":
                break
            time.sleep(5)

        publish = httpx.post(
            f"{GRAPH}/{user_id}/media_publish",
            data={"creation_id": container_id, "access_token": token},
            timeout=30,
        )
        publish.raise_for_status()
        return publish.json()["id"]
