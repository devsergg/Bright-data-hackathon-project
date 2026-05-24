"""
Bright Data SERP API wrapper for Google Maps telemetry.

Two entry points:
  fetch_maps_telemetry(venues)  — venue-specific scrapes (preserves popular_times)
  trigger_micro_scrape(lat, lon) — coordinate-targeted discovery scrape

Uses the synchronous SERP API (POST https://api.brightdata.com/request) with brd_json=1.

FIELD_MAP below controls how we extract data from the raw API response.
After your first test call, check the printed raw JSON and update the keys if needed.
"""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import requests

import config

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# FIELD EXTRACTION MAP
# Bright Data's exact JSON field names for Google Maps structured responses.
# These are best-effort based on their documented capabilities — verify against
# the raw response logged on the first call and correct any that are wrong.
# ---------------------------------------------------------------------------
FIELD_MAP = {
    # Top-level place fields
    "name": ["title", "name", "place_name"],
    "latitude": ["latitude", "lat", "location.lat"],
    "longitude": ["longitude", "lng", "lon", "location.lng", "location.lon"],
    "current_status": ["current_status", "open_state", "business_status", "opening_hours.open_now"],
    # Current busyness: 0-100 integer. May be absent if not currently open.
    "live_occupancy": ["live_occupancy", "current_popularity", "populartimes_now",
                       "busy_now", "live_busyness"],
    # Typical-by-hour histogram: expected shape is a list of 7 dicts
    # (one per day, Mon=0) each containing hourly popularity values.
    # Exact shape varies — we store whatever we get and normalise later.
    "popular_times": ["popular_times", "populartimes", "popular_times_histogram",
                      "busy_hours", "popularity_data"],
    # Place metadata (nice-to-have, not load-bearing tonight)
    "address": ["address", "full_address", "formatted_address"],
    "rating": ["rating", "average_rating"],
    "review_count": ["reviews_count", "num_reviews", "review_count"],
}

_SERP_ENDPOINT = "https://api.brightdata.com/request"
_REQUEST_TIMEOUT_S = 45
_RETRY_DELAYS = [2, 5, 10]  # seconds between retries


def _get_nested(data: dict, dotted_key: str) -> Any:
    """Walk a.b.c style paths into nested dicts."""
    parts = dotted_key.split(".")
    cur = data
    for p in parts:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _extract_field(data: dict, candidates: list[str]) -> Any:
    """Try each candidate key (supports dot-notation) and return first hit."""
    for key in candidates:
        val = _get_nested(data, key)
        if val is not None:
            return val
    return None


def _parse_venue_record(raw: dict, venue: dict, scraped_at: str) -> dict:
    """
    Convert a raw Bright Data JSON blob into our canonical VenueTelemetry dict.
    Stores the full raw response under 'raw_response' so nothing is lost.
    """
    record: dict = {
        "id": venue["id"],
        "scraped_at": scraped_at,
        "raw_response": raw,  # keep everything — field names can be corrected later
    }
    for field, candidates in FIELD_MAP.items():
        record[field] = _extract_field(raw, candidates)

    # Fall back to venue list values for lat/lng/name when API doesn't return them
    if record.get("name") is None:
        record["name"] = venue["name"]
    if record.get("latitude") is None:
        record["latitude"] = venue.get("lat")
    if record.get("longitude") is None:
        record["longitude"] = venue.get("lng")

    return record


def _call_serp_api(maps_url: str) -> dict:
    """
    POST one Google Maps URL to the Bright Data SERP API.
    Returns the parsed JSON response body.
    Raises requests.HTTPError on non-2xx after all retries exhausted.
    """
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.BRIGHTDATA_API_TOKEN}",
    }
    payload = {
        "zone": config.BRIGHTDATA_ZONE,
        "url": maps_url,
        "format": "raw",
        "brd_json": 1,
    }

    last_exc: Exception | None = None
    for attempt, delay in enumerate([0] + _RETRY_DELAYS, start=1):
        if delay:
            logger.info("Retry %d/%d in %ds...", attempt, len(_RETRY_DELAYS) + 1, delay)
            time.sleep(delay)
        try:
            resp = requests.post(
                _SERP_ENDPOINT,
                headers=headers,
                json=payload,
                timeout=_REQUEST_TIMEOUT_S,
            )
            resp.raise_for_status()
            return resp.json()
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as exc:
            logger.warning("SERP API error for %s (attempt %d): %s", maps_url, attempt, exc)
            last_exc = exc

    raise last_exc  # type: ignore[misc]


