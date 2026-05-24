"""
User profile persistence — one JSON file per user in data/profiles/.

Flat file approach: simple, no database dependency, easy to inspect.
Each file is a complete profile snapshot; writes are atomic (write temp → rename).
"""

import json
import logging
import os
import tempfile
from datetime import datetime, timezone

from models.user_profile import UserProfile

logger = logging.getLogger(__name__)

_PROFILES_DIR = "data/profiles"


def _path(user_id: str) -> str:
    # Sanitise user_id to prevent path traversal (UUIDs only in practice)
    safe_id = "".join(c for c in user_id if c.isalnum() or c == "-")[:64]
    return os.path.join(_PROFILES_DIR, f"{safe_id}.json")


def load(user_id: str) -> UserProfile:
    """Load a profile, or return a fresh one if it doesn't exist yet."""
    path = _path(user_id)
    if not os.path.exists(path):
        return UserProfile.new(user_id)
    try:
        with open(path, encoding="utf-8") as f:
            return UserProfile.from_dict(json.load(f))
    except (json.JSONDecodeError, KeyError) as exc:
        logger.warning("Corrupt profile for %s (%s) — resetting", user_id, exc)
        return UserProfile.new(user_id)


def save(profile: UserProfile) -> None:
    """Atomically write the profile to disk."""
    os.makedirs(_PROFILES_DIR, exist_ok=True)
    path = _path(profile.user_id)
    profile.updated_at = datetime.now(timezone.utc).isoformat()
    data = profile.to_dict()
    # Atomic write: write to temp file then rename
    dir_ = os.path.dirname(path)
    with tempfile.NamedTemporaryFile("w", dir=dir_, delete=False,
                                    suffix=".tmp", encoding="utf-8") as tf:
        json.dump(data, tf, ensure_ascii=False, indent=2)
        tmp_path = tf.name
    os.replace(tmp_path, path)
    logger.debug("Saved profile for %s (%d interactions)", profile.user_id,
                 profile.interaction_count)


def delete(user_id: str) -> bool:
    """Delete a user's profile. Returns True if the file existed."""
    path = _path(user_id)
    if os.path.exists(path):
        os.remove(path)
        return True
    return False
