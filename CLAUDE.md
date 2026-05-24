# Pulse AI — The Lit Index

**Hackathon:** Bright Data | **Owner:** Sergio Garcia | **Solo, 5 days**  
**Demo:** Carnaval weekend foot-traffic captured live, replayed on an animated map.  
**Local working dir:** `/Users/sergiogarcia/Desktop/Tech Projects/Brightdata-Hackathon`

---

## One-line pitch
Real-time crowd anomaly detection that tells you where the night is actually happening — powered by Bright Data scraping, DBSCAN spatial clustering, and an LLM vibe synthesizer.

---

## Architecture: Macro → DBSCAN → Micro

```
[Bay Wheels GBFS]  ← free, no API key, ~300 SF stations
       ↓ weighted (lat,lon) tuples
  DBSCAN clustering  (eps=200m, min_samples=10)
       ↓ hotspot centroids (typically 3-6 for SF)
       ├─ venues_near_hotspots()  → fetch_maps_telemetry()   ← Bright Data (venue-specific, gets popular_times)
       ├─ trigger_micro_scrape()                             ← Bright Data (coord search, discovery only)
       ├─ search_events_near()                               ← Bright Data (Google Events SERP)
       └─ fetch_social_context()                             ← Bright Data (Twitter/X + Instagram)
                                        ↓
                             detect_social_events()          ← hashtag/keyword clustering, no ML
                                        ↓
                              JSONL stores (append-only)
                                        ↓
                              FastAPI  →  Frontend map
```

**Cost model:** ~5 active venues × 30 cycles ≈ 150 Maps calls/night (vs 600 naive).  
Events + social each fire once per hotspot per hour (1-hr TTL cache).

---

## File Map

```
Brightdata-Hackathon/
│
├── capture.py                       # MAIN ENTRY — 15-min cron loop, run this tonight
├── main.py                          # FastAPI app (uvicorn main:app)
├── config.py                        # All env vars loaded here — never hardcode keys
├── requirements.txt
│
├── data_ingestion/
│   ├── macro_telemetry.py           # FREE: Bay Wheels GBFS → weighted (lat,lon) coords
│   ├── maps_scraper.py              # Bright Data SERP → venue telemetry + popular_times
│   │                                #   FIELD_MAP at top — verify after first run
│   ├── event_scraper.py             # Bright Data SERP → Google Events near hotspot
│   │                                #   EVENT_FIELD_MAP at top — verify after first run
│   └── social_scraper.py            # Bright Data SERP → Twitter/X + Instagram posts
│                                    #   SOCIAL_FIELD_MAP at top — verify after first run
│
├── services/
│   ├── spatial_clustering.py        # DBSCAN engine + venues_near_hotspots()
│   ├── event_cache.py               # 1-hr TTL cache — prevents re-scraping same hotspot
│   ├── social_event_detector.py     # Clusters posts by hashtag/keyword → SocialEvent
│   │                                #   CATEGORY_KEYWORDS dict — used by recommender too
│   ├── recommendation_engine.py     # For You: content-based scoring + profile updates
│   └── anomaly_engine.py            # TODO Day 1: Z-score Lit Score computation
│
├── api/
│   └── routes.py                    # All FastAPI route handlers
│
├── data/
│   ├── venues.json                  # 20 SF venues (10 Mission, 5 SoMa, 2 North Beach…)
│   ├── store.py                     # append() / read_all() / events_near() for JSONL
│   ├── profiles.py                  # Per-user JSON profile load/save/delete
│   ├── profiles/                    # Created at runtime — one {user_id}.json per user
│   ├── capture_carnaval.jsonl       # ← TONIGHT'S DATA (gitignored, never overwrite)
│   ├── capture_control.jsonl        # ← CONTROL NIGHT data (quiet weeknight)
│   ├── capture_events.jsonl         # Google Events captures
│   ├── capture_social_posts.jsonl   # Raw social posts
│   └── capture_social_events.jsonl  # Clustered social events
│
├── models/
│   ├── venue.py                     # VenueTelemetry dataclass
│   ├── hotspot.py                   # Hotspot dataclass (DBSCAN centroid)
│   ├── event.py                     # Event dataclass
│   └── user_profile.py              # UserProfile + InteractionRecord dataclasses
│
└── utils/
    └── geo_math.py                  # haversine_meters(lat1,lon1,lat2,lon2)
```

---

## Environment Variables

```bash
# Required for capture to run:
export BRIGHTDATA_API_TOKEN="your_bearer_token_here"
export BRIGHTDATA_ZONE="serp"           # or your zone name from the dashboard

# Required for Day 2 LLM synthesis:
export ANTHROPIC_API_KEY="..."
export LANGSMITH_API_KEY="..."          # for LangSmith tracing (optional but impressive)
```

---

## Running Locally