def fetch_maps_telemetry(venues: list[dict]) -> list[dict]:
    """
    Scrape Google Maps via Bright Data SERP API for every venue.

    Returns a list of VenueTelemetry dicts (one per venue).
    Venues that fail after all retries are skipped — the loop won't crash.

    On the FIRST successful response the full raw JSON is printed to stdout
    so you can verify field names and correct FIELD_MAP if needed.
    """
    scraped_at = datetime.now(timezone.utc).isoformat()
    results: list[dict] = []
    first_success_logged = False

    for venue in venues:
        logger.info("Scraping: %s (%s)", venue["name"], venue["neighborhood"])
        try:
            raw = _call_serp_api(venue["maps_url"])

            if not first_success_logged:
                first_success_logged = True
                logger.info(
                    "=== RAW RESPONSE (first venue) — verify field names against FIELD_MAP ===\n%s",
                    json.dumps(raw, indent=2, ensure_ascii=False)[:4000],
                )

            record = _parse_venue_record(raw, venue, scraped_at)
            results.append(record)

            popular = record.get("popular_times")
            occupancy = record.get("live_occupancy")
            logger.info(
                "  -> live_occupancy=%s  popular_times_present=%s",
                occupancy,
                popular is not None,
            )

        except Exception as exc:
            logger.error("Skipping %s after all retries: %s", venue["name"], exc)

        # Polite delay between venue requests to avoid rate-limiting
        time.sleep(1)

    logger.info("Cycle complete: %d/%d venues scraped.", len(results), len(venues))
    return results


def trigger_micro_scrape(lat: float, lon: float, radius_meters: int = 200) -> list[dict]:
    """
    Coordinate-targeted discovery scrape: find active venues near a DBSCAN centroid.

    Fires a Google Maps area search via Bright Data rather than a specific venue URL.
    Returns a list of venue records found near the centroid. These records will have
    name/address/rating but popular_times is NOT guaranteed — use fetch_maps_telemetry
    on a specific venue URL when you need the histogram for baseline math.

    Called only for DBSCAN hotspots that don't overlap with known venues.
    """
    # Build a Google Maps search URL centered on the hotspot coordinates.
    # Zoom level 16z ≈ 500m radius view; num results controlled by Maps UI.
    search_url = (
        f"https://www.google.com/maps/search/bars+nightlife/@{lat},{lon},16z"
    )

    scraped_at = datetime.now(timezone.utc).isoformat()
    logger.info("Micro-scrape at (%.5f, %.5f) radius=%dm", lat, lon, radius_meters)

    try:
        raw = _call_serp_api(search_url)
        logger.info(
            "=== MICRO-SCRAPE RAW (lat=%.5f lon=%.5f) ===\n%s",
            lat, lon,
            json.dumps(raw, indent=2, ensure_ascii=False)[:3000],
        )

        # The search result may return a list of places or a single place dict.
        # Normalise to a list.
        places = raw if isinstance(raw, list) else raw.get("results", raw.get("places", [raw]))
        records: list[dict] = []
        for i, place in enumerate(places[:10]):  # cap at 10 results
            record: dict = {"scraped_at": scraped_at, "source": "micro_scrape",
                            "hotspot_lat": lat, "hotspot_lon": lon}
            for field_name, candidates in FIELD_MAP.items():
                record[field_name] = _extract_field(place, candidates)
            record.setdefault("id", f"micro_{lat:.4f}_{lon:.4f}_{i}")
            records.append(record)

        logger.info("  Micro-scrape returned %d venue candidates", len(records))
        return records

    except Exception as exc:
        logger.error("Micro-scrape failed at (%.5f, %.5f): %s", lat, lon, exc)
        return []
