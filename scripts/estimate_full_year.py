"""Estimate what measuring all 73 pentads (full year) would cost, from the data we already hold.

Per region it compares the rows in the single window we measure with the average 5-day window
across the 12 monthly VIIRS-SNPP slices of 2024, scales to 73 windows, and sums. Rough on purpose:
it shows the order of magnitude (requests, rows, GB), not an exact bill.

    uv run python scripts/estimate_full_year.py
"""

from __future__ import annotations

import glob
import os
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
REGIONS = ("mekong", "amazon", "india", "maritime")


def rows(path: str) -> int:
    with open(path, encoding="utf-8") as f:
        return sum(1 for _ in f) - 1


def main() -> None:
    now_rows = now_mb = now_req = full_rows = full_mb = 0.0
    for region in REGIONS:
        main_files = glob.glob(str(RAW / f"{region}__*.csv"))
        n_rows = sum(rows(f) for f in main_files)
        mb = sum(os.path.getsize(f) for f in main_files) / 1e6
        season = glob.glob(str(RAW / f"{region}_season__VIIRS_SNPP_SP__2024-*.csv"))
        window24 = [f for f in main_files if "VIIRS_SNPP_SP__2024-" in f]
        sampled = season + window24
        avg = sum(rows(f) for f in sampled) / max(1, len(sampled))
        ratio = avg * 73 / max(1, sum(rows(f) for f in window24))
        print(f"{region:9} now {n_rows:>10,.0f} rows {mb:6.0f} MB | full year is about x{ratio:.0f}")
        now_rows += n_rows
        now_mb += mb
        now_req += len(main_files)
        full_rows += n_rows * ratio
        full_mb += mb * ratio
    print(f"\nNOW : {now_req:.0f} requests, {now_rows / 1e6:.1f} M rows, {now_mb:.0f} MB")
    print(f"FULL: ~{now_req * 73:.0f} requests, ~{full_rows / 1e6:.0f} M rows, ~{full_mb / 1000:.0f} GB")
    print(f"Processing at ~1,000 rows/s (measured on India 2021/2024): ~{full_rows / 1000 / 3600:.0f} hours")


if __name__ == "__main__":
    main()
