"""
Bright Data SERP event scraper.

Searches Google Events near a DBSCAN hotspot centroid to surface what's
actually happening at that location. Results feed:
  - The LLM vibe synthesizer (gives it structured event context)
  - The map's nearby-events layer (user-facing discovery)
  - DBSCAN confidence boost (hotspot + known event = real signal)

Uses the same SERP API endpoint as maps_scraper, but targets Google's
event search panel (ibp=htl;events) rather than Maps place pages.

EVENT_FIELD_MAP: verify against the printed raw response on first call.
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
# FIELD EXTRACTION MAP FOR EVENTS
# Google Events SERP responses typically nest results under one of these keys.
# Correct whichever are wrong after you see the raw output on first call.
# ---------------------------------------------------------------------------
EVENT_FIELD_MAP = {
    "name":          ["title", "name", "event_title", "summary"],
    "description":   ["description", "snippet", "summary", "details"],
    "start_time":    ["date", "start_date", "start_time", "event_date", "when.start"],
    "end_time":      ["end_date", "end_time", "when.end"],
    "venue_name":    ["venue", "venue_name", "location", "place", "address.venue"],
    "venue_address": ["address", "full_address", "venue_address", "location_address"],
    "latitude":      ["latitude", "lat", "venue.lat", "location.lat"],
    "longitude":     ["longitude", "lng", "lon", "venue.lng", "location.lng"],
    "source_url":    ["link", "url", "event_url", "source"],
    "thumbnail":     ["thumbnail", "image", "image_url"],
}

# Top-level keys in the SERP response that contain the events list
_EVENTS_LIST_KEYS = [
    "events_results",   # Google Events panel (most likely with ibp=htl;events)
    "events",
    "local_results",
    "organic_results",
    "results",
]

_SERP_ENDPOINT = "https://api.brightdata.com/request"
_REQUEST_TIMEOUT_S = 45
_RETRY_DELAYS = [2, 5, 10]

# SF neighborhood lookup — used to build richer search queries
_NEIGHBORHOODS = [
    # (lat_min, lat_max, lon_min, lon_max, name)
    (37.745, 37.775, -122.430, -122.405, "Mission District"),
    (37.755, 37.790, -122.415, -122.385, "SoMa"),
    (37.790, 37.815, -122.420, -122.395, "North Beach"),
    (37.768, 37.785, -122.450, -122.425, "Castro"),
    (37.785, 37.810, -122.440, -122.415, "Hayes Valley"),
    (37.795, 37.815, -122.410, -122.390, "Financial District"),
]

_first_raw_logged = False


def _neighborhood_for(lat: float, lon: float) -> str:
    for lat_min, lat_max, lon_min, lon_max, name in _NEIGHBORHOODS:
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return name
    return "San Francisco"


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


def _parse_event_item(raw_item: dict, hotspot_lat: float, hotspot_lon: float,
                      neighborhood: str, scraped_at: str, idx: int) -> dict:
    record: dict = {
        "id": f"evt_{hotspot_lat:.4f}_{hotspot_lon:.4f}_{idx}",
        "scraped_at": scraped_at,
        "hotspot_lat": hotspot_lat,
        "hotspot_lon": hotspot_lon,
        "neighborhood": neighborhood,
        "raw_response": raw_item,
    }
    for field_name, candidates in EVENT_FIELD_MAP.items():
        record[field_name] = _extract_field(raw_item, candidates)
    return record


def _call_serp_api(url: str) -> dict:
    global _first_raw_logged

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.BRIGHTDATA_API_TOKEN}",
    }
    payload = {
        "zone": config.BRIGHTDATA_ZONE,
        "url": url,
        "format": "raw",
        "brd_json": 1,
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
                    "=== EVENT SCRAPER RAW RESPONSE — verify EVENT_FIELD_MAP ===\n%s",
                    json.dumps(data, indent=2, ensure_ascii=False)[:4000],
                )

            return data
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as exc:
            logger.warning("Event SERP error (attempt %d): %s", attempt, exc)
            last_exc = exc

    raise last_exc  # type: ignore[misc]


def search_events_near(
    lat: float,
    lon: float,
    radius_km: float = 1.0,
) -> list[dict]:
    """
    Search Google Events near a DBSCAN hotspot centroid via Bright Data SERP.

    Returns a list of event records (dicts). Each record includes the raw
    API response under 'raw_response' so no data is lost if field names differ.

    Called only when the event cache misses — typically once per hotspot per hour.
    """
    neighborhood = _neighborhood_for(lat, lon)
    scraped_at = datetime.now(timezone.utc).isoformat()

    # Google Events SERP: ibp=htl;events surfaces the structured events panel.
    # Include neighborhood name for better relevance + "tonight" for recency.
    query = quote(f"events tonight {neighborhood}")
    events_url = f"https://www.google.com/search?q={query}&ibp=htl;events&hl=en&gl=us"

    logger.info(
        "Event scrape: %s (lat=%.5f lon=%.5f)", neighborhood, lat, lon
    )

    try:
        raw = _call_serp_api(events_url)
    except Exception as exc:
        logger.error("Event scrape failed for %s: %s", neighborhood, exc)
        return []

    # Extract the events list from whichever top-level key the API uses
    events_list: list[dict] = []
    if isinstance(raw, list):
        events_list = raw
    else:
        for key in _EVENTS_LIST_KEYS:
            candidate = raw.get(key)
            if isinstance(candidate, list) and candidate:
                events_list = candidate
                logger.info("Found events under key '%s': %d items", key, len(candidate))
                break

    if not events_list:
        logger.warning("No events found for %s — check raw log above for correct key", neighborhood)
        return []

    records = [
        _parse_event_item(item, lat, lon, neighborhood, scraped_at, i)
        for i, item in enumerate(events_list[:20])  # cap at 20 per hotspot
    ]

    logger.info("Parsed %d events near %s", len(records), neighborhood)
    return records
