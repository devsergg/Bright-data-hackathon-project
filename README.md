# UGC Agent — autonomous faceless video system

An agentic pipeline that produces faceless UGC short-form videos (TikTok / Reels /
Shorts) end-to-end: it researches trending AI tool news, writes a script and shot
list with Claude, generates **cheap keyframe candidates** on Higgsfield, has Claude
**judge the candidates visually for free** (no Higgsfield credits), animates only
the winning keyframes, assembles the final video, and queues it for posting.

Built for multi-account operation. The first account, `ai-edu`, covers
**educational AI tools & new releases** with the goal of landing brand/UGC
partnerships with tech companies and earning affiliate revenue.

## How it saves Higgsfield credits

The expensive operation is video generation. The pipeline never animates anything
that hasn't already won a free comparison:

```
1. Research      RSS feeds → Claude picks the best topic        (0 credits)
2. Script        Claude writes hook, VO, shot list              (0 credits)
3. Keyframes     2 cheap text-to-image candidates per shot      (~1-3 cr/img)
4. Judge         Claude vision picks the better keyframe        (0 credits)
5. Animate       image-to-video on the WINNER only, draft       (~2-4 cr/shot)
                 settings (low res, short duration)
6. (optional)    re-render final winner shots at high quality   (off by default)
7. Assemble      ffmpeg concat + captions + metadata            (0 credits)
8. Publish       queue → manual review or auto-post             (0 credits)
```

A hard budget ledger (`data/ledger.json`) enforces per-run and per-day credit caps.
Every Higgsfield call is estimated **before** it is made and refused if it would
exceed the cap.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# ffmpeg is required for assembly:  apt install ffmpeg  /  brew install ffmpeg
```

Environment variables:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude — scripting, topic selection, visual judging |
| `HF_API_KEY` / `HF_API_SECRET` (or combined `HF_KEY="key:secret"`) | Higgsfield platform API ([higgsfield.ai](https://higgsfield.ai) → API keys) |

### Higgsfield MCP (interactive use in Claude Code)

For interactive generation inside Claude Code (the repo's `higgsfield` skill uses it):

```bash
claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
```

Then run `/mcp` to complete OAuth and select your workspace.

## Usage

```bash
# Full pipeline for the ai-edu account (asks nothing, respects budget caps)
python -m ugc_agent run --account ai-edu

# See candidate topics without spending anything
python -m ugc_agent topics --account ai-edu

# Script + shot list only (0 credits) — review before committing spend
python -m ugc_agent script --account ai-edu

# Dry run: full plan + credit estimate, no Higgsfield calls
python -m ugc_agent run --account ai-edu --dry-run

# Push the oldest reviewed item in the queue to platforms
python -m ugc_agent publish --account ai-edu
```

Outputs land in `data/<account>/runs/<timestamp>/` — keyframe candidates, judge
verdicts, clips, `final.mp4`, and `metadata.json` (title, caption, hashtags,
affiliate disclosure).

## Multi-account

One YAML per account in `config/accounts/`. Each account defines its niche, tone,
shot count, candidate count, model choices, budget caps, RSS sources, platforms,
and affiliate links. Add a second account by copying `ai-edu.yaml` and running
with `--account <name>`.

## Posting

`auto_post: false` (default) writes finished videos to a review queue
(`data/<account>/queue/`). Flip to `true` per platform once credentials are set:

- **YouTube Shorts** — implemented via the YouTube Data API. Put an OAuth client
  secret at `secrets/youtube_client_secret.json`; first run opens a browser to
  authorize (token cached at `secrets/youtube_token.json`).
- **TikTok** — Content Posting API requires an approved developer app; adapter is
  stubbed with the request shape ready (`src/ugc_agent/publish/tiktok.py`).
- **Instagram Reels** — Graph API requires a Business account + app review;
  adapter stubbed (`src/ugc_agent/publish/instagram.py`).

Until approvals land, the queue + a scheduler (Buffer/Later/Postiz) is the
practical path — the queue folder contains the video and ready-to-paste caption.

## Monetization playbook (ai-edu account)

1. **Affiliate first** (week 1+): every video covers a tool; `config/accounts/
   ai-edu.yaml → affiliate.links` maps tool names to your affiliate URLs. The
   scriptwriter automatically adds a CTA and the metadata includes the link +
   FTC disclosure.
2. **Inbound partnerships** (1–5k followers): consistent niche posting is the
   pitch. The account config's `partnership_pitch` text is kept in metadata so
   outreach DMs/emails stay consistent.
3. **Outbound UGC deals**: tech companies pay for exactly this format (faceless
   product explainers). Use published videos as the portfolio; pitch the
   companies whose tools you've already covered — they've seen the traffic.

## Repo map

```
config/accounts/ai-edu.yaml   account definition (niche, budget, models, links)
config/settings.yaml          global settings (copy from settings.example.yaml)
src/ugc_agent/pipeline.py     orchestrator
src/ugc_agent/research.py     RSS → Claude topic selection
src/ugc_agent/scripting.py    Claude script + shot list (structured output)
src/ugc_agent/higgsfield.py   Higgsfield API wrapper with budget guard
src/ugc_agent/judge.py        Claude vision: pick the better candidate, free
src/ugc_agent/assemble.py     ffmpeg assembly + metadata
src/ugc_agent/publish/        platform adapters + review queue
data/                         ledger, runs, queues (gitignored)
```
