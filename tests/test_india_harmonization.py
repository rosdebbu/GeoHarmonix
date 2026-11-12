"""Test India Active Fire Harmonization and Mapping Pipeline."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import pandas as pd
from firms_ingestion import BBOX_INDIA

from harmonization.firms_harmonizer import FIRMSHarmonizer

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_CSV = ROOT / "data" / "samples" / "india_fire_sample.csv"
PROCESSED_DIR = ROOT / "data" / "processed"


class TestIndiaHarmonization(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(
            SAMPLE_CSV.is_file(), f"India sample CSV must exist at {SAMPLE_CSV}"
        )
        self.df = pd.read_csv(SAMPLE_CSV)
        self.harmonizer = FIRMSHarmonizer()

    def test_sample_csv_schema(self) -> None:
        expected_cols = {
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
        }
        self.assertTrue(expected_cols.issubset(set(self.df.columns)))
        self.assertGreater(len(self.df), 50)

    def test_detections_fall_within_india_bounding_boxes(self) -> None:
        w, s, e, n = (float(v) for v in BBOX_INDIA.split(","))
        for _, row in self.df.iterrows():
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            self.assertGreaterEqual(lon, w)
            self.assertLessEqual(lon, e)
            self.assertGreaterEqual(lat, s)
            self.assertLessEqual(lat, n)

    def test_harmonize_dataframe_produces_valid_detections(self) -> None:
        dets = self.harmonizer.harmonize_dataframe(self.df)
        self.assertEqual(len(dets), len(self.df))

        for d in dets:
            self.assertIsNotNone(d.h3_res7_cell)
            self.assertIsNotNone(d.h3_res8_cell)
            self.assertGreater(d.footprint.area_km2, 0.0)
            self.assertGreater(d.calibrated_viirs_eq_frp_mw, 0.0)
            self.assertIn(d.harmonized_daynight, ("D", "N"))

    def test_episode_deduplication_clusters_overpasses(self) -> None:
        dets = self.harmonizer.harmonize_dataframe(self.df)
        episodes = self.harmonizer.deduplicate_to_episodes(dets)

        # Deduplication should reduce or equal raw detection count
        self.assertLessEqual(len(episodes), len(dets))
        self.assertGreater(len(episodes), 0)

        # At least some multi-satellite coincident overpasses exist
        multi_platform = [ep for ep in episodes if ep.raw_detection_count > 1]
        self.assertGreater(len(multi_platform), 0)

        for ep in episodes:
            self.assertTrue(ep.episode_id.startswith("EP-"))
            self.assertGreater(ep.effective_observation_effort_omega, 0.0)
            self.assertGreater(ep.effort_normalized_episode_count, 0.0)

    def test_generated_geojson_and_html_validity(self) -> None:
        geojson_path = PROCESSED_DIR / "india_harmonized_episodes.geojson"
        html_path = PROCESSED_DIR / "india_fire_map.html"

        if geojson_path.exists():
            data = json.loads(geojson_path.read_text(encoding="utf-8"))
            self.assertEqual(data.get("type"), "FeatureCollection")
            self.assertIn("features", data)
            self.assertGreater(len(data["features"]), 0)

        if html_path.exists():
            html_text = html_path.read_text(encoding="utf-8")
            self.assertIn("GeoHarmonix", html_text)
            self.assertIn("India Sample", html_text)
            self.assertIn("leaflet", html_text.lower())


if __name__ == "__main__":
    unittest.main()
