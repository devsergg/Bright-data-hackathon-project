import os

# Bright Data credentials
# Set these before running:
#   export BRIGHTDATA_API_TOKEN="your_token_here"
#   export BRIGHTDATA_ZONE="your_zone_name_here"
BRIGHTDATA_API_TOKEN: str = os.environ["BRIGHTDATA_API_TOKEN"]
BRIGHTDATA_ZONE: str = os.environ.get("BRIGHTDATA_ZONE", "serp")

# LLM keys (needed for Day 1+ synthesis, not tonight)
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
LANGSMITH_API_KEY: str = os.environ.get("LANGSMITH_API_KEY", "")

# Capture settings
CAPTURE_INTERVAL_SECONDS: int = 15 * 60  # 15 minutes
CARNAVAL_STORE_PATH: str = "data/capture_carnaval.jsonl"
CONTROL_STORE_PATH: str = "data/capture_control.jsonl"
EVENTS_STORE_PATH: str = "data/capture_events.jsonl"
VENUES_PATH: str = "data/venues.json"

# Anomaly threshold — Z-score above this triggers social scrape (Day 1+)
ANOMALY_Z_THRESHOLD: float = 2.0

# Event scraping
EVENT_SEARCH_RADIUS_KM: float = 1.0   # radius for nearby-events API queries
EVENT_CACHE_TTL_S: int = 3600         # 1 hour — events don't change every 15 min
