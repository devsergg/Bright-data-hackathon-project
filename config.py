import os

# ── Bright Data credentials ───────────────────────────────────────────────────
# Set these before running:
#   export BRIGHTDATA_API_TOKEN="your_bearer_token"
#   export BRIGHTDATA_SERP_ZONE="your_serp_zone_name"       # e.g. "serp_api2"
#   export BRIGHTDATA_UNLOCKER_ZONE="your_unlocker_zone"    # e.g. "web_unlocker1"
#
# Legacy single-zone fallback: BRIGHTDATA_ZONE still works if you haven't split yet.
BRIGHTDATA_API_TOKEN: str = os.environ["BRIGHTDATA_API_TOKEN"]
BRIGHTDATA_SERP_ZONE: str = os.environ.get(
    "BRIGHTDATA_SERP_ZONE",
    os.environ.get("BRIGHTDATA_ZONE", "serp"),          # backward-compatible fallback
)
BRIGHTDATA_UNLOCKER_ZONE: str = os.environ.get(
    "BRIGHTDATA_UNLOCKER_ZONE",
    os.environ.get("BRIGHTDATA_ZONE", ""),              # falls back to same zone if not split
)

# ── LLM / tracing keys ───────────────────────────────────────────────────────
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
LANGSMITH_API_KEY: str = os.environ.get("LANGSMITH_API_KEY", "")
LANGSMITH_PROJECT: str = os.environ.get("LANGSMITH_PROJECT", "pulse-ai")

# ── Capture settings ─────────────────────────────────────────────────────────
CAPTURE_INTERVAL_SECONDS: int = 15 * 60  # 15 minutes
CARNAVAL_STORE_PATH: str = "data/capture_carnaval.jsonl"
CONTROL_STORE_PATH: str = "data/capture_control.jsonl"
EVENTS_STORE_PATH: str = "data/capture_events.jsonl"
SOCIAL_STORE_PATH: str = "data/capture_social_posts.jsonl"
SOCIAL_EVENTS_STORE_PATH: str = "data/capture_social_events.jsonl"
VENUES_PATH: str = "data/venues.json"

# ── Anomaly / scoring ────────────────────────────────────────────────────────
ANOMALY_Z_THRESHOLD: float = 2.0   # Z > this triggers social scrape + vibe synthesis

# ── Event scraping ───────────────────────────────────────────────────────────
EVENT_SEARCH_RADIUS_KM: float = 1.0
EVENT_CACHE_TTL_S: int = 3600       # 1 hour — events don't change every 15 min

