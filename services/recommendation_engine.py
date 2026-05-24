"""
Content-based recommendation engine for the "For You" section.

No ML library — just weighted keyword overlap between user profile and event
text, with a cold-start fallback to DBSCAN density ranking.

Profile update model:
  - Each interaction adds a delta to category/neighborhood/time weights.
  - Weights are clipped to [-1.0, +1.0] so one type of event can't dominate.
  - Decay: interactions older than 7 days contribute half as much.

Scoring model:
  - Base score: sum of (term_match × category_weight) for all event terms.
  - Neighborhood bonus: +0.2 if event neighborhood matches a preferred one.
  - Time bonus: +0.1 if event time slot matches preference.
  - Final score normalised to [0, 1].
"""

import logging
import math
import re
from datetime import datetime, timezone
from typing import Optional

from data import profiles as profile_store
from models.user_profile import (
    ALL_CATEGORIES, INTERACTION_WEIGHTS, UserProfile, InteractionRecord,
)
from services.social_event_detector import CATEGORY_KEYWORDS, _KEYWORD_TO_CATEGORY

logger = logging.getLogger(__name__)

_MAX_WEIGHT = 1.0
_MIN_WEIGHT = -1.0
_DECAY_HALF_LIFE_DAYS = 7.0


def _time_slot(time_str: Optional[str]) -> str:
    """Map a time string to one of our four time slots."""
    if not time_str:
        return "night"
    # Try to extract an hour from common formats: "8:00 PM", "20:00", "8pm"
    import re as _re
    m = _re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", time_str.lower())
    if not m:
        return "night"
    hour = int(m.group(1))
    period = m.group(3)
    if period == "pm" and hour < 12:
        hour += 12
    elif period == "am" and hour == 12:
        hour = 0

    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 20:
        return "evening"
    if 20 <= hour < 24:
        return "night"
    return "late_night"


def _event_terms(event: dict) -> list[str]:
    """Extract category-relevant keywords from an event's text fields."""
    text = " ".join(filter(None, [
        event.get("name"), event.get("description"),
        event.get("venue_name"), event.get("topic"),
    ])).lower()
    words = re.findall(r"[a-z0-9]+", text)
    return [w for w in words if w in _KEYWORD_TO_CATEGORY]


def _event_category(event: dict) -> str:
    terms = _event_terms(event)
    if not terms:
        return event.get("category", "nightlife")
    from collections import Counter
    cats = Counter(_KEYWORD_TO_CATEGORY[t] for t in terms)
    return cats.most_common(1)[0][0]


def _decay_factor(timestamp_str: str) -> float:
    """Exponential decay — interaction from N days ago contributes 2^(-N/half_life)."""
    try:
        ts = datetime.fromisoformat(timestamp_str)
        now = datetime.now(timezone.utc)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_days = (now - ts).total_seconds() / 86400
        return math.pow(2, -age_days / _DECAY_HALF_LIFE_DAYS)
    except (ValueError, TypeError):
        return 1.0


# ---------------------------------------------------------------------------
# Profile update
# ---------------------------------------------------------------------------

def apply_interaction(
    user_id: str,
    event: dict,
    action: str,
) -> UserProfile:
    """
    Record a user interaction and update their preference weights.

    action: one of "view", "like", "attend", "skip", "dislike"
    Returns the updated profile.
    """
    profile = profile_store.load(user_id)
    delta = INTERACTION_WEIGHTS.get(action, 0.0)

    category = _event_category(event)
    neighborhood = event.get("neighborhood") or event.get("venue_address", "")
    time_slot = _time_slot(event.get("start_time"))

    # Update category weight
    if category in profile.category_weights:
        new_w = profile.category_weights[category] + delta
        profile.category_weights[category] = max(_MIN_WEIGHT, min(_MAX_WEIGHT, new_w))

    # Update neighborhood weight (partial match)
    for nb in list(profile.neighborhood_weights.keys()):
        if nb.lower() in neighborhood.lower():
            new_w = profile.neighborhood_weights[nb] + delta * 0.5
            profile.neighborhood_weights[nb] = max(_MIN_WEIGHT, min(_MAX_WEIGHT, new_w))
            break

    # Update time weight
    if time_slot in profile.time_weights:
        new_w = profile.time_weights[time_slot] + delta * 0.3
        profile.time_weights[time_slot] = max(_MIN_WEIGHT, min(_MAX_WEIGHT, new_w))

    # Log the interaction
    profile.interactions.append(InteractionRecord(
        event_id=event.get("id", "unknown"),
        action=action,  # type: ignore[arg-type]
        event_category=category,
        event_neighborhood=neighborhood,
        event_time_slot=time_slot,
        timestamp=datetime.now(timezone.utc).isoformat(),
    ))
    # Keep only the last 200 interactions
    if len(profile.interactions) > 200:
        profile.interactions = profile.interactions[-200:]

    profile_store.save(profile)
    logger.info(
        "Interaction: user=%s action=%s category=%s → weight %.2f",
        user_id, action, category, profile.category_weights.get(category, 0),
    )
    return profile


