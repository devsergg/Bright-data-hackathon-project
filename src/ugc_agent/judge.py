from __future__ import annotations

"""Free candidate selection: Claude vision compares keyframe candidates for a
shot and picks the one most worth spending video credits on. Costs Anthropic
tokens only — zero Higgsfield credits."""

import base64
from pathlib import Path

import anthropic
from pydantic import BaseModel

from .config import Settings
from .scripting import Shot

_MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


class Verdict(BaseModel):
    winner_index: int
    reasoning: str
    animation_risk: str


def _image_block(path: Path) -> dict:
    data = base64.standard_b64encode(path.read_bytes()).decode()
    media_type = _MEDIA_TYPES.get(path.suffix.lower(), "image/png")
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}


def pick_winner(settings: Settings, shot: Shot, candidates: list[Path]) -> Verdict:
    if len(candidates) == 1:
        return Verdict(winner_index=0, reasoning="only candidate", animation_risk="n/a")

    content: list[dict] = []
    for i, path in enumerate(candidates):
        content.append({"type": "text", "text": f"Candidate {i}:"})
        content.append(_image_block(path))
    content.append(
        {
            "type": "text",
            "text": (
                f"Shot voiceover: \"{shot.voiceover}\"\n"
                f"On-screen text: \"{shot.on_screen_text}\"\n"
                f"Planned motion: \"{shot.motion_prompt}\"\n\n"
                "Pick the candidate to animate (winner_index is 0-based)."
            ),
        }
    )

    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=settings.claude_model,
        max_tokens=1500,
        thinking={"type": "adaptive"},
        system=(
            "You are the visual judge for a faceless UGC video pipeline. Only ONE "
            "candidate keyframe per shot gets animated (animation costs money). "
            "Judge by: (1) fit with the voiceover and on-screen text, (2) visual "
            "punch on a phone screen — strong subject, readable composition, "
            "space for caption text, (3) how well it will survive image-to-video "
            "animation — avoid candidates with garbled text, mangled hands, or "
            "busy detail that will smear in motion. Note any animation risk for "
            "the winner."
        ),
        messages=[{"role": "user", "content": content}],
        output_format=Verdict,
    )
    verdict = response.parsed_output
    if not 0 <= verdict.winner_index < len(candidates):
        verdict.winner_index = 0
    return verdict
