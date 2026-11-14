"""Build the South Asia region (id ``india``: India, Bangladesh, Myanmar) from real FIRMS slices.

Runs the same harmonization as Mekong and Amazon on ``data/raw/india__*`` and merges the
result into ``empirical_results.json`` and ``burning_calendar.json``. The Mekong and Amazon
entries are left as they are. Requires the slices from ``benchmark_cli.fetch_real_firms``.

    uv run python scripts/build_south_asia.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for sub in ("apps/benchmark-cli/src", "packages/firms-ingestion/src", "packages/harmonization-core/src"):
    sys.path.insert(0, str(ROOT / sub))

from benchmark_cli import fetch_cloud_cover as cc  # noqa: E402
from benchmark_cli import run_experiments as rx  # noqa: E402
from benchmark_cli.epoch_plan import build_epoch_plan  # noqa: E402
from benchmark_cli.sensitivity import (  # noqa: E402
    FIT_TRAIN_LAST_YEAR,
    SUBPIXEL_OMISSION_FACTOR,
    fit_omission_factor,
)

REGION = "india"
RESULTS = ROOT / "data" / "processed" / "empirical_results.json"
CALENDAR = ROOT / "data" / "processed" / "burning_calendar.json"


def ensure_cloud_cover(windows: list[str]) -> None:
    """Add ERA5 cloud cover for any India window missing from the pinned table."""
    table = json.loads(cc.OUT.read_text())
    have = table["regions"].setdefault(REGION, {})
    for window in windows:
        if window not in have:
            have[window] = round(cc.fetch_window(REGION, window), 4)
            print("cloud", window, have[window], file=sys.stderr)
    cc.OUT.write_text(json.dumps(table, indent=2) + "\n")


def main() -> None:
    plan = build_epoch_plan(REGION, rx.RAW_DIR, rx.CURRENT_YEAR)
    print(f"{len(plan)} Measured Epochs: {plan[0][0]} .. {plan[-1][0]}")
    ensure_cloud_cover([d for d, _ in plan])

    cal_model, _ = rx.run_coincident_overpass_calibration()
    static = rx.load_static_source_registry(REGION)
    cloud = rx.load_cloud_clear_sky(REGION)
    print(f"static source registry: {len(static)} cells")

    def evaluate() -> list[dict]:
        return [
            rx.evaluate_epoch_slice(
                REGION, d, s, cal_model, static_cells=static, cloud_clear=cloud.get(d)
            )
            for d, s in plan
        ]

    # The omission factor is fitted, as for Mekong and Amazon: the factor that makes the
    # MODIS-only and multi-sensor views of one epoch agree (median over epochs <= 2020).
    SUBPIXEL_OMISSION_FACTOR[REGION] = 1.0
    k_fit = round(fit_omission_factor(evaluate(), 1.0, FIT_TRAIN_LAST_YEAR)["k_fit"], 2)
    SUBPIXEL_OMISSION_FACTOR[REGION] = k_fit
    epochs = evaluate()
    fit = fit_omission_factor(epochs, k_fit, FIT_TRAIN_LAST_YEAR, 1.0)
    print(f"fitted omission factor k = {k_fit}")

    results = json.loads(RESULTS.read_text(encoding="utf-8"))
    series, cal = rx.build_26yr_calendars_and_series(
        results["mekong_empirical_epochs"], results["amazon_empirical_epochs"], epochs
    )

    results["india_empirical_epochs"] = epochs
    results["omission_factor_fit"][REGION] = fit
    results["regime_shift_series"][REGION] = series[REGION]
    RESULTS.write_text(json.dumps(results, indent=2), encoding="utf-8")

    calendar = json.loads(CALENDAR.read_text(encoding="utf-8"))
    calendar[REGION] = cal[REGION]
    CALENDAR.write_text(json.dumps(calendar, separators=(",", ":")), encoding="utf-8")
    print(cal[REGION]["summary_caption"])


if __name__ == "__main__":
    main()
