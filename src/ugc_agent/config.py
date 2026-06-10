from __future__ import annotations

import copy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"

DEFAULT_SETTINGS: dict[str, Any] = {
    "claude": {"model": "claude-opus-4-8"},
    "paths": {"data_dir": "data"},
    "credit_estimates": {
        "text_to_image": 2.0,
        "image_to_video_draft": 3.0,
        "image_to_video_final": 12.0,
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@dataclass
class Settings:
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def claude_model(self) -> str:
        return self.raw["claude"]["model"]

    @property
    def data_dir(self) -> Path:
        p = Path(self.raw["paths"]["data_dir"])
        return p if p.is_absolute() else REPO_ROOT / p

    def credit_estimate(self, kind: str) -> float:
        return float(self.raw["credit_estimates"][kind])


@dataclass
class Account:
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def name(self) -> str:
        return self.raw["account"]

    def __getitem__(self, key: str) -> Any:
        return self.raw[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.raw.get(key, default)


def load_settings() -> Settings:
    path = CONFIG_DIR / "settings.yaml"
    raw = {}
    if path.exists():
        raw = yaml.safe_load(path.read_text()) or {}
    return Settings(_deep_merge(DEFAULT_SETTINGS, raw))


def load_account(name: str) -> Account:
    path = CONFIG_DIR / "accounts" / f"{name}.yaml"
    if not path.exists():
        available = sorted(p.stem for p in (CONFIG_DIR / "accounts").glob("*.yaml"))
        raise FileNotFoundError(f"No account config {path}. Available: {available}")
    return Account(yaml.safe_load(path.read_text()))
