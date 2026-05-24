"""
FastAPI route handlers.

Day 0–1: /api/v1/scan-grid, /api/v1/nearby-events, /api/v1/events/*
         /api/v1/social-events, /api/v1/for-you, /api/v1/profile/*
Day 2:   /map-data, /timeline, /venue-details  (anomaly engine required first)
"""

import json
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query

import config
from data import store
from data_ingestion.event_scraper import search_events_near
from data_ingestion.macro_telemetry import fetch_macro_coordinates
from data_ingestion.maps_scraper import fetch_maps_telemetry, trigger_micro_scrape
from services.event_cache import get as cache_get, put as cache_put
from services.recommendation_engine import (
    apply_interaction, profile_summary, rank_events,
)
from services.social_event_detector import detect_social_events
from services.spatial_clustering import extract_hotspots, venues_near_hotspots

router = APIRouter()


def _load_venues() -> list[dict]:
    with open(config.VENUES_PATH, encoding="utf-8") as f:
        return json.load(f)


def _format_event(raw: dict) -> dict:
    return {k: v for k, v in raw.items() if k != "raw_response" and v is not None}


# ---------------------------------------------------------------------------
# Core scan endpoint
# ---------------------------------------------------------------------------

@router.post("/api/v1/scan-grid")
async def execute_grid_scan():
    """Trigger one full macro→DBSCAN→micro funnel cycle on demand."""
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
            "nearby_events": [_format_event(e) for e in events[:10]],
        })

    return {"status": "success", "anomalies_detected": len(hotspots), "data": results}


# ---------------------------------------------------------------------------
# Google Events endpoints
# ---------------------------------------------------------------------------

@router.get("/api/v1/nearby-events")
def nearby_events(
    lat: float = Query(...),
    lon: float = Query(...),
    radius_km: float = Query(1.0),
    live: bool = Query(False, description="Force a fresh Bright Data scrape (costs quota)"),
):
    """Events near a lat/lon. Default serves from the captured JSONL store."""
    if live:
        events = search_events_near(lat, lon, radius_km=radius_km)
        cache_put(lat, lon, events)
        if events:
            store.append(events, config.EVENTS_STORE_PATH)
    else:
        events = store.events_near(lat, lon, radius_km=radius_km,
                                   path=config.EVENTS_STORE_PATH)

    return {"query": {"lat": lat, "lon": lon, "radius_km": radius_km},
            "count": len(events),
            "events": [_format_event(e) for e in events]}


@router.get("/api/v1/events/neighborhood/{name}")
def events_by_neighborhood(name: str):
    events = store.events_for_neighborhood(name, path=config.EVENTS_STORE_PATH)
    return {"neighborhood": name, "count": len(events),
            "events": [_format_event(e) for e in events]}


@router.get("/api/v1/events/all")
def all_events(limit: int = Query(50, le=200)):
    all_ev = store.read_all(config.EVENTS_STORE_PATH)
    all_ev.sort(key=lambda e: e.get("scraped_at", ""), reverse=True)
    return {"count": len(all_ev), "events": [_format_event(e) for e in all_ev[:limit]]}


# ---------------------------------------------------------------------------
# Social events endpoints — posts-derived events from social clustering
# ---------------------------------------------------------------------------

@router.get("/api/v1/social-events")
def social_events(
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    neighborhood: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
):
    """
    Return detected social events (cluster signals from Twitter/Instagram posts).

    Filter by lat/lon proximity OR neighborhood name. If neither is provided,
    returns the most recent social events across all captures.
    """
    all_se = store.read_all(config.SOCIAL_EVENTS_STORE_PATH)
    all_se.sort(key=lambda e: e.get("detected_at", ""), reverse=True)

    if neighborhood:
        needle = neighborhood.lower()
        all_se = [e for e in all_se if needle in (e.get("neighborhood") or "").lower()]
    elif lat is not None and lon is not None:
        from utils.geo_math import haversine_meters
        all_se = [
            e for e in all_se
            if e.get("hotspot_lat") and e.get("hotspot_lon")
            and haversine_meters(lat, lon, e["hotspot_lat"], e["hotspot_lon"]) <= 1500
        ]

    return {"count": len(all_se), "social_events": [_format_event(e) for e in all_se[:limit]]}