```bash
# 1. Go to project dir
cd "/Users/sergiogarcia/Desktop/Tech Projects/Brightdata-Hackathon"

# 2. Create venv (Python 3.10+ required for union type hints)
python3 -m venv .venv
source .venv/bin/activate

# 3. Install deps
pip install -r requirements.txt

# 4. Set credentials
export BRIGHTDATA_API_TOKEN="..."
export BRIGHTDATA_ZONE="serp"

# 5. Start the Carnaval capture loop (leave this running until 2 AM)
python capture.py

# 6. (Optional, separate terminal) Run the API server
uvicorn main:app --reload --port 8000
```

---

## Bright Data Integration

**Single endpoint for all scraping:** `POST https://api.brightdata.com/request`  
**Auth:** `Authorization: Bearer $BRIGHTDATA_API_TOKEN`  
**Payload always includes:** `{"zone": ZONE, "url": "...", "format": "raw", "brd_json": 1}`

### Field maps — verify these after the first scrape cycle

All three scrapers log the **full raw JSON** on the very first successful call.  
Open `capture.log` and search for `=== RAW RESPONSE ===` to see what the API actually returns.  
Then correct any wrong keys in:

| File | Constant | What to fix |
|---|---|---|
| `data_ingestion/maps_scraper.py` | `FIELD_MAP` | `popular_times`, `live_occupancy`, `current_status` |
| `data_ingestion/event_scraper.py` | `EVENT_FIELD_MAP` | `name`, `start_time`, `venue_name`, `source_url` |
| `data_ingestion/social_scraper.py` | `SOCIAL_FIELD_MAP` | `text`, `author`, `posted_at`, `hashtags` |

The most critical: **`popular_times` in `FIELD_MAP`**. This is the baseline for all Lit Score math. If it's absent from the response, stop the cron immediately and fix before 11 PM.

### URL patterns used

```python
# Venue-specific Maps scrape (returns popular_times)
"https://www.google.com/maps/search/{name}+{address}"

# Coordinate discovery search
"https://www.google.com/maps/search/bars+nightlife/@{lat},{lon},16z"

# Google Events panel
f"https://www.google.com/search?q=events+tonight+{neighborhood}&ibp=htl;events&hl=en&gl=us"

# Twitter/X live search
f"https://twitter.com/search?q=%22{neighborhood}%22+OR+%23{tag}&f=live"

# Instagram hashtag
f"https://www.instagram.com/explore/tags/{tag}/"
```

---

## Lit Score Math (Day 1)

```
Z = (live_occupancy − μ_h) / σ_h
lit_score = clamp(round(50 + 25 × Z), 0, 100)
```

| Z | Lit Score | State |
|---|---|---|
| ≤ 0 | 0–50 | At or below normal |
| 0–2.0 | 50–100 | Busier than usual |
| > 2.0 | 85–100 | 🔥 Anomaly → triggers social scrape |

**Baseline sources (priority order):**
1. `popular_times` histogram from maps scrape = μ_h (captured for free every cycle)
2. Control-night capture (quiet weeknight) = real σ_h
3. Synthetic fallback: `σ_h = max(0.20 × μ_h, 5)`

**Color gradient:** White → Cyan → Violet → Neon Orange (cold to hot)

---

## DBSCAN Tuning

```python
# In capture.py:
_DBSCAN_EPS_M = 200          # neighbourhood radius in meters (~1 SF city block)
_DBSCAN_MIN_SAMPLES = 10     # min points to form a cluster
_VENUE_HOTSPOT_RADIUS_M = 600  # how far a known venue can be from a centroid and still get scraped
_QUIET_NIGHT_FALLBACK_COUNT = 5  # venues to scrape when DBSCAN finds nothing
```

If the Mission cluster is being **missed**: lower `_DBSCAN_MIN_SAMPLES` to 5.  
If too many **false clusters**: raise `_DBSCAN_EPS_M` to 300 or `_DBSCAN_MIN_SAMPLES` to 15.  
Bay Wheels stations are sparser in the Mission than downtown — synthetic fallback kicks in if GBFS is unreachable.

---

## API Endpoints (all live now)

```
POST /api/v1/scan-grid
    Full macro→DBSCAN→micro funnel on demand. Returns hotspots + venues + events.

GET  /api/v1/nearby-events?lat=&lon=&radius_km=1&live=false
    Events near a point. live=true fires a fresh Bright Data scrape (costs quota).

GET  /api/v1/events/neighborhood/{name}
    e.g. /api/v1/events/neighborhood/Mission%20District

GET  /api/v1/events/all?limit=50

GET  /api/v1/social-events?lat=&lon=&neighborhood=
    Clustered social events (post-derived, not calendar-based).

GET  /api/v1/social-events/trending
    Top topics by post_count across all social captures.

GET  /api/v1/for-you?user_id={uuid}&lat=&lon=&radius_km=2
    Personalised feed. Cold start (<3 interactions) → density ranking.
    Warm → content-based scoring by category/neighborhood/time weights.

POST /api/v1/profile/signal?user_id={uuid}&action={view|like|attend|skip|dislike}
    Body: { ...eventObject }   Updates user preference profile.

GET  /api/v1/profile/{user_id}     Returns profile summary.
DELETE /api/v1/profile/{user_id}   Resets profile.

GET  /map-data?t={timestamp}       Day 2 (anomaly engine required)
GET  /timeline                     Day 2
GET  /venue-details/{id}?t=        Day 2
```

