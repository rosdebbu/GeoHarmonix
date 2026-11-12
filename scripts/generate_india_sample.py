"""Generate realistic NASA FIRMS active fire sample data for the Indian Subcontinent.

Focuses on the Northern India agricultural burning belt (Punjab, Haryana, NCR, Western UP)
during the peak post-monsoon Kharif paddy stubble burning season (November 2024).
"""

from __future__ import annotations

import csv
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_FILE = ROOT / "data" / "samples" / "india_fire_sample.csv"

# Real agricultural burning clusters in Punjab & Haryana
HOTSPOT_CENTROIDS = [
    {"name": "Sangrur", "lat": 30.24, "lon": 75.84, "intensity": 1.4, "radius_deg": 0.28},
    {"name": "Ludhiana", "lat": 30.90, "lon": 75.85, "intensity": 1.3, "radius_deg": 0.25},
    {"name": "Tarn Taran", "lat": 31.45, "lon": 74.92, "intensity": 1.2, "radius_deg": 0.22},
    {"name": "Firozpur", "lat": 30.92, "lon": 74.61, "intensity": 1.1, "radius_deg": 0.26},
    {"name": "Patiala", "lat": 30.34, "lon": 76.38, "intensity": 1.2, "radius_deg": 0.24},
    {"name": "Bathinda", "lat": 30.21, "lon": 74.95, "intensity": 1.1, "radius_deg": 0.25},
    {"name": "Amritsar", "lat": 31.63, "lon": 74.87, "intensity": 1.0, "radius_deg": 0.20},
    {"name": "Kaithal", "lat": 29.80, "lon": 76.40, "intensity": 0.9, "radius_deg": 0.22},
    {"name": "Karnal", "lat": 29.68, "lon": 76.98, "intensity": 0.8, "radius_deg": 0.20},
    {"name": "Fatehabad", "lat": 29.51, "lon": 75.45, "intensity": 0.8, "radius_deg": 0.22},
    {"name": "Meerut-W.UP", "lat": 29.02, "lon": 77.71, "intensity": 0.7, "radius_deg": 0.25},
    {"name": "Central-MP", "lat": 23.25, "lon": 77.41, "intensity": 0.5, "radius_deg": 0.35},
]

DATES = [
    "2024-11-05",
    "2024-11-06",
    "2024-11-07",
    "2024-11-08",
    "2024-11-09",
]

# Daytime overpasses (UTC): ~07:30 - 08:50 (13:00 - 14:20 IST)
# Night overpasses (UTC): ~19:40 - 20:30 (01:10 - 02:00 IST)
OVERPASS_SCHEDULE = [
    {"sat": "N", "inst": "VIIRS", "time": "0745", "daynight": "D"},
    {"sat": "1", "inst": "VIIRS", "time": "0835", "daynight": "D"},  # NOAA-20 ~50 min after SNPP
    {"sat": "2", "inst": "VIIRS", "time": "0810", "daynight": "D"},  # NOAA-21
    {"sat": "A", "inst": "MODIS", "time": "0820", "daynight": "D"},  # Aqua afternoon overpass
    {"sat": "N", "inst": "VIIRS", "time": "1955", "daynight": "N"},
    {"sat": "1", "inst": "VIIRS", "time": "2045", "daynight": "N"},
]


def generate_samples(count_target: int = 420) -> list[dict[str, object]]:
    rng = random.Random(20261112)  # noqa: S311
    rows: list[dict[str, object]] = []

    for date in DATES:
        for overpass in OVERPASS_SCHEDULE:
            sat = overpass["sat"]
            inst = overpass["inst"]
            time_str = overpass["time"]
            dn = overpass["daynight"]

            # Number of fires detected in this overpass
            n_fires = rng.randint(8, 22) if dn == "D" else rng.randint(2, 6)

            for _ in range(n_fires):
                cluster = rng.choice(HOTSPOT_CENTROIDS)
                # Gaussian scatter around cluster centroid
                r_offset = rng.gauss(0, cluster["radius_deg"] * 0.5)
                theta = rng.uniform(0, 2 * math.pi)
                lat = round(cluster["lat"] + r_offset * math.cos(theta), 5)
                lon = round(cluster["lon"] + r_offset * math.sin(theta), 5)

                # Scan and track depending on sensor and view angle
                if inst == "VIIRS":
                    scan = round(rng.uniform(0.38, 0.78), 2)
                    track = round(rng.uniform(0.38, 0.78), 2)
                    bt4 = round(rng.uniform(322.0, 372.0) * (1.02 if dn == "D" else 0.98), 2)
                    bt5 = round(rng.uniform(286.0, 302.0), 2)
                    frp = round(rng.uniform(3.5, 48.0) * cluster["intensity"], 2)
                    conf = rng.choice(["nominal", "nominal", "high", "high", "low"])
                    version = "2.0NRT"
                else:  # MODIS
                    scan = round(rng.uniform(1.0, 2.2), 2)
                    track = round(rng.uniform(1.0, 1.6), 2)
                    bt4 = round(rng.uniform(315.0, 355.0), 2)
                    bt5 = round(rng.uniform(288.0, 300.0), 2)
                    frp = round(rng.uniform(8.0, 65.0) * cluster["intensity"], 2)
                    conf = rng.randint(60, 99)
                    version = "6.1NRT"

                rows.append(
                    {
                        "latitude": lat,
                        "longitude": lon,
                        "bright_ti4": bt4,
                        "scan": scan,
                        "track": track,
                        "acq_date": date,
                        "acq_time": time_str,
                        "satellite": sat,
                        "instrument": inst,
                        "confidence": conf,
                        "version": version,
                        "bright_ti5": bt5,
                        "frp": frp,
                        "daynight": dn,
                    }
                )

    return rows


def main() -> None:
    records = generate_samples(420)
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "latitude",
        "longitude",
        "bright_ti4",
        "scan",
        "track",
        "acq_date",
        "acq_time",
        "satellite",
        "instrument",
        "confidence",
        "version",
        "bright_ti5",
        "frp",
        "daynight",
    ]

    with open(OUTPUT_FILE, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)

    print(f"Successfully generated {len(records)} India active fire records in {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
