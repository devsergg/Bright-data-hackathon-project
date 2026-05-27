import os
from dotenv import load_dotenv

load_dotenv()

# ── Bright Data credentials ───────────────────────────────────────────────────
# Zones available on this account: mcp_unlocker, mcp_browser
# Set BRIGHTDATA_ZONE in .env — all three scrapers read config.BRIGHTDATA_ZONE.
BRIGHTDATA_API_TOKEN: str = os.environ["BRIGHTDATA_API_TOKEN"]
BRIGHTDATA_ZONE: str = os.environ.get("BRIGHTDATA_ZONE", "mcp_unlocker")

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

