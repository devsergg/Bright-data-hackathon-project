"""
Append-only JSONL store for venue telemetry cycles and events.

One JSON object per line, never overwrites — every call to append() grows the file.
Two stores: capture_*.jsonl for venue telemetry, capture_events.jsonl for events.
"""

import json
import os


def append(records: list[dict], path: str) -> None:
    """Append a list of venue records to the JSONL store at `path`."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, default=str, ensure_ascii=False) + "\n")


def read_all(path: str) -> list[dict]:
    """Read every record from the JSONL store. Returns [] if file doesn't exist."""
    if not os.path.exists(path):
        return []
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass  # skip corrupted lines
    return records


def read_cycles(path: str) -> dict[str, list[dict]]:
    """
    Group records by scraped_at timestamp.
    Returns {timestamp_str: [venue_records]} ordered chronologically.
    """
    from collections import defaultdict
    groups: dict[str, list[dict]] = defaultdict(list)
    for record in read_all(path):
        ts = record.get("scraped_at", "unknown")
        groups[ts].append(record)
    return dict(sorted(groups.items()))


def latest_cycle(path: str) -> list[dict]:
    """Return the most recent complete cycle's records."""
    cycles = read_cycles(path)
    if not cycles:
        return []
    return list(cycles.values())[-1]


# ---------------------------------------------------------------------------
# Events store helpers
# ---------------------------------------------------------------------------

def events_near(
    lat: float,
    lon: float,
    radius_km: float = 1.0,
    path: str = "data/capture_events.jsonl",
) -> list[dict]:
    """
    Return all stored events within radius_km of (lat, lon).
    Uses a simple Euclidean approximation (fine at city scale).
    """
    from utils.geo_math import haversine_meters
    radius_m = radius_km * 1000
    results = []
    for record in read_all(path):
        rlat = record.get("latitude") or record.get("hotspot_lat")
        rlon = record.get("longitude") or record.get("hotspot_lon")
        if rlat is None or rlon is None:
            continue
        if haversine_meters(lat, lon, float(rlat), float(rlon)) <= radius_m:
            results.append(record)
    return results


def events_for_neighborhood(
    neighborhood: str,
    path: str = "data/capture_events.jsonl",
) -> list[dict]:
    """Return stored events matching a neighborhood name (case-insensitive)."""
    needle = neighborhood.lower()
    return [r for r in read_all(path) if needle in (r.get("neighborhood") or "").lower()]
