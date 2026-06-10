from __future__ import annotations

import json
from datetime import date
from pathlib import Path


class BudgetExceeded(RuntimeError):
    pass


class Ledger:
    """Credit spend ledger with per-run and per-day caps.

    Estimates are recorded at call time (Higgsfield doesn't return actuals in
    every response), so caps are conservative by design.
    """

    def __init__(self, path: Path, max_per_run: float, max_per_day: float):
        self.path = path
        self.max_per_run = max_per_run
        self.max_per_day = max_per_day
        self.run_spent = 0.0
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._data = self._load()

    def _load(self) -> dict:
        if self.path.exists():
            return json.loads(self.path.read_text())
        return {"days": {}, "entries": []}

    def _save(self) -> None:
        self.path.write_text(json.dumps(self._data, indent=2))

    @property
    def day_spent(self) -> float:
        return float(self._data["days"].get(date.today().isoformat(), 0.0))

    def check(self, estimate: float, label: str) -> None:
        """Raise BudgetExceeded if spending `estimate` would break a cap."""
        if self.run_spent + estimate > self.max_per_run:
            raise BudgetExceeded(
                f"{label}: {estimate:.1f} cr would take this run to "
                f"{self.run_spent + estimate:.1f} (cap {self.max_per_run})"
            )
        if self.day_spent + estimate > self.max_per_day:
            raise BudgetExceeded(
                f"{label}: {estimate:.1f} cr would take today to "
                f"{self.day_spent + estimate:.1f} (cap {self.max_per_day})"
            )

    def record(self, amount: float, label: str) -> None:
        self.run_spent += amount
        today = date.today().isoformat()
        self._data["days"][today] = self._data["days"].get(today, 0.0) + amount
        self._data["entries"].append({"day": today, "label": label, "credits": amount})
        self._save()

    def summary(self) -> str:
        return (
            f"credits spent — this run: {self.run_spent:.1f}/{self.max_per_run}, "
            f"today: {self.day_spent:.1f}/{self.max_per_day}"
        )
