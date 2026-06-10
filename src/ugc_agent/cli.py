from __future__ import annotations

import argparse

from . import pipeline, research, scripting
from .config import load_account, load_settings
from .publish.base import list_queue


def main() -> None:
    parser = argparse.ArgumentParser(prog="ugc_agent", description="Faceless UGC video pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    for name, help_text in [
        ("run", "full pipeline: research -> script -> generate -> assemble -> queue"),
        ("topics", "list fresh candidate topics (free)"),
        ("script", "research + script only, no generation (free)"),
        ("publish", "post the oldest queue item to configured platforms"),
        ("queue", "list pending queue items"),
    ]:
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--account", required=True, help="account name in config/accounts/")
        if name == "run":
            p.add_argument("--dry-run", action="store_true", help="plan + cost estimate, no Higgsfield calls")

    args = parser.parse_args()
    settings = load_settings()
    account = load_account(args.account)

    if args.command == "run":
        pipeline.run(settings, account, dry_run=args.dry_run)

    elif args.command == "topics":
        for item in research.fetch_items(account):
            print(f"- {item['title']}\n  {item['link']}")

    elif args.command == "script":
        items = research.fetch_items(account)
        covered = research.load_covered(account, settings.data_dir)
        topic = research.pick_topic(settings, account, items, covered)
        script = scripting.write_script(settings, account, topic)
        print(script.model_dump_json(indent=2))

    elif args.command == "queue":
        items = list_queue(settings.data_dir, args.account)
        if not items:
            print("queue empty")
        for item in items:
            print(item)

    elif args.command == "publish":
        items = list_queue(settings.data_dir, args.account)
        if not items:
            raise SystemExit("queue empty — run the pipeline first")
        pipeline.publish_item(account, items[0])


if __name__ == "__main__":
    main()
