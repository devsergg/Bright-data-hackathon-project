from __future__ import annotations

"""Claude scriptwriter: turns a chosen topic into a hook, per-shot voiceover,
visual prompts for keyframe generation, and posting metadata."""

import anthropic
from pydantic import BaseModel

from .config import Account, Settings
from .research import TopicChoice


class Shot(BaseModel):
    index: int
    voiceover: str
    on_screen_text: str
    image_prompt: str
    motion_prompt: str


class VideoScript(BaseModel):
    title: str
    hook: str
    shots: list[Shot]
    caption: str
    hashtags: list[str]
    affiliate_cta: str


def write_script(settings: Settings, account: Account, topic: TopicChoice) -> VideoScript:
    video = account["video"]
    affiliate = account.get("affiliate", {})
    known_links = affiliate.get("links", {}) or {}
    link = known_links.get(topic.tool_name.lower())

    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=settings.claude_model,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        system=(
            "You write scripts for faceless short-form videos (9:16, AI-generated "
            "b-roll, voiceover + on-screen text, no presenter).\n"
            f"Account niche: {account['niche']}\n"
            f"Tone: {account['tone']}\n"
            f"Target length: {video['duration_seconds']}s across exactly "
            f"{video['shots']} shots.\n\n"
            "Rules:\n"
            "- Shot 1 voiceover IS the hook: a bold, specific claim or question "
            "in under 12 words.\n"
            "- Each shot's voiceover is 1-2 short sentences (~6s spoken).\n"
            "- image_prompt: a vivid, concrete scene for a text-to-image model. "
            "Faceless: abstract tech visuals, screens, hands, environments — "
            "never a recognizable presenter or real person's likeness, never "
            "brand logos.\n"
            "- motion_prompt: simple camera/subject motion for image-to-video "
            "(e.g. 'slow push-in, screen glow pulses'). Keep motion subtle — "
            "draft models handle subtle motion best.\n"
            "- on_screen_text: max 6 words, the takeaway of the shot.\n"
            "- Stay strictly within the provided key facts. No invented features.\n"
            "- Final shot is the CTA. "
            + (
                f"An affiliate link exists for this tool; affiliate_cta should drive "
                f"to 'link in bio' and the caption must include this disclosure: "
                f"\"{affiliate.get('disclosure', '')}\""
                if link
                else f"No affiliate link for this tool; use this CTA instead: "
                f"\"{affiliate.get('fallback_cta', 'Follow for daily AI tools.')}\""
            )
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Topic: {topic.headline}\n"
                    f"Tool: {topic.tool_name}\n"
                    f"Why now: {topic.why_now}\n"
                    f"Source: {topic.source_url}\n"
                    f"Key facts:\n- " + "\n- ".join(topic.key_facts)
                ),
            }
        ],
        output_format=VideoScript,
    )
    return response.parsed_output
