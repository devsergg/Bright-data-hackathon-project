---
name: higgsfield
description: >
  Generate images and videos via Higgsfield (Seedream, Seedance, Sora, Veo,
  Kling, Flux, Hailuo, Soul, Cinema Studio and 30+ other models) through the
  Higgsfield MCP or the platform API. Use this skill whenever the user wants
  to generate UGC video scenes, keyframe images, or b-roll, or asks about
  Higgsfield credits/costs.
---

# Higgsfield skill

This project generates faceless UGC videos. Higgsfield is the generation
backend, reachable two ways:

1. **MCP** (interactive sessions): the `higgsfield` server is declared in
   `.mcp.json` (`https://mcp.higgsfield.ai/mcp`). First use requires OAuth —
   run `/mcp` and authenticate, then call `select_workspace` before any
   generation. MCP tools: explore models, `generate_image`, `generate_video`,
   check `balance`.
2. **API** (the automated pipeline): `src/ugc_agent/higgsfield.py` wraps the
   official `higgsfield-client` SDK (`HF_API_KEY` / `HF_API_SECRET` env vars,
   keys from https://cloud.higgsfield.ai).

## Credit discipline — non-negotiable

Before ANY `generate_image` or `generate_video` call (MCP or API), quote:

1. Model + settings (resolution, duration)
2. Estimated credit cost (cost table lives in `config/settings.yaml` →
   `higgsfield.cost_table`)
3. Current balance / remaining daily budget (see `data/ledger.json`,
   `python -m ugc_agent budget`)
4. Balance after the call

Rules baked into this project — follow them in interactive sessions too:

- **Images before videos.** Keyframe candidates are cheap text-to-image calls.
  Judge candidates as images; only the winning keyframe is animated.
- **Draft settings by default.** 480p / 4s for candidate and standard clips.
  Only upscale or re-render the final cut when the account config sets
  `high_quality_final: true`.
- **Always pass an explicit duration.** Omitting duration on Seedance defaults
  to 12 s — triple the cost of a 4 s clip.
- **Never bypass the budget guard.** The pipeline's `CreditLedger` enforces
  per-run and per-day caps; don't generate outside it without telling the user
  the cost first.

## Useful model defaults (verify in MCP `explore models` / pricing page)

| Purpose | Model | Approx. cost |
|---|---|---|
| Keyframe candidates | `bytedance/seedream/v4/text-to-image` | ~0.5–1 credit / image |
| Clip animation (draft) | Seedance lite image-to-video, 480p 4s | ~2.4 credits |
| Hero / final shot | Seedance pro or Kling, 720p+ | 5–15 credits |

Reference passing: media IDs, job IDs (for image→video chains), or public
URLs all work as image references.
