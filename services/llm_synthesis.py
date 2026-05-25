"""
Claude vibe synthesis agent — the AI core of Pulse AI.

Implements the same agentic tool-use loop as the hackathon reference:
  https://github.com/Stephen-Kimoi/claude-bright-data-research-agent

When a venue crosses the anomaly threshold (Lit Score ≥ 85 / Z > 2.0),
this agent is invoked. It:
  1. Receives venue context + live social posts
  2. Autonomously searches the web (Bright Data SERP) for tonight's event context
  3. Optionally deep-scrapes a specific URL (Bright Data Web Unlocker) for detail
  4. Synthesises everything into a one-sentence vibe + 3 keywords
  5. Returns a structured dict — and the whole trace is visible in LangSmith

Claude decides how many tool calls to make (up to MAX_AGENT_TURNS).
The agentic loop continues until Claude signals end_turn with the final JSON.
"""

import json
import logging
import os
import re
from typing import Optional

import anthropic
import requests

import config

logger = logging.getLogger(__name__)

# ── LangSmith tracing (optional — gracefully degrades if key not set) ─────────
try:
    if config.LANGSMITH_API_KEY:
        os.environ.setdefault("LANGCHAIN_API_KEY", config.LANGSMITH_API_KEY)
        os.environ.setdefault("LANGCHAIN_PROJECT", config.LANGSMITH_PROJECT)
        os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    from langsmith import traceable
    _HAS_LANGSMITH = bool(config.LANGSMITH_API_KEY)
except ImportError:
    def traceable(*args, **kwargs):       # type: ignore[misc]
        def decorator(fn):
            return fn
        return decorator
    _HAS_LANGSMITH = False

if _HAS_LANGSMITH:
    logger.info("LangSmith tracing enabled — project: %s", config.LANGSMITH_PROJECT)

# ── Constants ─────────────────────────────────────────────────────────────────
MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024
MAX_AGENT_TURNS = 5     # cap iterations; vibe synthesis doesn't need many
_BD_ENDPOINT = "https://api.brightdata.com/request"
_REQUEST_TIMEOUT_S = 30

_SYSTEM_PROMPT = """You are a nightlife intelligence analyst for Pulse AI — a real-time crowd \
anomaly app. Your job: describe what is actually happening at a specific venue RIGHT NOW in \
one vivid sentence.

You have two tools:
- search_web: Google for what's on at this venue tonight (events, DJs, specials, news)
- scrape_url: Fetch a specific page for detail (venue website, event listing, Yelp, etc.)

Workflow:
1. Search for "{venue} {neighborhood} San Francisco tonight" or similar
2. If a result URL looks useful, scrape it
3. Combine the search findings with the live social posts to write your synthesis

Output rules — respond ONLY with valid JSON, no markdown fences:
{"summary": "one sentence max 15 words", "keywords": ["kw1", "kw2", "kw3"]}

If no clear event is found: {"summary": "Packed for the night — the vibe is electric", \
"keywords": infer from the social posts}"""

# ── Bright Data tool implementations ─────────────────────────────────────────

def _bd_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.BRIGHTDATA_API_TOKEN}",
    }


def _search_web(query: str) -> str:
    """
    Google search via Bright Data SERP zone.
    Returns top results as plain text for Claude to reason over.
    """
    from urllib.parse import quote
    search_url = f"https://www.google.com/search?q={quote(query)}&num=5&hl=en&gl=us"
    payload = {
        "zone": config.BRIGHTDATA_SERP_ZONE,
        "url": search_url,
        "format": "json",
    }
    try:
        resp = requests.post(
            _BD_ENDPOINT, headers=_bd_headers(), json=payload,
            timeout=_REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()

        # Bright Data SERP returns results under various keys depending on the zone
        results = (
            data.get("organic_results")
            or data.get("organic")
            or data.get("results")
            or []
        )
        if not results:
            return f"No results found for: {query}"

        lines = []
        for r in results[:5]:
            title   = r.get("title", "")
            snippet = r.get("snippet") or r.get("description") or ""
            url     = r.get("link") or r.get("url") or ""
            lines.append(f"• {title}\n  {snippet}\n  {url}")
        return "\n\n".join(lines)

    except Exception as exc:
        logger.warning("search_web failed for %r: %s", query, exc)
        return f"Search failed: {exc}"


def _scrape_url(url: str) -> str:
    """
    Full page fetch via Bright Data Web Unlocker.
    Strips HTML tags and returns the first 4 000 chars for Claude to read.
    """
    zone = config.BRIGHTDATA_UNLOCKER_ZONE or config.BRIGHTDATA_SERP_ZONE
    payload = {"zone": zone, "url": url, "format": "raw"}
    try:
        resp = requests.post(
            _BD_ENDPOINT, headers=_bd_headers(), json=payload,
            timeout=_REQUEST_TIMEOUT_S,
        )
        resp.raise_for_status()
        html = resp.text
        # Strip tags, collapse whitespace
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:4000] if text else "Page was empty."
    except Exception as exc:
        logger.warning("scrape_url failed for %s: %s", url, exc)
        return f"Scrape failed: {exc}"


