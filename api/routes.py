"""
FastAPI route handlers.

Day 0–1: /api/v1/scan-grid, /api/v1/nearby-events, /api/v1/events/neighborhood
Day 2:   /map-data, /timeline, /venue-details  (anomaly engine required first)
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

import config
from data import store
from data_ingestion.event_scraper import search_events_near
from data_ingestion.macro_telemetry import fetch_macro_coordinates
from data_ingestion.maps_scraper import fetch_maps_telemetry, trigger_micro_scrape
from services.event_cache import get as cache_get, put as cache_put
from services.spatial_clustering import extract_hotspots, venues_near_hotspots

import json

router = APIRouter()


def _load_venues() -> list[dict]:
    with open(config.VENUES_PATH, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Core scan endpoint — full macro→DBSCAN→micro funnel on demand
# ---------------------------------------------------------------------------

@router.post("/api/v1/scan-grid")
async def execute_grid_scan():
    """Trigger one full funnel cycle on demand. Returns hotspots + venue data."""
    venues = _load_venues()
    raw_coords = fetch_macro_coordinates(region="San_Francisco")
    hotspots = extract_hotspots(raw_coords, eps_meters=150, min_samples=20)

    if not hotspots:
        return {
            "status": "quiet",
            "anomalies_detected": 0,
            "message": "No density clusters — city is below anomaly threshold.",
            "data": [],
        }

    active_venues = venues_near_hotspots(venues, hotspots, radius_m=600)
    venue_records = fetch_maps_telemetry(active_venues) if active_venues else []

    results = []
    for hotspot in hotspots:
        # Events: serve from cache if fresh, otherwise scrape
        events = cache_get(hotspot.lat, hotspot.lon, ttl_s=config.EVENT_CACHE_TTL_S)
        if events is None:
            events = search_events_near(hotspot.lat, hotspot.lon,
                                        radius_km=config.EVENT_SEARCH_RADIUS_KM)
            cache_put(hotspot.lat, hotspot.lon, events)
            if events:
                store.append(events, config.EVENTS_STORE_PATH)

        results.append({
            "hotspot_meta": hotspot.to_dict(),
            "live_venues": venue_records,
            "nearby_events": [e.get("name") and e or e for e in events[:10]],
        })

    return {
        "status": "success",
        "anomalies_detected": len(hotspots),
        "data": results,
    }


# ---------------------------------------------------------------------------
# Events endpoints — for map layer and discovery panel
# ---------------------------------------------------------------------------

@router.get("/api/v1/nearby-events")
def nearby_events(
    lat: float = Query(..., description="Latitude of the query point"),
    lon: float = Query(..., description="Longitude of the query point"),
    radius_km: float = Query(1.0, description="Search radius in km"),
    live: bool = Query(False, description="If true, trigger a fresh Bright Data scrape ignoring cache"),
):
    """
    Return events near a lat/lon point.

    Primary use: frontend map requests events as the user pans/taps a hotspot.

    'live=false' (default): serves from the captured JSONL store. Fast, no API cost.
    'live=true': fires a fresh Bright Data event scrape, bypassing the cache.
                 Use sparingly — each call costs quota.
    """
    if live:
        events = search_events_near(lat, lon, radius_km=radius_km)
        cache_put(lat, lon, events)
        if events:
            store.append(events, config.EVENTS_STORE_PATH)
    else:
        events = store.events_near(lat, lon, radius_km=radius_km,
                                   path=config.EVENTS_STORE_PATH)

    return {
        "query": {"lat": lat, "lon": lon, "radius_km": radius_km},
        "count": len(events),
        "events": [_format_event(e) for e in events],
    }


@router.get("/api/v1/events/neighborhood/{name}")
def events_by_neighborhood(name: str):
    """Return all stored events for a named SF neighborhood."""
    events = store.events_for_neighborhood(name, path=config.EVENTS_STORE_PATH)
    return {
        "neighborhood": name,
        "count": len(events),
        "events": [_format_event(e) for e in events],
    }


@router.get("/api/v1/events/all")
def all_events(limit: int = Query(50, le=200)):
    """Return the most recently captured events across all neighborhoods."""
    all_ev = store.read_all(config.EVENTS_STORE_PATH)
    # Sort by scraped_at descending, drop raw_response to keep payload small
    all_ev.sort(key=lambda e: e.get("scraped_at", ""), reverse=True)
    return {
        "count": len(all_ev),
        "events": [_format_event(e) for e in all_ev[:limit]],
    }


# ---------------------------------------------------------------------------
# Replay / timeline endpoints (Day 2 — stub until anomaly engine is ready)
# ---------------------------------------------------------------------------

@router.get("/map-data")
def map_data(t: Optional[str] = None):
    raise HTTPException(status_code=501, detail="Available Day 2 after anomaly engine is built.")


@router.get("/timeline")
def timeline():
    raise HTTPException(status_code=501, detail="Available Day 2 after anomaly engine is built.")


@router.get("/venue-details/{venue_id}")
def venue_details(venue_id: str, t: Optional[str] = None):
    raise HTTPException(status_code=501, detail="Available Day 2 after anomaly engine is built.")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _format_event(raw: dict) -> dict:
    """Return a clean event dict for the API response, omitting raw_response."""
    return {k: v for k, v in raw.items() if k != "raw_response" and v is not None}
