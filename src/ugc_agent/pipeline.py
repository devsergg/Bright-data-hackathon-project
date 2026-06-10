from __future__ import annotations

"""Orchestrator: research -> script -> cheap candidates -> free judging ->
animate winners -> assemble -> queue. Credit caps are enforced inside the
Higgsfield wrapper; this module decides what is worth generating at all."""

import json
import time
from dataclasses import dataclass
from pathlib import Path

from . import assemble, higgsfield, judge, research, scripting
from .budget import Ledger
from .config import Account, Settings
from .publish.base import enqueue
from .scripting import VideoScript


@dataclass
class RunResult:
    run_dir: Path
    video: Path | None
    queued: Path | None
    credits_spent: float


def estimate_run(settings: Settings, account: Account) -> float:
    video = account["video"]
    n_shots = video["shots"]
    n_cand = video["candidates_per_shot"]
    est = n_shots * n_cand * settings.credit_estimate("text_to_image")
    est += n_shots * settings.credit_estimate("image_to_video_draft")
    if account["quality"].get("final_upgrade"):
        est += n_shots * settings.credit_estimate("image_to_video_final")
    return est


def run(settings: Settings, account: Account, dry_run: bool = False) -> RunResult:
    data_dir = settings.data_dir
    run_dir = data_dir / account.name / "runs" / time.strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)

    budget = account["budget"]
    ledger = Ledger(
        data_dir / "ledger.json",
        max_per_run=budget["max_credits_per_run"],
        max_per_day=budget["max_credits_per_day"],
    )

    # 1. Research (free)
    items = research.fetch_items(account)
    covered = research.load_covered(account, data_dir)
    topic = research.pick_topic(settings, account, items, covered)
    (run_dir / "topic.json").write_text(topic.model_dump_json(indent=2))
    print(f"[topic] {topic.headline}  ({topic.source_url})")

    # 2. Script (free)
    script = scripting.write_script(settings, account, topic)
    (run_dir / "script.json").write_text(script.model_dump_json(indent=2))
    print(f"[script] \"{script.title}\" — {len(script.shots)} shots")

    estimate = estimate_run(settings, account)
    print(f"[budget] estimated cost {estimate:.1f} cr | {ledger.summary()}")
    if dry_run:
        print("[dry-run] stopping before any Higgsfield spend.")
        return RunResult(run_dir, None, None, 0.0)
    if ledger.run_spent + estimate > ledger.max_per_run or ledger.day_spent + estimate > ledger.max_per_day:
        raise SystemExit(
            f"Estimated {estimate:.1f} cr exceeds a budget cap ({ledger.summary()}). "
            "Lower shots/candidates or raise the cap."
        )

    # 3-5. Per shot: candidates -> judge -> animate winner
    hf = higgsfield.Higgsfield(settings, ledger)
    video_cfg = account["video"]
    quality = account["quality"]
    models = account["models"]
    clips: list[Path] = []
    winners: list[Path] = []
    verdicts: list[dict] = []

    for shot in script.shots:
        shot_dir = run_dir / f"shot{shot.index:02d}"
        candidates: list[Path] = []
        for c in range(video_cfg["candidates_per_shot"]):
            url = hf.text_to_image(
                models["text_to_image"], shot.image_prompt, video_cfg["aspect_ratio"]
            )
            candidates.append(higgsfield.download(url, shot_dir / f"candidate{c}.png"))
        verdict = judge.pick_winner(settings, shot, candidates)
        verdicts.append({"shot": shot.index, **verdict.model_dump()})
        winner = candidates[verdict.winner_index]
        winners.append(winner)
        print(f"[shot {shot.index}] winner=candidate{verdict.winner_index} — {verdict.reasoning[:80]}")

        clip_url = hf.image_to_video(
            models["image_to_video"],
            winner,
            shot.motion_prompt,
            resolution=quality["draft"]["resolution"],
            duration=quality["draft"]["duration"],
        )
        clips.append(higgsfield.download(clip_url, shot_dir / "clip.mp4"))

    (run_dir / "verdicts.json").write_text(json.dumps(verdicts, indent=2))

    # 6. Optional high-quality re-render of all winning shots
    if quality.get("final_upgrade"):
        final_clips = []
        for shot, winner, clip in zip(script.shots, winners, clips):
            url = hf.image_to_video(
                models["image_to_video"],
                winner,
                shot.motion_prompt,
                resolution=quality["final"]["resolution"],
                duration=quality["final"]["duration"],
                final=True,
            )
            final_clips.append(higgsfield.download(url, clip.parent / "clip_final.mp4"))
        clips = final_clips

    # 7. Assemble + metadata
    video_path = assemble.concat_clips(clips, run_dir / "final.mp4")
    meta_path = assemble.write_metadata(
        run_dir,
        script,
        extra={
            "account": account.name,
            "topic": topic.model_dump(),
            "credits_spent": ledger.run_spent,
            "voiceover_full": " ".join(s.voiceover for s in script.shots),
        },
    )
    research.mark_covered(account, data_dir, topic.headline)

    # 8. Queue for review / posting
    queued = enqueue(data_dir, account.name, video_path, meta_path)
    print(f"[done] {video_path} -> queued at {queued} | {ledger.summary()}")

    if account["publishing"].get("auto_post"):
        publish_item(account, queued)

    return RunResult(run_dir, video_path, queued, ledger.run_spent)


def publish_item(account: Account, item_dir: Path) -> dict[str, str]:
    """Push one queue item to every configured platform. Failures on one
    platform don't block the others."""
    from .publish.base import load_item
    from .publish.instagram import InstagramAdapter
    from .publish.tiktok import TikTokAdapter
    from .publish.youtube import YouTubeAdapter

    adapters = {"youtube": YouTubeAdapter, "tiktok": TikTokAdapter, "instagram": InstagramAdapter}
    video, metadata = load_item(item_dir)
    results: dict[str, str] = {}
    for platform in account["publishing"]["platforms"]:
        cls = adapters.get(platform)
        if cls is None:
            results[platform] = "error: unknown platform"
            continue
        try:
            results[platform] = cls().post(video, metadata)
            print(f"[publish] {platform}: {results[platform]}")
        except Exception as e:  # surface per-platform failure, keep going
            results[platform] = f"error: {e}"
            print(f"[publish] {platform} FAILED: {e}")
    (item_dir / "publish_results.json").write_text(json.dumps(results, indent=2))
    return results