# ── Tool registry ─────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "search_web",
        "description": (
            "Search Google for current information about a venue or neighborhood. "
            "Use to find events, performances, DJ nights, or specials happening tonight."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query, e.g. 'El Rio Mission SF events tonight May 2026'",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "scrape_url",
        "description": (
            "Fetch the full text of a specific webpage — useful for a venue's own website, "
            "an Eventbrite/RA listing, or a Yelp page. Only call after search_web identifies "
            "a relevant URL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Full URL to fetch, e.g. 'https://www.elriosf.com/events'",
                }
            },
            "required": ["url"],
        },
    },
]


def _dispatch(tool_name: str, tool_input: dict) -> str:
    if tool_name == "search_web":
        return _search_web(tool_input["query"])
    if tool_name == "scrape_url":
        return _scrape_url(tool_input["url"])
    return f"Unknown tool: {tool_name}"


# ── Response parsing ──────────────────────────────────────────────────────────

def _parse_response(text: str) -> dict:
    """Extract JSON from Claude's final response, stripping any stray markdown."""
    text = re.sub(r"```(?:json)?|```", "", text).strip()
    try:
        data = json.loads(text)
        return {
            "summary": str(data.get("summary", "Busy — no clear reason")),
            "keywords": [str(k) for k in data.get("keywords", [])][:3],
        }
    except json.JSONDecodeError:
        logger.warning("Could not parse vibe JSON: %r", text[:300])
        return {"summary": "Busy — no clear reason", "keywords": []}


# ── Public interface ──────────────────────────────────────────────────────────

def _format_posts(posts: list[dict]) -> str:
    lines = []
    for p in posts[:15]:
        platform = p.get("platform", "social")
        text = (p.get("text") or p.get("description") or "").strip()[:200]
        tags = " ".join(f"#{t}" for t in (p.get("hashtags") or [])[:5])
        if text:
            lines.append(f"[{platform}] {text} {tags}".strip())
    return "\n".join(lines) if lines else "(no social posts available)"


@traceable(name="pulse_ai.synthesize_vibe")  # type: ignore[misc]
def synthesize_vibe(
    venue: dict,
    social_posts: list[dict],
    lit_score: int = 0,
) -> dict:
    """
    Claude agent: research a hot venue → return one-sentence vibe + 3 keywords.

    Args:
        venue:        venue dict from venues.json or a scraped record
        social_posts: recent posts near this venue from social_scraper
        lit_score:    current Lit Score (0-100); shown to Claude for context

    Returns:
        {"summary": str, "keywords": [str, str, str], "source_post_count": int,
         "agent_turns": int}
    """
    if not config.ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set — returning fallback vibe")
        return {
            "summary": "Busy — AI synthesis not configured",
            "keywords": ["nightlife", "active", "busy"],
            "source_post_count": len(social_posts),
            "agent_turns": 0,
        }

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    venue_name  = venue.get("name", "Unknown venue")
    neighborhood = venue.get("neighborhood", "San Francisco")
    posts_text  = _format_posts(social_posts)

    user_message = (
        f"Venue: {venue_name}\n"
        f"Neighborhood: {neighborhood}, San Francisco\n"
        f"Current Lit Score: {lit_score}/100\n\n"
        f"Live social posts:\n{posts_text}\n\n"
        f"Please search for what's happening at {venue_name} tonight, "
        f"then write the one-sentence vibe."
    )

    messages: list[dict] = [{"role": "user", "content": user_message}]
    final_text = ""
    turns_used = 0

    for turn in range(MAX_AGENT_TURNS):
        turns_used = turn + 1
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Collect text and tool calls from this response
        tool_calls = []
        for block in response.content:
            if block.type == "text":
                final_text = block.text
            elif block.type == "tool_use":
                tool_calls.append(block)

        logger.debug(
            "Turn %d: stop_reason=%s tool_calls=%d",
            turns_used, response.stop_reason, len(tool_calls),
        )

        # Claude is done — final JSON is in final_text
        if response.stop_reason == "end_turn" or not tool_calls:
            break

        # Append Claude's full response (must include tool_use blocks) to history
        messages.append({"role": "assistant", "content": response.content})

        # Execute tools and feed results back
        tool_results = []
        for block in tool_calls:
            result = _dispatch(block.name, block.input)
            logger.info(
                "  %s(%s) → %d chars",
                block.name, str(block.input)[:80], len(result),
            )
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result,
            })

        messages.append({"role": "user", "content": tool_results})

    vibe = _parse_response(final_text)
    vibe["source_post_count"] = len(social_posts)
    vibe["agent_turns"] = turns_used
    logger.info(
        "Vibe for %s [%d turns]: %s | %s",
        venue_name, turns_used, vibe["summary"], vibe["keywords"],
    )
    return vibe
