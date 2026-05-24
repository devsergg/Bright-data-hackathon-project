"""
Social event detector — turns a pile of social posts into structured events.

Algorithm:
  1. Collect all hashtags + high-frequency keywords from the post set.
  2. Group posts that share a dominant term (a "topic cluster").
  3. Any cluster with >= MIN_POSTS_PER_CLUSTER members → emit a SocialEvent.
  4. SocialEvent gets a confidence score based on post volume and recency.

No ML library required — simple frequency counting + set intersection.
The LLM synthesizer (Day 2) consumes these clusters to write the one-liner vibe.
"""

import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# Minimum posts sharing a topic for it to become a SocialEvent
MIN_POSTS_PER_CLUSTER = 3

# Stopwords to ignore when counting body words
_STOPWORDS = {
    "the", "a", "an", "and", "or", "in", "at", "to", "of", "is", "it",
    "this", "that", "i", "we", "are", "was", "were", "be", "been",
    "for", "on", "with", "have", "had", "but", "not", "so", "by",
    "from", "they", "he", "she", "you", "we", "my", "our", "their",
    "just", "like", "get", "got", "its", "im", "its", "amp",
}

# Keyword → category mapping (also used by recommendation engine)
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "music":     ["concert", "live", "band", "dj", "jazz", "salsa", "cumbia",
                  "reggaeton", "hiphop", "hip-hop", "edm", "techno", "soul",
                  "funk", "latin", "merengue", "bachata", "music", "musician",
                  "gig", "show", "perform", "set"],
    "nightlife": ["bar", "club", "lounge", "cocktail", "nightclub", "dance",
                  "party", "drinks", "shots", "happy", "hour", "karaoke",
                  "drag", "rave", "afterparty"],
    "food":      ["food", "eat", "dinner", "brunch", "tacos", "restaurant",
                  "chef", "tasting", "menu", "kitchen", "bite", "feast",
                  "burger", "pizza", "sushi", "pop-up", "popup"],
    "sports":    ["game", "match", "watch", "sports", "basketball", "football",
                  "soccer", "baseball", "nba", "nfl", "mlb", "playoff",
                  "giants", "warriors", "49ers"],
    "art":       ["art", "gallery", "exhibit", "opening", "museum", "mural",
                  "installation", "photo", "artist", "creative", "design"],
    "comedy":    ["comedy", "standup", "improv", "mic", "laugh", "funny",
                  "comedian", "joke", "roast"],
    "festival":  ["festival", "carnaval", "carnival", "fair", "parade",
                  "celebration", "fiesta", "block", "street", "outdoor"],
}

# Flatten for reverse lookup: keyword → category
_KEYWORD_TO_CATEGORY: dict[str, str] = {
    kw: cat for cat, kws in CATEGORY_KEYWORDS.items() for kw in kws
}


@dataclass
class SocialEvent:
    topic: str                     # dominant hashtag / keyword that binds the cluster
    category: str                  # inferred category (music, nightlife, etc.)
    post_count: int                # how many posts are in this cluster
    confidence: float              # 0.0–1.0 based on post volume + recency
    representative_posts: list[dict] = field(default_factory=list)  # up to 5 samples
    hashtags: list[str] = field(default_factory=list)               # all tags in cluster
    detected_at: str = ""
    hotspot_lat: Optional[float] = None
    hotspot_lon: Optional[float] = None
    neighborhood: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "topic": self.topic,
            "category": self.category,
            "post_count": self.post_count,
            "confidence": round(self.confidence, 3),
            "hashtags": self.hashtags[:10],
            "representative_posts": [
                {k: v for k, v in p.items() if k not in ("raw_response",)}
                for p in self.representative_posts
            ],
            "detected_at": self.detected_at,
            "hotspot_lat": self.hotspot_lat,
            "hotspot_lon": self.hotspot_lon,
            "neighborhood": self.neighborhood,
        }


