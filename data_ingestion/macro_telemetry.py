"""
Macro telemetry: free crowd-proxy coordinates for DBSCAN input.

Primary source: Bay Wheels (Lyft bikeshare) GBFS real-time station data.
  - No API key, no cost, updates every ~30s.
  - Stations where many bikes are present → people rode there → crowd activity.
  - Each station's coordinate is repeated proportionally to its activity weight,
    so DBSCAN naturally finds density in busy neighborhoods.

Fallback: synthetic coordinates around known SF activity centers.
  Used for local dev/testing when the GBFS feed is unreachable.
"""

import logging
import random
from typing import List, Tuple

import requests

logger = logging.getLogger(__name__)

_GBFS_INFO_URL = "https://gbfs.baywheels.com/gbfs/en/station_information.json"
_GBFS_STATUS_URL = "https://gbfs.baywheels.com/gbfs/en/station_status.json"
_TIMEOUT_S = 10

# Tight SF bounding box — skip stations in Oakland/Berkeley that are also in the feed
_LAT_MIN, _LAT_MAX = 37.70, 37.83
_LON_MIN, _LON_MAX = -122.52, -122.37

# Max times a single station's coordinate is repeated (caps outlier domination)
_MAX_WEIGHT = 12

# Synthetic fallback centers — Mission, SoMa, North Beach, Castro
_SYNTHETIC_CENTERS: List[Tuple[float, float]] = [
    (37.7599, -122.4148),  # 16th & Mission BART
    (37.7519, -122.4186),  # 24th & Mission
    (37.7623, -122.4216),  # Valencia corridor
    (37.7784, -122.4192),  # Castro
    (37.7765, -122.4106),  # SoMa / 11th St
    (37.7833, -122.4090),  # SoMa / Howard
    (37.8005, -122.4065),  # North Beach / Columbus
]


def _fetch_gbfs() -> List[Tuple[float, float]]:
    """Return weighted (lat, lon) tuples from Bay Wheels GBFS."""
    info_r = requests.get(_GBFS_INFO_URL, timeout=_TIMEOUT_S)
    status_r = requests.get(_GBFS_STATUS_URL, timeout=_TIMEOUT_S)
    info_r.raise_for_status()
    status_r.raise_for_status()

    info_by_id = {s["station_id"]: s for s in info_r.json()["data"]["stations"]}
    status_by_id = {s["station_id"]: s for s in status_r.json()["data"]["stations"]}

    coordinates: List[Tuple[float, float]] = []
    for sid, info in info_by_id.items():
        lat, lon = float(info["lat"]), float(info["lon"])
        if not (_LAT_MIN <= lat <= _LAT_MAX and _LON_MIN <= lon <= _LON_MAX):
            continue

        status = status_by_id.get(sid, {})
        bikes_available = int(status.get("num_bikes_available", 0))
        # bikes_available being high = people rode TO this station = crowd nearby
        weight = max(1, min(bikes_available, _MAX_WEIGHT))
        coordinates.extend([(lat, lon)] * weight)

    logger.info("GBFS: %d weighted points from %d in-bounds stations",
                len(coordinates), len(info_by_id))
    return coordinates


def _synthetic_fallback(points_per_center: int = 20) -> List[Tuple[float, float]]:
    """Gaussian jitter around known SF activity centers. For local testing."""
    logger.warning("Using synthetic coordinate fallback — real clustering won't work")
    coords: List[Tuple[float, float]] = []
    for lat, lon in _SYNTHETIC_CENTERS:
        for _ in range(points_per_center):
            coords.append((
                lat + random.gauss(0, 0.0015),
                lon + random.gauss(0, 0.0015),
            ))
    return coords


def fetch_macro_coordinates(region: str = "San_Francisco") -> List[Tuple[float, float]]:
    """
    Returns (lat, lon) crowd-proxy coordinates from free public data.
    Falls back to synthetic if the GBFS feed is unreachable.
    """
    try:
        return _fetch_gbfs()
    except Exception as exc:
        logger.warning("GBFS unavailable (%s) — using synthetic fallback", exc)
        return _synthetic_fallback()