# ---------------------------------------------------------------------------
# Scoring & ranking
# ---------------------------------------------------------------------------

def score_event(event: dict, profile: UserProfile) -> float:
    """
    Score a single event for this user. Returns 0.0–1.0.

    Cold-start: if profile isn't warm yet, returns 0.5 (neutral) so the
    caller can rank by another signal (e.g. DBSCAN density).
    """
    if not profile.is_warm:
        return 0.5

    score = 0.0
    max_possible = 0.0

    # Category contribution
    terms = _event_terms(event)
    if terms:
        from collections import Counter
        cat_counts = Counter(_KEYWORD_TO_CATEGORY[t] for t in terms)
        for cat, count in cat_counts.items():
            weight = profile.category_weights.get(cat, 0.0)
            score += weight * (count / len(terms))
            max_possible += 1.0

    # Neighborhood bonus
    neighborhood = event.get("neighborhood") or ""
    for nb, w in profile.neighborhood_weights.items():
        if nb.lower() in neighborhood.lower() and w > 0:
            score += w * 0.2
            max_possible += 0.2
            break

    # Time slot bonus
    time_slot = _time_slot(event.get("start_time"))
    tw = profile.time_weights.get(time_slot, 0.0)
    if tw > 0:
        score += tw * 0.1
        max_possible += 0.1

    if max_possible == 0:
        return 0.5

    # Normalise to [0, 1]
    raw = score / max_possible
    return round(max(0.0, min(1.0, (raw + 1) / 2)), 4)


def rank_events(
    events: list[dict],
    user_id: str,
    density_fallback: bool = True,
) -> list[dict]:
    """
    Return events sorted by relevance for user_id.

    When the profile is cold (< COLD_START_THRESHOLD interactions), falls
    back to sorting by DBSCAN density_weight (hottest spot first) so the
    "For You" section still shows something useful.

    Each returned event gets a 'for_you_score' and 'for_you_reason' field
    so the frontend can explain the ranking to the user.
    """
    profile = profile_store.load(user_id)

    scored: list[tuple[float, dict]] = []
    for ev in events:
        s = score_event(ev, profile)
        ev = dict(ev)  # don't mutate the original
        ev["for_you_score"] = s

        if not profile.is_warm:
            ev["for_you_reason"] = "Popular in your area"
        else:
            cat = _event_category(ev)
            w = profile.category_weights.get(cat, 0.0)
            if w > 0.2:
                ev["for_you_reason"] = f"You like {cat}"
            elif ev.get("neighborhood") and any(
                n.lower() in ev["neighborhood"].lower()
                for n, v in profile.neighborhood_weights.items() if v > 0.1
            ):
                ev["for_you_reason"] = "Near a place you like"
            else:
                ev["for_you_reason"] = "Happening nearby"

        scored.append((s, ev))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [ev for _, ev in scored]


def profile_summary(user_id: str) -> dict:
    """Return a trimmed profile suitable for the API response."""
    profile = profile_store.load(user_id)
    top_cats = sorted(profile.category_weights.items(), key=lambda x: x[1], reverse=True)
    top_nbs = sorted(profile.neighborhood_weights.items(), key=lambda x: x[1], reverse=True)
    return {
        "user_id": user_id,
        "is_warm": profile.is_warm,
        "interaction_count": profile.interaction_count,
        "top_categories": [{"name": c, "weight": round(w, 2)} for c, w in top_cats[:3] if w > 0],
        "top_neighborhoods": [{"name": n, "weight": round(w, 2)} for n, w in top_nbs[:3] if w > 0],
    }