@router.get("/api/v1/social-events/trending")
def trending_social_events(limit: int = Query(10, le=50)):
    """
    Return the current trending topics across all social events,
    ranked by post_count (strength of signal).
    """
    all_se = store.read_all(config.SOCIAL_EVENTS_STORE_PATH)
    all_se.sort(key=lambda e: e.get("post_count", 0), reverse=True)
    return {
        "count": len(all_se),
        "trending": [
            {
                "topic": e.get("topic"),
                "category": e.get("category"),
                "post_count": e.get("post_count"),
                "confidence": e.get("confidence"),
                "neighborhood": e.get("neighborhood"),
                "hashtags": e.get("hashtags", [])[:5],
            }
            for e in all_se[:limit]
        ],
    }


# ---------------------------------------------------------------------------
# "For You" personalisation endpoints
# ---------------------------------------------------------------------------

@router.get("/api/v1/for-you")
def for_you(
    user_id: str = Query(..., description="Client-generated UUID from localStorage"),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    radius_km: float = Query(2.0),
    limit: int = Query(20, le=50),
):
    """
    Personalised event feed for a user.

    Combines Google Events + social events near the user's location,
    scored and ranked by their preference profile.

    Cold start (< 3 interactions): returns events ranked by DBSCAN density /
    recency with reason "Popular in your area". Personalisation kicks in after
    a few taps or explicit signals.
    """
    # Gather candidate events from both sources
    if lat is not None and lon is not None:
        google_events = store.events_near(lat, lon, radius_km=radius_km,
                                          path=config.EVENTS_STORE_PATH)
        social_ev_raw = store.read_all(config.SOCIAL_EVENTS_STORE_PATH)
        from utils.geo_math import haversine_meters
        social_ev_nearby = [
            e for e in social_ev_raw
            if e.get("hotspot_lat") and e.get("hotspot_lon")
            and haversine_meters(lat, lon, e["hotspot_lat"], e["hotspot_lon"]) <= radius_km * 1000
        ]
    else:
        # No location — return latest from store
        google_events = store.read_all(config.EVENTS_STORE_PATH)[-50:]
        social_ev_nearby = store.read_all(config.SOCIAL_EVENTS_STORE_PATH)[-20:]

    # Tag source so frontend can show "Spotted on social" badge
    for e in google_events:
        e.setdefault("source_type", "google_events")
    for e in social_ev_nearby:
        e.setdefault("source_type", "social")

    all_candidates = google_events + social_ev_nearby
    if not all_candidates:
        return {"user_id": user_id, "count": 0, "events": [],
                "message": "No events captured yet — start the capture loop first."}

    ranked = rank_events(all_candidates, user_id)
    return {
        "user_id": user_id,
        "profile": profile_summary(user_id),
        "count": len(ranked),
        "events": [_format_event(e) for e in ranked[:limit]],
    }


@router.post("/api/v1/profile/signal")
def record_signal(
    user_id: str = Query(...),
    action: str = Query(..., description="view | like | attend | skip | dislike"),
    event: dict = Body(..., description="The full event dict the user interacted with"),
):
    """
    Record a user interaction to update their preference profile.

    Called by the frontend on every tap, like, skip, or RSVP.
    The profile update is synchronous and takes < 5ms.
    """
    valid_actions = {"view", "like", "attend", "skip", "dislike"}
    if action not in valid_actions:
        raise HTTPException(status_code=422,
                            detail=f"action must be one of {sorted(valid_actions)}")

    updated = apply_interaction(user_id, event, action)
    return {
        "user_id": user_id,
        "action_recorded": action,
        "profile": profile_summary(user_id),
        "interaction_count": updated.interaction_count,
        "is_warm": updated.is_warm,
    }


@router.get("/api/v1/profile/{user_id}")
def get_profile(user_id: str):
    """Return the current preference profile for a user."""
    return profile_summary(user_id)


@router.delete("/api/v1/profile/{user_id}")
def reset_profile(user_id: str):
    """Delete a user's profile (reset preferences)."""
    from data.profiles import delete
    deleted = delete(user_id)
    return {"user_id": user_id, "deleted": deleted}


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
