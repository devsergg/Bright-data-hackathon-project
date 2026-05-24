from dataclasses import dataclass


@dataclass
class Hotspot:
    cluster_id: int
    lat: float
    lon: float
    density_weight: int  # number of macro-net points in this cluster

    def to_dict(self) -> dict:
        return {
            "cluster_id": self.cluster_id,
            "lat": self.lat,
            "lon": self.lon,
            "density_weight": self.density_weight,
        }
