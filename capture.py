"""
Carnaval capture loop — DBSCAN-guided macro-to-micro funnel.

Flow every 15 minutes:
  1. Macro net    — fetch free Bay Wheels GBFS coordinates (no API cost)
  2. DBSCAN       — find density clusters → hotspot centroids
  3. Venue filter — only scrape known venues inside hotspot clusters
  4. Discovery    — coordinate search for hotspots with no known venue
  5. Events       — Google Events near each hotspot (1-hr cache)
  6. Social       — Twitter/Instagram posts near each hotspot (1-hr cache)
                    → cluster posts into social events via social_event_detector

Cost comparison vs. naive (scrape all venues every cycle):
  Naive:   20 venues × 30 cycles = 600 Bright Data calls
  DBSCAN:  ~5 active venues × 30 cycles ≈ 150 calls  (75% reduction)

Usage:
    export BRIGHTDATA_API_TOKEN="..."
    export BRIGHTDATA_ZONE="serp"
    python capture.py
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
from data_ingestion.social_scraper import fetch_social_context
from services.event_cache import get as cache_get, put as cache_put, stats as cache_stats
from services.social_event_detector import detect_social_events
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

    # --- Step 6: Social scraping (also cache-guarded — fires once per hotspot per hour) ---
    total_new_social_events = 0
    for hotspot in hotspots:
        # Reuse the same event cache keyed by (lat, lon) — social fires on same schedule
        social_cache_key = (hotspot.lat + 0.001, hotspot.lon)  # offset key from events
        cached_social = cache_get(social_cache_key[0], social_cache_key[1],
                                  ttl_s=config.EVENT_CACHE_TTL_S)
        if cached_social is not None:
            logger.info(
                "  Social cache hit for hotspot #%d — skipping scrape",
                hotspot.cluster_id,
            )
            continue

        from data_ingestion.event_scraper import _neighborhood_for
        neighborhood = _neighborhood_for(hotspot.lat, hotspot.lon)

        posts = fetch_social_context(hotspot.lat, hotspot.lon, neighborhood)
        # Cache even an empty result to avoid re-scraping a quiet hotspot
        cache_put(social_cache_key[0], social_cache_key[1], posts)

        if posts:
            store.append(posts, config.SOCIAL_STORE_PATH)
            social_events = detect_social_events(
                posts,
                hotspot_lat=hotspot.lat,
                hotspot_lon=hotspot.lon,
                neighborhood=neighborhood,
            )
            if social_events:
                social_event_dicts = [e.to_dict() for e in social_events]
                store.append(social_event_dicts, config.SOCIAL_EVENTS_STORE_PATH)
                total_new_social_events += len(social_events)
                logger.info(
                    "  Hotspot #%d: %d posts → %d social event(s) detected",
                    hotspot.cluster_id, len(posts), len(social_events),
                )

    # Cycle summary
    total_hotspots = len(hotspots)
    total_venues_scraped = len(active_venues)
    saved = len(venues) - total_venues_scraped
    ev_stats = cache_stats()
    logger.info(
        "=== Cycle %d done: %d hotspot(s) → %d/%d venues, %d new events, "
        "%d social events (%d API calls saved) ===",
        cycle_num, total_hotspots, total_venues_scraped, len(venues),
        total_new_events, total_new_social_events, saved,
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
