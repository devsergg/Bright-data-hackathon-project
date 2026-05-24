"""
Pulse AI — FastAPI application.

Tonight: only the /api/v1/scan-grid endpoint is wired up.
Full /map-data, /timeline, /venue-details endpoints come Day 2.
"""

import json
import logging

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config
from data_ingestion.macro_telemetry import fetch_macro_coordinates
from data_ingestion.maps_scraper import fetch_maps_telemetry, trigger_micro_scrape
from services.spatial_clustering import extract_hotspots, venues_near_hotspots

logger = logging.getLogger(__name__)

app = FastAPI(title="Pulse AI — The Lit Index Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_venues() -> list[dict]:
    with open(config.VENUES_PATH, encoding="utf-8") as f:
        return json.load(f)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/v1/scan-grid")
async def execute_grid_scan(background_tasks: BackgroundTasks):
    """
    Macro-to-micro spatial funnel:
      1. Fetch free macro coordinates (Bay Wheels GBFS)
      2. DBSCAN → hotspot centroids
      3. For each hotspot: scrape nearby known venues OR do a discovery scrape
    """
    venues = _load_venues()

    # Step 1: macro net
    raw_coords = fetch_macro_coordinates(region="San_Francisco")

    # Step 2: clustering
    hotspots = extract_hotspots(raw_coords, eps_meters=150, min_samples=20)

    if not hotspots:
        return {
            "status": "quiet",
            "anomalies_detected": 0,
            "message": "No density clusters found — city is below anomaly threshold.",
            "data": [],
        }

    # Step 3: micro scrapes targeted at verified hotspots only
    results = []
    active_venues = venues_near_hotspots(venues, hotspots, radius_m=600)
    venue_records = fetch_maps_telemetry(active_venues) if active_venues else []

    for hotspot in hotspots:
        nearby_venues = [
            r for r in venue_records
            if r.get("latitude") and r.get("longitude")
        ]
        if not nearby_venues:
            # No known venue — fire discovery scrape
            nearby_venues = trigger_micro_scrape(hotspot.lat, hotspot.lon)

        results.append({
            "hotspot_meta": hotspot.to_dict(),
            "live_venues": nearby_venues,
        })

        logger.info(
            "Hotspot #%d at (%.5f, %.5f) density=%d  venues=%d",
            hotspot.cluster_id, hotspot.lat, hotspot.lon,
            hotspot.density_weight, len(nearby_venues),
        )

    return {
        "status": "success",
        "anomalies_detected": len(hotspots),
        "data": results,
    }


# Placeholder routes for Day 2 implementation
@app.get("/map-data")
def map_data(t: str | None = None):
    raise HTTPException(status_code=501, detail="Implemented Day 2")


@app.get("/timeline")
def timeline():
    raise HTTPException(status_code=501, detail="Implemented Day 2")


@app.get("/venue-details/{venue_id}")
def venue_details(venue_id: str, t: str | None = None):
    raise HTTPException(status_code=501, detail="Implemented Day 2")
