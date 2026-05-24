"""
1-hour TTL event cache keyed by ~1km grid cell.

Events don't change on a 15-minute cycle. Caching prevents re-scraping the
same neighborhood every loop iteration, which would burn quota for no new data.

Cache key: (round(lat, 2), round(lon, 2))  — 0.01° ≈ 1km grid.
"""

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Seconds before a cached result is considered stale
_DEFAULT_TTL_S = 3600  # 1 hour

# {(lat_grid, lon_grid): {"events": [...], "fetched_at": float}}
_cache: dict[tuple[float, float], dict] = {}


def _grid_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, 2), round(lon, 2))


def get(lat: float, lon: float, ttl_s: int = _DEFAULT_TTL_S) -> Optional[list[dict]]:
    """Return cached events if fresh, else None."""
    key = _grid_key(lat, lon)
    entry = _cache.get(key)
    if entry is None:
        return None
    age_s = time.time() - entry["fetched_at"]
    if age_s > ttl_s:
        logger.debug("Event cache stale for (%.2f, %.2f): age=%.0fs", lat, lon, age_s)
        return None
    logger.info(
        "Event cache hit for (%.2f, %.2f): %d events, age=%.0fs",
        lat, lon, len(entry["events"]), age_s,
    )
    return entry["events"]


def put(lat: float, lon: float, events: list[dict]) -> None:
    """Store events in cache for this grid cell."""
    key = _grid_key(lat, lon)
    _cache[key] = {"events": events, "fetched_at": time.time()}
    logger.info("Event cache set for (%.2f, %.2f): %d events", lat, lon, len(events))


def invalidate(lat: float, lon: float) -> None:
    """Force the next access to re-scrape, e.g. after a major update."""
    _cache.pop(_grid_key(lat, lon), None)


def stats() -> dict:
    return {"cells_cached": len(_cache), "total_events": sum(len(v["events"]) for v in _cache.values())}
