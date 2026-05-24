from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Event:
    id: str
    scraped_at: str
    # Core fields
    name: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    # Venue info
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    # Meta
    source_url: Optional[str] = None
    thumbnail: Optional[str] = None
    # Search context — which hotspot triggered this scrape
    hotspot_lat: Optional[float] = None
    hotspot_lon: Optional[float] = None
    neighborhood: Optional[str] = None
    # Raw response kept for field-name correction on first run
    raw_response: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k != "raw_response"}
