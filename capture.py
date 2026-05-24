"""
Carnaval capture loop — run this tonight and leave it until 2 AM.

Usage:
    export BRIGHTDATA_API_TOKEN="your_token_here"
    export BRIGHTDATA_ZONE="your_zone_name_here"   # e.g. "serp" or your zone
    python capture.py

The loop scrapes all venues every 15 minutes and appends results to
data/capture_carnaval.jsonl.  A simple Ctrl-C stops it cleanly.
"""

import json
import logging
import sys
import time
from datetime import datetime, timezone

import config
from data import store
from data_ingestion.maps_scraper import fetch_maps_telemetry

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


def load_venues() -> list[dict]:
    with open(config.VENUES_PATH, encoding="utf-8") as f:
        return json.load(f)


def run_cycle(venues: list[dict]) -> None:
    logger.info("--- Cycle start at %s ---", datetime.now(timezone.utc).isoformat())
    records = fetch_maps_telemetry(venues)
    if records:
        store.append(records, config.CARNAVAL_STORE_PATH)
        logger.info("Appended %d records to %s", len(records), config.CARNAVAL_STORE_PATH)

        # Quick sanity print: show occupancy values this cycle
        for r in records:
            pop = "YES" if r.get("popular_times") else "NO"
            logger.info(
                "  %-30s  occupancy=%-5s  popular_times=%s",
                r.get("name", r["id"]),
                r.get("live_occupancy"),
                pop,
            )
    else:
        logger.warning("Cycle produced 0 records — check scraper errors above.")


def main() -> None:
    venues = load_venues()
    logger.info("Loaded %d venues. Starting Carnaval capture. Ctrl-C to stop.", len(venues))
    logger.info("Writing to: %s", config.CARNAVAL_STORE_PATH)
    logger.info("Interval: %d minutes", config.CAPTURE_INTERVAL_SECONDS // 60)

    cycle_count = 0
    while True:
        cycle_count += 1
        logger.info("=== CYCLE %d ===", cycle_count)
        try:
            run_cycle(venues)
        except KeyboardInterrupt:
            logger.info("Stopped by user after %d cycles. Data is in %s",
                        cycle_count, config.CARNAVAL_STORE_PATH)
            sys.exit(0)
        except Exception as exc:
            # Never let an unexpected error kill the overnight loop.
            logger.error("Unexpected error in cycle %d: %s — continuing in %ds",
                         cycle_count, exc, config.CAPTURE_INTERVAL_SECONDS)

        next_run = datetime.now(timezone.utc)
        logger.info("Sleeping %d min until next cycle...", config.CAPTURE_INTERVAL_SECONDS // 60)
        try:
            time.sleep(config.CAPTURE_INTERVAL_SECONDS)
        except KeyboardInterrupt:
            logger.info("Stopped between cycles after %d completed cycles.", cycle_count)
            sys.exit(0)


if __name__ == "__main__":
    main()
