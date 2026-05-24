# Pulse AI — Project Context

**Hackathon:** Bright Data  
**Solo build, 5 days. Demo: Carnaval weekend data replayed on a live map.**

## Architecture summary
- Capture pipeline (tonight): `capture.py` → `data_ingestion/maps_scraper.py` → `data/store.py` → `data/capture_carnaval.jsonl`
- Anomaly engine (Day 1): `services/anomaly_engine.py` — Z-score against `popular_times` baseline
- Social + LLM (Day 1-2): `data_ingestion/social_scraper.py` + `services/llm_synthesis.py`
- API (Day 2): `api/routes.py` on FastAPI — `/map-data?t=`, `/timeline`, `/venue-details/{id}`
- Frontend (Day 3-4): dark-theme Mapbox/Leaflet map, replay scrubber, vibe cards

## Bright Data integration
- **SERP API** (synchronous): `POST https://api.brightdata.com/request`
- Auth: `Authorization: Bearer $BRIGHTDATA_API_TOKEN`
- Zone: `$BRIGHTDATA_ZONE` (default: "serp")
- All Bright Data calls isolated in `data_ingestion/` — schema changes touch one file
- Field mapping in `data_ingestion/maps_scraper.py:FIELD_MAP` — verify after first run

## Key data decisions
- **Lit Score**: `clamp(round(50 + 25 * Z), 0, 100)` where Z = (live_occupancy - μ_h) / σ_h
- **Baseline μ_h**: `popular_times` histogram from each Maps scrape
- **σ_h**: from control-night capture (Tue/Wed); fallback `max(0.20 * μ_h, 5)`
- **Anomaly threshold**: Z > 2.0 triggers social scrape
- **Store format**: JSONL, one record per venue per cycle. Never overwrite.
- **Replay**: frontend steps through `scraped_at` timestamps; `/timeline` lists them

## Color gradient (cold → hot)
White → Cyan → Violet → Neon Orange

## Env vars required tonight
```
BRIGHTDATA_API_TOKEN   # Bright Data bearer token
BRIGHTDATA_ZONE        # zone name, e.g. "serp"
```

## Day status
- [x] Day 0: venues.json, config.py, maps_scraper.py, store.py, capture.py
- [ ] Day 1: anomaly_engine.py, social_scraper.py, verify field names from first run
- [ ] Day 2: llm_synthesis.py + LangSmith, control-night capture, FastAPI endpoints
- [ ] Day 3-4: frontend map, replay scrubber, vibe cards
- [ ] Day 5: tune, rehearse, record backup video, submit
