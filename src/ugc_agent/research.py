from __future__ import annotations

"""Topic sourcing: pull recent items from the account's RSS feeds, then have
Claude pick the single best topic for the niche, skipping anything already
covered."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import anthropic
from pydantic import BaseModel

from .config import Account, Settings

MAX_ITEMS = 40
FRESH_DAYS = 5


class TopicChoice(BaseModel):
    headline: str
    tool_name: str
    why_now: str
    source_url: str
    key_facts: list[str]


def fetch_items(account: Account) -> list[dict]:
    import feedparser  # lazy: keeps the package importable without feedparser

    cutoff = datetime.now(timezone.utc) - timedelta(days=FRESH_DAYS)
    items: list[dict] = []
    for feed_url in account["sources"]["rss"]:
        parsed = feedparser.parse(feed_url)
        for e in parsed.entries[:15]:
            published = None
            if getattr(e, "published_parsed", None):
                published = datetime(*e.published_parsed[:6], tzinfo=timezone.utc)
            if published and published < cutoff:
                continue
            items.append(
                {
                    "title": e.get("title", ""),
                    "summary": (e.get("summary", "") or "")[:500],
                    "link": e.get("link", ""),
                }
            )
    return items[:MAX_ITEMS]


def _covered_path(account: Account, data_dir: Path) -> Path:
    return data_dir / account.name / "covered_topics.json"


def load_covered(account: Account, data_dir: Path) -> list[str]:
    p = _covered_path(account, data_dir)
    return json.loads(p.read_text()) if p.exists() else []


def mark_covered(account: Account, data_dir: Path, headline: str) -> None:
    p = _covered_path(account, data_dir)
    covered = load_covered(account, data_dir)
    covered.append(headline)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(covered[-200:], indent=2))


def pick_topic(settings: Settings, account: Account, items: list[dict], covered: list[str]) -> TopicChoice:
    if not items:
        raise RuntimeError("No fresh items from RSS sources — check feeds/network.")
    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=settings.claude_model,
        max_tokens=2000,
        thinking={"type": "adaptive"},
        system=(
            "You pick topics for a faceless short-form video account.\n"
            f"Niche: {account['niche']}\n"
            f"Audience: {account['audience']}\n"
            "Pick the ONE item with the best hook potential: new, useful, "
            "demonstrable, and explainable in ~35 seconds. Avoid anything in "
            "the already-covered list. key_facts must only contain facts "
            "stated in the item's title/summary — do not invent capabilities."
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Already covered:\n{json.dumps(covered[-50:], indent=1)}\n\n"
                    f"Candidate items:\n{json.dumps(items, indent=1)}"
                ),
            }
        ],
        output_format=TopicChoice,
    )
    return response.parsed_output
