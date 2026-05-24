"""
User preference profile for "For You" personalisation.

No auth — client generates a UUID on first load and passes it as user_id.
Profile is content-based: weights on event categories, neighborhoods, and
time-of-day preferences. Updated by interaction signals from the frontend.

Weight decay: older interactions count for less so the profile stays current.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from services.social_event_detector import CATEGORY_KEYWORDS

# All trackable categories (keys must match CATEGORY_KEYWORDS)
ALL_CATEGORIES = list(CATEGORY_KEYWORDS.keys())

ALL_NEIGHBORHOODS = [
    "Mission District", "SoMa", "North Beach", "Castro",
    "Hayes Valley", "Financial District", "Richmond", "Sunset",
]

ALL_TIME_SLOTS = ["afternoon", "evening", "night", "late_night"]

# Interaction → weight delta applied to profile
INTERACTION_WEIGHTS: dict[str, float] = {
    "view":       0.05,   # tapped to open card
    "like":       0.30,   # pressed "Interested"
    "attend":     0.50,   # pressed "Going"
    "skip":      -0.15,   # pressed "Not for me"
    "dislike":   -0.30,   # explicit downvote
}

# After this many interactions the profile is considered "warm" enough to personalise
COLD_START_THRESHOLD = 3


@dataclass
class InteractionRecord:
    event_id: str
    action: Literal["view", "like", "attend", "skip", "dislike"]
    event_category: str
    event_neighborhood: str
    event_time_slot: str
    timestamp: str


@dataclass
class UserProfile:
    user_id: str
    created_at: str = ""
    updated_at: str = ""

    # Preference weights — range -1.0 to +1.0, start at 0.0 (neutral)
    category_weights: dict[str, float] = field(
        default_factory=lambda: {c: 0.0 for c in ALL_CATEGORIES}
    )
    neighborhood_weights: dict[str, float] = field(
        default_factory=lambda: {n: 0.0 for n in ALL_NEIGHBORHOODS}
    )
    time_weights: dict[str, float] = field(
        default_factory=lambda: {t: 0.0 for t in ALL_TIME_SLOTS}
    )

    # Raw interaction log (last 200 kept for decay computation)
    interactions: list[InteractionRecord] = field(default_factory=list)

    @property
    def interaction_count(self) -> int:
        return len(self.interactions)

    @property
    def is_warm(self) -> bool:
        """True once we have enough interactions to personalise meaningfully."""
        return self.interaction_count >= COLD_START_THRESHOLD

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "category_weights": self.category_weights,
            "neighborhood_weights": self.neighborhood_weights,
            "time_weights": self.time_weights,
            "interaction_count": self.interaction_count,
            "is_warm": self.is_warm,
            "interactions": [i.__dict__ for i in self.interactions[-50:]],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "UserProfile":
        profile = cls(
            user_id=d["user_id"],
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
            category_weights=d.get("category_weights", {c: 0.0 for c in ALL_CATEGORIES}),
            neighborhood_weights=d.get("neighborhood_weights", {n: 0.0 for n in ALL_NEIGHBORHOODS}),
            time_weights=d.get("time_weights", {t: 0.0 for t in ALL_TIME_SLOTS}),
        )
        for rec in d.get("interactions", []):
            try:
                profile.interactions.append(InteractionRecord(**rec))
            except TypeError:
                pass  # skip malformed records
        return profile

    @classmethod
    def new(cls, user_id: str) -> "UserProfile":
        now = datetime.now(timezone.utc).isoformat()
        return cls(user_id=user_id, created_at=now, updated_at=now)
