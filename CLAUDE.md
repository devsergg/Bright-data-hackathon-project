# CLAUDE.md — operating manual for agents working in this repo

This repo is an autonomous faceless-UGC video system. When operating it (generating
content, extending it, or running the pipeline), follow these rules.

## Credit discipline (non-negotiable)

Higgsfield credits are real money. Before ANY image or video generation call —
whether through the `higgsfield` skill/MCP or the pipeline code:

1. Quote: model + settings, estimated credit cost, current balance, balance after.
2. Never exceed the account's `budget.max_credits_per_run` /
   `max_credits_per_day` (see `config/accounts/<account>.yaml` and
   `data/ledger.json`).
3. Cheap-first ordering: text-to-image candidates → free Claude-vision judging →
   image-to-video on winners only, at draft settings (lowest resolution, 3-5 s).
   High-quality re-renders only when `quality.final_upgrade: true`.
4. Always pass an explicit duration to video models — omitting it can default to
   12 s and ~3x the cost.

## Interactive generation

Use the installed `higgsfield` skill (backed by the Higgsfield MCP at
`https://mcp.higgsfield.ai/mcp`). Verify exact model ids with the MCP's
model-listing tool before submitting; the ids in account YAMLs are defaults and
may need updating as Higgsfield's catalog evolves.

## Pipeline

`python -m ugc_agent run --account ai-edu` runs research → script → candidates →
judge → animate → assemble → queue. Use `--dry-run` to see the plan and credit
estimate without spending. Per-run artifacts go to `data/<account>/runs/<ts>/`.

## Content standards (ai-edu account)

- Educational, specific, demo-oriented. One tool or release per video.
- Always include the FTC affiliate disclosure from the account config when an
  affiliate link is used.
- No fabricated claims about tools; the script must stay within what the source
  article states.

## Code conventions

- Python 3.10+, no framework. Claude calls use the `anthropic` SDK with
  `claude-opus-4-8`, adaptive thinking, and `messages.parse` + Pydantic for
  structured outputs.
- All Higgsfield calls go through `src/ugc_agent/higgsfield.py` so the budget
  ledger sees them. Never call `higgsfield_client` directly from other modules.
- Account-specific anything lives in `config/accounts/*.yaml`, never in code.