def _tokenise(text: str) -> list[str]:
    """Lowercase words, strip punctuation, drop stopwords."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    return [w for w in words if w not in _STOPWORDS and len(w) > 2]


def _infer_category(terms: list[str]) -> str:
    """Map a set of terms to the best-matching category."""
    counts: Counter = Counter()
    for t in terms:
        cat = _KEYWORD_TO_CATEGORY.get(t)
        if cat:
            counts[cat] += 1
    if counts:
        return counts.most_common(1)[0][0]
    return "nightlife"  # default for SF after dark


def _confidence(post_count: int, max_count: int) -> float:
    """
    Sigmoid-like confidence score.
    3 posts → ~0.40, 5 → ~0.60, 10 → ~0.80, 20+ → ~0.95
    """
    import math
    return round(1 - math.exp(-post_count / 8), 3)


def detect_social_events(
    posts: list[dict],
    min_cluster_size: int = MIN_POSTS_PER_CLUSTER,
    hotspot_lat: Optional[float] = None,
    hotspot_lon: Optional[float] = None,
    neighborhood: Optional[str] = None,
) -> list[SocialEvent]:
    """
    Cluster posts by shared topic and emit SocialEvents for clusters that meet
    the minimum size threshold.

    Returns events sorted by post_count descending (strongest signal first).
    """
    if not posts:
        return []

    detected_at = datetime.now(timezone.utc).isoformat()

    # Build term → [post] index using hashtags + body keywords
    term_to_posts: dict[str, list[dict]] = defaultdict(list)
    for post in posts:
        terms: set[str] = set()

        # Hashtags are the strongest signal
        for tag in (post.get("hashtags") or []):
            terms.add(tag.lower().strip("#"))

        # Also mine the post body for category keywords
        text = post.get("text") or post.get("description") or ""
        for word in _tokenise(text):
            if word in _KEYWORD_TO_CATEGORY:
                terms.add(word)

        for term in terms:
            term_to_posts[term].append(post)

    if not term_to_posts:
        logger.info("social_event_detector: no usable terms found in %d posts", len(posts))
        return []

    # Rank terms by how many posts they appear in
    ranked_terms = sorted(term_to_posts.items(), key=lambda kv: len(kv[1]), reverse=True)

    # Greedily assign each post to its most popular term's cluster
    assigned_ids: set[str] = set()
    events: list[SocialEvent] = []

    for topic, topic_posts in ranked_terms:
        unassigned = [p for p in topic_posts if p["id"] not in assigned_ids]
        if len(unassigned) < min_cluster_size:
            continue

        for p in unassigned:
            assigned_ids.add(p["id"])

        # Collect all hashtags from this cluster for display
        all_tags: list[str] = []
        for p in unassigned:
            all_tags.extend(p.get("hashtags") or [])
        tag_counts = Counter(all_tags)
        top_tags = [t for t, _ in tag_counts.most_common(8)]

        # Infer category from the cluster's combined vocabulary
        all_terms = [topic] + [t for p in unassigned
                                for t in _tokenise(p.get("text") or "")]
        category = _infer_category(all_terms)

        max_count = len(ranked_terms[0][1]) if ranked_terms else 1
        events.append(SocialEvent(
            topic=topic,
            category=category,
            post_count=len(unassigned),
            confidence=_confidence(len(unassigned), max_count),
            representative_posts=unassigned[:5],
            hashtags=top_tags,
            detected_at=detected_at,
            hotspot_lat=hotspot_lat,
            hotspot_lon=hotspot_lon,
            neighborhood=neighborhood,
        ))

    events.sort(key=lambda e: e.post_count, reverse=True)
    logger.info(
        "social_event_detector: %d posts → %d social event(s) in %s",
        len(posts), len(events), neighborhood or "unknown",
    )
    for ev in events:
        logger.info(
            "  [%s] topic=#%s  posts=%d  confidence=%.2f",
            ev.category, ev.topic, ev.post_count, ev.confidence,
        )
    return events
