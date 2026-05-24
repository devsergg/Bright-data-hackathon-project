"""
Carnaval capture loop — DBSCAN-guided macro-to-micro funnel.

Flow every 15 minutes:
  1. Macro net  — fetch free Bay Wheels GBFS coordinates (no API cost)
  2. DBSCAN     — find density clusters → hotspot centroids
  3. Filter     — only scrape known venues that fall within a hotspot cluster
  4. Discovery  — for hotspots with no nearby known venue, do a coordinate search
  5. Store      — append all records to JSONL

Cost comparison vs. naive (scrape all venues every cycle):
  Naive:   20 venues × 30 cycles = 600 Bright Data calls
  DBSCAN:  ~5 active venues × 30 cycles ≈ 150 calls  (75% reduction)

On quiet nights only the hottest 2-3 venues get scraped.
On Carnaval night the Mission cluster keeps most Mission venues in scope.

Usage:
    export BRIGHTDATA_API_TOKEN="..."
    export BRIGHTDATA_ZONE="serp"
    python capture.py

Ctrl-C stops cleanly between or during cycles.
"""

import json
import logging
import sys
import time
from datetime import datetime, timezone

import config
from data import store
from data_ingestion.event_scraper import search_events_near
from data_ingestion.macro_telemetry import fetch_macro_coordinates
from data_ingestion.maps_scraper import fetch_maps_telemetry, trigger_micro_scrape
from services.event_cache import get as cache_get, put as cache_put, stats as cache_stats
from services.spatial_clustering import extract_hotspots, venues_near_hotspots
from utils.geo_math import haversine_meters

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("capture.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

# Hotspot proximity radius for matching known venues to DBSCAN clusters
_VENUE_HOTSPOT_RADIUS_M = 600

# DBSCAN tuning — 200m eps ≈ 1 SF city block; 10 min_samples works with GBFS weighting
_DBSCAN_EPS_M = 200
_DBSCAN_MIN_SAMPLES = 10

# Fallback: when DBSCAN finds no clusters, scrape this many venues anyway
# (keeps baseline data flowing even on quiet nights; keeps quota usage minimal)
_QUIET_NIGHT_FALLBACK_COUNT = 5


def load_venues() -> list[dict]:
    with open(config.VENUES_PATH, encoding="utf-8") as f:
        return json.load(f)


def _discovery_needed(hotspot, active_venues: list[dict]) -> bool:
    """True if no known venue is within the hotspot's cluster — it's a new area."""
    for v in active_venues:
        lat = v.get("lat") or v.get("latitude")
        lon = v.get("lon") or v.get("longitude") or v.get("lng")
        if lat and lon:
            if haversine_meters(lat, lon, hotspot.lat, hotspot.lon) <= _VENUE_HOTSPOT_RADIUS_M:
                return False
    return True


def run_cycle(venues: list[dict], cycle_num: int) -> None:
    logger.info("--- Cycle %d start at %s ---", cycle_num, datetime.now(timezone.utc).isoformat())

    # --- Step 1: Macro net (free) ---
    raw_coords = fetch_macro_coordinates(region="San_Francisco")

    # --- Step 2: DBSCAN ---
    hotspots = extract_hotspots(
        raw_coords,
        eps_meters=_DBSCAN_EPS_M,
        min_samples=_DBSCAN_MIN_SAMPLES,
    )

    if hotspots:
        logger.info("Detected %d hotspot(s). Targeting Bright Data at active clusters only.", len(hotspots))
        # --- Step 3: Filter known venues to those inside hotspot clusters ---
        active_venues = venues_near_hotspots(venues, hotspots, radius_m=_VENUE_HOTSPOT_RADIUS_M)
        if not active_venues:
            # Hotspots found but none overlap with our venue list — use discovery only
            logger.info("No known venues in hotspot zones — running discovery scrapes only")
    else:
        logger.info(
            "No hotspots detected (quiet). Scraping %d reference venues for baseline.",
            _QUIET_NIGHT_FALLBACK_COUNT,
        )
        # Keep the Mission venues first (they're the demo centerpiece)
        mission_first = sorted(venues, key=lambda v: (0 if v.get("neighborhood") == "Mission" else 1))
        active_venues = mission_first[:_QUIET_NIGHT_FALLBACK_COUNT]

    # --- Step 4a: Venue-specific scrapes (preserves popular_times for baseline math) ---
    if active_venues:
        records = fetch_maps_telemetry(active_venues)
        if records:
            store.append(records, config.CARNAVAL_STORE_PATH)
            logger.info("Appended %d venue records to %s", len(records), config.CARNAVAL_STORE_PATH)
            for r in records:
                pop = "YES" if r.get("popular_times") else "NO"
                logger.info(
                    "  %-30s  occupancy=%-5s  popular_times=%s",
                    r.get("name", r["id"]),
                    r.get("live_occupancy"),
                    pop,
                )

    # --- Step 4b: Discovery scrapes for hotspots with no known venue nearby ---
    for hotspot in hotspots:
        if _discovery_needed(hotspot, active_venues):
            logger.info(
                "  Discovery scrape: hotspot #%d at (%.5f, %.5f)",
                hotspot.cluster_id, hotspot.lat, hotspot.lon,
            )
            discovery_records = trigger_micro_scrape(hotspot.lat, hotspot.lon)
            if discovery_records:
                store.append(discovery_records, config.CARNAVAL_STORE_PATH)
                logger.info("  Appended %d discovery records", len(discovery_records))

    # --- Step 5: Event scraping (cache-guarded — fires at most once per hotspot per hour) ---
    total_new_events = 0
    for hotspot in hotspots:
        cached = cache_get(hotspot.lat, hotspot.lon, ttl_s=config.EVENT_CACHE_TTL_S)
        if cached is not None:
            logger.info(
                "  Events cache hit for hotspot #%d (%d events) — skipping scrape",
                hotspot.cluster_id, len(cached),
            )
            continue

        events = search_events_near(
            hotspot.lat, hotspot.lon,
            radius_km=config.EVENT_SEARCH_RADIUS_KM,
        )
        cache_put(hotspot.lat, hotspot.lon, events)

        if events:
            store.append(events, config.EVENTS_STORE_PATH)
            total_new_events += len(events)
            logger.info(
                "  Hotspot #%d: scraped %d events → %s",
                hotspot.cluster_id, len(events), config.EVENTS_STORE_PATH,
            )

    # Cycle summary
    total_hotspots = len(hotspots)
    total_venues_scraped = len(active_venues)
    saved = len(venues) - total_venues_scraped
    ev_stats = cache_stats()
    logger.info(
        "=== Cycle %d done: %d hotspot(s) → %d/%d venues scraped, %d new events "
        "(%d API calls saved, %d event cells cached) ===",
        cycle_num, total_hotspots, total_venues_scraped, len(venues),
        total_new_events, saved, ev_stats["cells_cached"],
    )


def main() -> None:
    venues = load_venues()
    logger.info("Loaded %d venues. Starting DBSCAN-guided Carnaval capture.", len(venues))
    logger.info("Store: %s  |  Interval: %d min", config.CARNAVAL_STORE_PATH,
                config.CAPTURE_INTERVAL_SECONDS // 60)
    logger.info("DBSCAN params: eps=%.0fm  min_samples=%d  venue_radius=%.0fm",
                _DBSCAN_EPS_M, _DBSCAN_MIN_SAMPLES, _VENUE_HOTSPOT_RADIUS_M)
    logger.info("Ctrl-C to stop cleanly.")

    cycle_count = 0
    while True:
        cycle_count += 1
        try:
            run_cycle(venues, cycle_count)
        except KeyboardInterrupt:
            logger.info("Stopped by user after %d cycles. Data in %s",
                        cycle_count, config.CARNAVAL_STORE_PATH)
            sys.exit(0)
        except Exception as exc:
            logger.error("Unexpected error in cycle %d: %s — continuing in %ds",
                         cycle_count, exc, config.CAPTURE_INTERVAL_SECONDS)

        logger.info("Sleeping %d min until cycle %d...",
                    config.CAPTURE_INTERVAL_SECONDS // 60, cycle_count + 1)
        try:
            time.sleep(config.CAPTURE_INTERVAL_SECONDS)
        except KeyboardInterrupt:
            logger.info("Stopped between cycles after %d completed.", cycle_count)
            sys.exit(0)


if __name__ == "__main__":
    main()
