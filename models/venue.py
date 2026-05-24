from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class VenueTelemetry:
    id: str
    scraped_at: str
    name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    live_occupancy: Optional[int] = None
    popular_times: Optional[Any] = None
    current_status: Optional[str] = None
    address: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    lit_score: Optional[int] = None
    is_lit: bool = False
    raw_response: dict = field(default_factory=dict)
