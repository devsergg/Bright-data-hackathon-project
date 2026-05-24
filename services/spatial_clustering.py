"""
DBSCAN spatial clustering engine — the macro-to-micro cost filter.

Takes raw crowd-proxy coordinates (from free public APIs) and returns
mathematically verified hotspot centroids. Bright Data scrapes are only
fired at those centroids, not across every venue on every cycle.
"""

import logging
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

from models.hotspot import Hotspot
from utils.geo_math import haversine_meters

logger = logging.getLogger(__name__)

EARTH_RADIUS_METERS = 6_371_000


def extract_hotspots(
    raw_coordinates: List[Tuple[float, float]],
    eps_meters: float = 200,
    min_samples: int = 10,
) -> List[Hotspot]:
    """
    Applies DBSCAN to identify high-density coordinate clusters.

    Args:
        raw_coordinates: (latitude, longitude) tuples from the macro net.
            Active areas should be represented with repeated/weighted points.
        eps_meters: Neighbourhood radius in meters. ~200m ≈ 1 city block.
        min_samples: Minimum points in a neighbourhood to form a core point.
            Lower = more sensitive; raise if you get too many false clusters.

    Returns:
        List of Hotspot centroids, sorted descending by density_weight.
        Empty list means no clusters found (city is quiet).
    """
    if not raw_coordinates:
        logger.warning("extract_hotspots: received empty coordinate list")
        return []

    df = pd.DataFrame(raw_coordinates, columns=["lat", "lon"])

    eps_radians = eps_meters / EARTH_RADIUS_METERS
    rad_coords = np.radians(df[["lat", "lon"]].values)

    db = DBSCAN(
        eps=eps_radians,
        min_samples=min_samples,
        metric="haversine",
        algorithm="ball_tree",
    )
    df["cluster"] = db.fit_predict(rad_coords)

    noise_count = (df["cluster"] == -1).sum()
    n_clusters = df["cluster"].nunique() - (1 if -1 in df["cluster"].values else 0)
    logger.info(
        "DBSCAN: %d input points → %d clusters, %d noise points",
        len(raw_coordinates),
        n_clusters,
        noise_count,
    )

    clusters_df = df[df["cluster"] != -1]
    if clusters_df.empty:
        logger.info("No clusters found — city is quiet or macro data is sparse")
        return []

    hotspots: List[Hotspot] = []
    for cluster_id in clusters_df["cluster"].unique():
        group = clusters_df[clusters_df["cluster"] == cluster_id]
        hotspots.append(
            Hotspot(
                cluster_id=int(cluster_id),
                lat=round(float(group["lat"].mean()), 6),
                lon=round(float(group["lon"].mean()), 6),
                density_weight=len(group),
            )
        )

    hotspots.sort(key=lambda h: h.density_weight, reverse=True)
    for h in hotspots:
        logger.info(
            "  Hotspot #%d  lat=%.5f lon=%.5f  density=%d",
            h.cluster_id, h.lat, h.lon, h.density_weight,
        )
    return hotspots


def venues_near_hotspots(
    venues: List[Dict],
    hotspots: List[Hotspot],
    radius_m: float = 600,
) -> List[Dict]:
    """
    Return the subset of known venues within radius_m of any hotspot centroid.

    Using known venues (rather than free-form coordinate searches) preserves
    the popular_times histogram that the Lit Score baseline math depends on.
    """
    if not hotspots:
        return []

    active: List[Dict] = []
    for venue in venues:
        lat = venue.get("lat") or venue.get("latitude")
        lon = venue.get("lon") or venue.get("longitude") or venue.get("lng")
        if lat is None or lon is None:
            # venues.json uses lat/lon embedded in the address; skip distance filter
            active.append(venue)
            continue
        for hotspot in hotspots:
            if haversine_meters(lat, lon, hotspot.lat, hotspot.lon) <= radius_m:
                active.append(venue)
                break

    logger.info(
        "venues_near_hotspots: %d/%d venues are within %.0fm of a hotspot",
        len(active), len(venues), radius_m,
    )
    return active