---

## For You — Personalisation Model

**No auth.** Client generates UUID on first load → stored in localStorage → passed as `user_id`.  
Profiles stored in `data/profiles/{user_id}.json` (atomic write via temp→rename).

**Preference vectors (range −1 to +1, start 0):**
- `category_weights`: music, nightlife, food, sports, art, comedy, festival
- `neighborhood_weights`: Mission District, SoMa, North Beach, Castro, Hayes Valley…
- `time_weights`: afternoon, evening, night, late_night

**Interaction deltas:**
| Signal | Δ weight |
|---|---|
| view (tap to open) | +0.05 |
| like ("Interested") | +0.30 |
| attend ("Going") | +0.50 |
| skip ("Not for me") | −0.15 |
| dislike | −0.30 |

**7-day exponential decay** — a week-old like counts half as much as tonight's.  
**Cold start threshold:** 3 interactions → `is_warm = true` → personalisation activates.

---

## Social Event Detection

Posts from Twitter/X + Instagram are clustered in `social_event_detector.py`:
1. Index posts by hashtags + category keywords from `CATEGORY_KEYWORDS`
2. Sort terms by post frequency
3. Greedy assignment: posts go to their most popular term's cluster
4. Clusters with ≥ 3 posts → `SocialEvent` with confidence score

```
3 posts → confidence ≈ 0.31
5 posts → confidence ≈ 0.46
10 posts → confidence ≈ 0.71
20 posts → confidence ≈ 0.92
```

`CATEGORY_KEYWORDS` in `social_event_detector.py` is the shared vocabulary used by **both** the social detector and the recommendation engine.

---

## Data Stores (all JSONL, gitignored)

| File | Written by | Read by |
|---|---|---|
| `capture_carnaval.jsonl` | `capture.py` | anomaly engine, replay API |
| `capture_control.jsonl` | `capture.py` (control night) | anomaly engine baseline |
| `capture_events.jsonl` | event scraper | `/api/v1/nearby-events`, For You |
| `capture_social_posts.jsonl` | social scraper | social event detector |
| `capture_social_events.jsonl` | social event detector | `/api/v1/social-events`, For You |
| `data/profiles/{uid}.json` | recommendation engine | `/api/v1/for-you` |

---

## Build Status

- [x] Day 0: venues.json, config.py, maps_scraper.py, store.py, capture.py
- [x] Day 0+: DBSCAN spatial funnel (macro_telemetry, spatial_clustering, trigger_micro_scrape)
- [x] Day 0+: Google Events layer (event_scraper, event_cache, /api/v1/nearby-events)
- [x] Day 0+: Social scraping + post clustering (social_scraper, social_event_detector)
- [x] Day 0+: For You personalisation (recommendation_engine, user_profile, profiles store)
- [x] Day 0+: FastAPI skeleton (main.py, api/routes.py) with all current endpoints
- [ ] Day 1: anomaly_engine.py — Z-score + Lit Score against popular_times baseline
- [ ] Day 1: Verify all three FIELD_MAPs against real Bright Data responses
- [ ] Day 2: llm_synthesis.py + LangSmith tracing
- [ ] Day 2: Control-night capture (quiet weeknight Tue/Wed)
- [ ] Day 2: /map-data, /timeline, /venue-details endpoints (needs anomaly engine)
- [ ] Day 3–4: Frontend — dark Mapbox map, animated markers, replay scrubber, vibe cards
- [ ] Day 3–4: For You panel UI + interaction signal integration
- [ ] Day 5: Tune Z multiplier on real data, demo rehearsal, backup video, submit

---

## Demo Script (3 min)

1. **Hook (20s):** "Saturday was Carnaval in the Mission — half a million people. This is what happened to the neighborhood's nightlife, captured live every 15 minutes."  
   Open map at 6:30 PM, mostly cool.

2. **Replay (50s):** Hit play. Mission lights up cyan → violet → orange as the festival crowd floods the bars. Real data, real night.

3. **Bright Data moment (40s):** "Every reading is live Google Popular Times via Bright Data — foot traffic no public API exposes. DBSCAN finds the anomaly clusters; we only pay for scrapes where the math says something is actually happening."  
   Show a LangSmith trace.

4. **AI vibe (30s):** Tap a hot venue → one-sentence synthesis from real Carnaval-night posts. Read the keyword chips.

5. **The proof (20s):** Toggle to control night — same venues, cool and quiet. "This is the difference between a busy bar and an actual event."

6. **Close (10s):** "No users required. The city tells us where it's alive."
