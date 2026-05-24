"""
Append-only JSONL store for venue telemetry cycles.

One JSON object per line, one line per venue per cycle.
Never overwrites — every call to append() grows the file.
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
