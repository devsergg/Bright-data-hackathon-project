"""
Bright Data social scraper — geo-fenced posts near a hotspot.

Targets Twitter/X live search and Instagram hashtag/location pages via
the same SERP API endpoint used by maps_scraper and event_scraper.

Triggered only when a DBSCAN cluster is confirmed (Z > 2.0 equivalent)
to stay within quota. Results feed:
  - social_event_detector.py  → clusters posts into emerging events
  - llm_synthesis.py          → context for vibe one-liners (Day 2)

SOCIAL_FIELD_MAP: verify against the printed raw response on first call.
"""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import requests

import config

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# FIELD EXTRACTION MAP FOR SOCIAL POSTS
# Twitter/X and Instagram responses share many field names; candidates
# are listed most-likely first. Correct after first raw log.
# ---------------------------------------------------------------------------
SOCIAL_FIELD_MAP = {
    "text":        ["text", "content", "description", "tweet", "caption", "snippet"],
    "author":      ["user.screen_name", "author", "username", "user.name", "handle"],
    "posted_at":   ["created_at", "date", "timestamp", "posted_at", "time"],
    "hashtags":    ["hashtags", "entities.hashtags", "tags"],
    "likes":       ["favorite_count", "likes", "like_count", "favorites"],
    "source_url":  ["url", "link", "permalink", "tweet_url"],
    "platform":    ["source", "platform"],
}

_SERP_ENDPOINT = "https://api.brightdata.com/request"
_REQUEST_TIMEOUT_S = 45
_RETRY_DELAYS = [2, 5, 10]
_first_raw_logged = False

# Minimum posts from a single scrape that make the result useful
_MIN_USEFUL_POSTS = 3


def _get_nested(data: dict, dotted_key: str) -> Any:
    parts = dotted_key.split(".")
    cur = data
    for p in parts:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _extract_field(data: dict, candidates: list[str]) -> Any:
    for key in candidates:
        val = _get_nested(data, key)
        if val is not None:
            return val
    return None


def _call_serp_api(url: str) -> Any:
    global _first_raw_logged

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.BRIGHTDATA_API_TOKEN}",
    }
    sep = "&" if "?" in url else "?"
    payload = {
        "zone": config.BRIGHTDATA_ZONE,
        "url": f"{url}{sep}brd_json=1",
        "format": "raw",
    }

    last_exc: Exception | None = None
    for attempt, delay in enumerate([0] + _RETRY_DELAYS, start=1):
        if delay:
            time.sleep(delay)
        try:
            resp = requests.post(
                _SERP_ENDPOINT,
                headers=headers,
                json=payload,
                timeout=_REQUEST_TIMEOUT_S,
            )
            resp.raise_for_status()
            data = resp.json()

            if not _first_raw_logged:
                _first_raw_logged = True
                logger.info(
                    "=== SOCIAL SCRAPER RAW RESPONSE — verify SOCIAL_FIELD_MAP ===\n%s",
                    json.dumps(data, indent=2, ensure_ascii=False)[:4000],
                )

            return data
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as exc:
            logger.warning("Social SERP error (attempt %d): %s", attempt, exc)
            last_exc = exc

    raise last_exc  # type: ignore[misc]


def _parse_post(raw: dict, platform: str, scraped_at: str,
                lat: float, lon: float, idx: int) -> dict:
    record: dict = {
        "id": f"post_{platform}_{lat:.4f}_{lon:.4f}_{idx}",
        "platform": platform,
        "scraped_at": scraped_at,
        "hotspot_lat": lat,
        "hotspot_lon": lon,
        "raw_response": raw,
    }
    for field_name, candidates in SOCIAL_FIELD_MAP.items():
        record[field_name] = _extract_field(raw, candidates)

    # Normalise hashtags to a list of lowercase strings
    raw_tags = record.get("hashtags")
    if isinstance(raw_tags, list):
        record["hashtags"] = [
            (t.get("text", t) if isinstance(t, dict) else str(t)).lower()
            for t in raw_tags
        ]
    elif isinstance(raw_tags, str):
        record["hashtags"] = [t.lstrip("#").lower() for t in raw_tags.split()]
    else:
        # Extract hashtags from text as fallback
        text = record.get("text") or ""
        record["hashtags"] = [w[1:].lower() for w in text.split() if w.startswith("#")]

    return record


def _scrape_twitter(lat: float, lon: float, neighborhood: str,
                    scraped_at: str) -> list[dict]:
    """Live Twitter/X search for recent posts mentioning the neighborhood."""
    query = quote(f'"{neighborhood}" OR #{neighborhood.replace(" ", "")} -filter:retweets')
    url = f"https://twitter.com/search?q={query}&f=live&src=typed_query"
    try:
        raw = _call_serp_api(url)
    except Exception as exc:
        logger.warning("Twitter scrape failed for %s: %s", neighborhood, exc)
        return []

    posts_raw = raw if isinstance(raw, list) else raw.get("results", raw.get("tweets", []))
    return [_parse_post(p, "twitter", scraped_at, lat, lon, i)
            for i, p in enumerate(posts_raw[:30])]


def _scrape_instagram(lat: float, lon: float, neighborhood: str,
                      scraped_at: str) -> list[dict]:
    """Instagram hashtag page for the neighborhood name."""
    tag = neighborhood.lower().replace(" ", "")
    url = f"https://www.instagram.com/explore/tags/{tag}/"
    try:
        raw = _call_serp_api(url)
    except Exception as exc:
        logger.warning("Instagram scrape failed for #%s: %s", tag, exc)
        return []

    posts_raw = raw if isinstance(raw, list) else raw.get("posts", raw.get("media", []))
    return [_parse_post(p, "instagram", scraped_at, lat, lon, i)
            for i, p in enumerate(posts_raw[:20])]


def fetch_social_context(
    lat: float,
    lon: float,
    neighborhood: str,
    radius_m: int = 200,
    window_min: int = 20,
) -> list[dict]:
    """
    Fetch recent geo-fenced social posts near a hotspot.

    Scrapes Twitter/X live search and Instagram hashtag pages.
    Returns a flat list of post dicts, one per post, with normalised hashtags.
    """
    scraped_at = datetime.now(timezone.utc).isoformat()
    logger.info(
        "Social scrape: %s (lat=%.5f lon=%.5f radius=%dm window=%dmin)",
        neighborhood, lat, lon, radius_m, window_min,
    )

    posts: list[dict] = []
    posts.extend(_scrape_twitter(lat, lon, neighborhood, scraped_at))
    posts.extend(_scrape_instagram(lat, lon, neighborhood, scraped_at))

    logger.info("Social scrape returned %d total posts for %s", len(posts), neighborhood)
    return posts
