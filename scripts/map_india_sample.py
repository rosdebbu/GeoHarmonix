"""GeoHarmonix — India Active Fire Sample Mapping & Harmonization Pipeline.

Harmonizes NASA FIRMS active fire detections for the Indian subcontinent (focusing
on the Northern agricultural burning corridor in Punjab & Haryana), applies sensor
geometry, Two-Stage FRP calibration, multi-satellite overpass deduplication, and
exports interactive GeoJSON and Leaflet HTML maps.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "harmonization-core" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "firms-ingestion" / "src"))
sys.path.insert(0, str(ROOT / "src"))

import h3
import pandas as pd

from harmonization.firms_harmonizer import FIRMSHarmonizer


def generate_geojson(
    episodes: list,
    raw_df: pd.DataFrame,
    include_h3_polygons: bool = True,
) -> dict:
    """Build GeoJSON FeatureCollection containing episodes, H3 cells, and raw points."""
    features = []

    # 1. Harmonized Episodes (Point features)
    for ep in episodes:
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [ep.centroid_lon, ep.centroid_lat],
                },
                "properties": {
                    "layer": "harmonized_episodes",
                    "episode_id": ep.episode_id,
                    "centroid_lat": ep.centroid_lat,
                    "centroid_lon": ep.centroid_lon,
                    "start_utc": ep.start_utc.isoformat(),
                    "end_utc": ep.end_utc.isoformat(),
                    "platforms": ep.contributing_platforms,
                    "platform_count": len(ep.contributing_platforms),
                    "raw_detection_count": ep.raw_detection_count,
                    "harmonized_frp_mw": round(ep.harmonized_frp_mw, 2),
                    "raw_sum_frp_mw": round(ep.raw_sum_frp_mw, 2),
                    "omega_effort": round(ep.effective_observation_effort_omega, 3),
                    "effort_normalized_count": round(
                        ep.effort_normalized_episode_count, 3
                    ),
                    "daynight": ep.harmonized_daynight,
                    "h3_res7": ep.h3_res7_cell,
                    "h3_res8": ep.h3_res8_cell,
                },
            }
        )

    # 2. H3 Resolution-7 Hexagons (Polygon features)
    if include_h3_polygons:
        h3_cells = {}
        for ep in episodes:
            cell = ep.h3_res7_cell
            if cell not in h3_cells:
                h3_cells[cell] = {
                    "episodes": 0,
                    "detections": 0,
                    "total_frp": 0.0,
                }
            h3_cells[cell]["episodes"] += 1
            h3_cells[cell]["detections"] += ep.raw_detection_count
            h3_cells[cell]["total_frp"] += ep.harmonized_frp_mw

        for cell_id, stats in h3_cells.items():
            boundary = h3.cell_to_boundary(cell_id)  # [(lat, lng), ...]
            # GeoJSON requires [lng, lat]
            coords = [[lng, lat] for lat, lng in boundary]
            if coords and coords[0] != coords[-1]:
                coords.append(coords[0])

            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords],
                    },
                    "properties": {
                        "layer": "h3_clusters",
                        "h3_index": cell_id,
                        "episode_count": stats["episodes"],
                        "raw_detections": stats["detections"],
                        "total_harmonized_frp_mw": round(stats["total_frp"], 2),
                    },
                }
            )

    return {
        "type": "FeatureCollection",
        "metadata": {
            "generator": "GeoHarmonix v2.0.4",
            "region": "India Subcontinent / Indo-Gangetic Agricultural Belt",
            "total_raw_detections": len(raw_df),
            "total_harmonized_episodes": len(episodes),
        },
        "features": features,
    }


def generate_interactive_html(
    episodes: list,
    raw_df: pd.DataFrame,
    output_html_path: Path,
) -> None:
    """Generate a self-contained, publication-grade interactive Leaflet HTML map."""
    raw_points = []
    for _, row in raw_df.iterrows():
        raw_points.append(
            {
                "lat": float(row["latitude"]),
                "lon": float(row["longitude"]),
                "frp": float(row.get("frp", 10.0)),
                "sat": str(row.get("satellite", "VIIRS")),
                "inst": str(row.get("instrument", "VIIRS")),
                "date": str(row.get("acq_date", "")),
                "time": str(row.get("acq_time", "")),
                "dn": str(row.get("daynight", "D")),
            }
        )

    ep_points = []
    for ep in episodes:
        ep_points.append(
            {
                "id": ep.episode_id,
                "lat": ep.centroid_lat,
                "lon": ep.centroid_lon,
                "start": ep.start_utc.strftime("%Y-%m-%d %H:%M UTC"),
                "end": ep.end_utc.strftime("%Y-%m-%d %H:%M UTC"),
                "sats": ", ".join(ep.contributing_platforms),
                "raw_count": ep.raw_detection_count,
                "raw_frp": round(ep.raw_sum_frp_mw, 1),
                "harm_frp": round(ep.harmonized_frp_mw, 1),
                "omega": round(ep.effective_observation_effort_omega, 3),
                "h3": ep.h3_res7_cell,
                "dn": ep.harmonized_daynight,
            }
        )

    # Collect H3 cells
    h3_polys = []
    h3_counts: dict[str, dict] = {}
    for ep in episodes:
        cell = ep.h3_res7_cell
        if cell not in h3_counts:
            h3_counts[cell] = {"episodes": 0, "frp": 0.0}
        h3_counts[cell]["episodes"] += 1
        h3_counts[cell]["frp"] += ep.harmonized_frp_mw

    for cell, data in h3_counts.items():
        boundary = h3.cell_to_boundary(cell)
        coords = [[lat, lng] for lat, lng in boundary]
        h3_polys.append(
            {
                "cell": cell,
                "coords": coords,
                "episodes": data["episodes"],
                "frp": round(data["frp"], 1),
            }
        )

    total_raw = len(raw_df)
    total_ep = len(episodes)
    multi_obs = sum(1 for ep in episodes if ep.raw_detection_count > 1)
    inflation_reduction = round((1 - (total_ep / max(total_raw, 1))) * 100, 1)
    raw_frp_sum = round(raw_df["frp"].sum(), 1)
    harm_frp_sum = round(sum(ep.harmonized_frp_mw for ep in episodes), 1)

    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GeoHarmonix — India Active Fire Map (Punjab/Haryana Crop Burning)</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body, html {{ height: 100%; width: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f17; color: #f1f5f9; }}
    #map {{ height: 100%; width: 100%; }}
    .hud {{
      position: absolute;
      top: 18px;
      left: 18px;
      z-index: 1000;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 18px 22px;
      max-width: 380px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
    }}
    .brand {{
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }}
    .brand-title {{
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }}
    .brand-title .geo {{ color: #f97316; }}
    .brand-title .harmonix {{ color: #38bdf8; }}
    .badge {{
      display: inline-block;
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 6px;
      background: rgba(249, 115, 22, 0.2);
      color: #fb923c;
      border: 1px solid rgba(249, 115, 22, 0.35);
    }}
    .subtitle {{
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.45;
      margin-bottom: 14px;
    }}
    .stats-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 14px;
    }}
    .stat-card {{
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 8px 10px;
    }}
    .stat-label {{
      font-size: 10px;
      text-transform: uppercase;
      color: #94a3b8;
      font-weight: 600;
    }}
    .stat-val {{
      font-size: 17px;
      font-weight: 700;
      color: #f8fafc;
      margin-top: 2px;
    }}
    .stat-val.highlight {{ color: #38bdf8; }}
    .stat-val.fire {{ color: #fb923c; }}
    .legend {{
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
      color: #cbd5e1;
    }}
    .legend-row {{
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 5px;
    }}
    .legend-dot {{
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }}
    .legend-poly {{
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1.5px solid #38bdf8;
      background: rgba(56, 189, 248, 0.2);
    }}
    .leaflet-popup-content-wrapper {{
      background: #0f172a !important;
      color: #f8fafc !important;
      border-radius: 10px !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      box-shadow: 0 12px 28px rgba(0,0,0,0.6) !important;
    }}
    .leaflet-popup-tip {{ background: #0f172a !important; }}
    .pop-title {{ font-weight: 700; color: #f97316; font-size: 13px; margin-bottom: 6px; }}
    .pop-row {{ font-size: 11px; margin-bottom: 3px; color: #cbd5e1; }}
    .pop-row strong {{ color: #f8fafc; }}
  </style>
</head>
<body>
  <div id="map"></div>

  <div class="hud">
    <div class="brand">
      <div class="brand-title"><span class="geo">Geo</span><span class="harmonix">Harmonix</span></div>
      <span class="badge">India Sample</span>
    </div>
    <div class="subtitle">
      NASA FIRMS Cross-Sensor Active Fire Harmonization & Multi-Satellite Deduplication across Punjab, Haryana & Indo-Gangetic Plains (Nov 2024).
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Raw FIRMS Detections</div>
        <div class="stat-val fire">{total_raw}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Harmonized Episodes</div>
        <div class="stat-val highlight">{total_ep}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Duplicate Suppression</div>
        <div class="stat-val">{inflation_reduction}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Multi-Sat Overpasses</div>
        <div class="stat-val highlight">{multi_obs}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Raw Sum FRP</div>
        <div class="stat-val">{raw_frp_sum} MW</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Calibrated FRP</div>
        <div class="stat-val highlight">{harm_frp_sum} MW</div>
      </div>
    </div>

    <div class="legend">
      <strong>Map Layers & Representation:</strong>
      <div class="legend-row">
        <div class="legend-dot" style="background: rgba(251, 146, 60, 0.4); border: 1px solid #fb923c;"></div>
        <span>Raw Overpass Observations (VIIRS / MODIS)</span>
      </div>
      <div class="legend-row">
        <div class="legend-dot" style="background: #ef4444; border: 2px solid #ffffff; box-shadow: 0 0 8px #ef4444;"></div>
        <span>Harmonized Physical Fire Episodes (Clustered & Deduplicated)</span>
      </div>
      <div class="legend-row">
        <div class="legend-poly"></div>
        <span>H3 Res-7 Spatial Clustered Hexagons</span>
      </div>
    </div>
  </div>

  <script>
    const rawData = {json.dumps(raw_points)};
    const epData = {json.dumps(ep_points)};
    const h3Data = {json.dumps(h3_polys)};

    // Center on Punjab/Haryana agricultural burning belt
    const map = L.map('map', {{
      center: [30.4, 75.9],
      zoom: 8,
      zoomControl: false
    }});
    L.control.zoom({{ position: 'bottomright' }}).addTo(map);

    // Dark Basemap
    const darkTiles = L.tileLayer('https://{{s}}.basemaps.cartocdn.com/dark_all/{{z}}/{{x}}/{{y}}{{r}}.png', {{
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }}).addTo(map);

    // Satellite Imagery Layer
    const satTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}', {{
      attribution: 'Tiles &copy; Esri',
      maxZoom: 18
    }});

    // Layer Groups
    const rawLayer = L.layerGroup();
    const epLayer = L.layerGroup();
    const h3Layer = L.layerGroup();

    // 1. Raw Detections
    rawData.forEach(pt => {{
      const radius = Math.min(Math.max(pt.frp / 6, 4), 12);
      const circle = L.circleMarker([pt.lat, pt.lon], {{
        radius: radius,
        fillColor: '#f97316',
        color: '#ffedd5',
        weight: 0.8,
        opacity: 0.8,
        fillOpacity: 0.35
      }});
      circle.bindPopup(`
        <div class="pop-title">Raw FIRMS Observation</div>
        <div class="pop-row"><strong>Coords:</strong> ${{pt.lat.toFixed(4)}}, ${{pt.lon.toFixed(4)}}</div>
        <div class="pop-row"><strong>Platform:</strong> ${{pt.sat}} (${{pt.inst}})</div>
        <div class="pop-row"><strong>Acq Time:</strong> ${{pt.date}} ${{pt.time}} (${{pt.dn}})</div>
        <div class="pop-row"><strong>Raw FRP:</strong> ${{pt.frp}} MW</div>
      `);
      rawLayer.addLayer(circle);
    }});

    // 2. Harmonized Episodes
    epData.forEach(ep => {{
      const radius = Math.min(Math.max(ep.harm_frp / 5, 6), 16);
      const isMulti = ep.raw_count > 1;
      const marker = L.circleMarker([ep.lat, ep.lon], {{
        radius: radius,
        fillColor: isMulti ? '#a855f7' : '#ef4444',
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.95,
        fillOpacity: 0.85
      }});
      marker.bindPopup(`
        <div class="pop-title">Harmonized Episode: ${{ep.id}}</div>
        <div class="pop-row"><strong>Centroid:</strong> ${{ep.lat.toFixed(4)}}, ${{ep.lon.toFixed(4)}}</div>
        <div class="pop-row"><strong>Window:</strong> ${{ep.start}} - ${{ep.end}}</div>
        <div class="pop-row"><strong>Contributing Satellites:</strong> ${{ep.sats}}</div>
        <div class="pop-row"><strong>Overpass Detections Merged:</strong> ${{ep.raw_count}}</div>
        <div class="pop-row"><strong>Harmonized FRP:</strong> ${{ep.harm_frp}} MW (Raw Sum: ${{ep.raw_frp}} MW)</div>
        <div class="pop-row"><strong>Effort Omega:</strong> ${{ep.omega}}</div>
        <div class="pop-row"><strong>H3 Res-7:</strong> ${{ep.h3}}</div>
      `);
      epLayer.addLayer(marker);
    }});

    // 3. H3 Hexagons
    h3Data.forEach(poly => {{
      const hex = L.polygon(poly.coords, {{
        color: '#38bdf8',
        weight: 1.2,
        fillColor: '#0284c7',
        fillOpacity: Math.min(poly.episodes * 0.08 + 0.1, 0.45)
      }});
      hex.bindPopup(`
        <div class="pop-title">H3 Cluster: ${{poly.cell}}</div>
        <div class="pop-row"><strong>Physical Episodes:</strong> ${{poly.episodes}}</div>
        <div class="pop-row"><strong>Total Harmonized FRP:</strong> ${{poly.frp}} MW</div>
      `);
      h3Layer.addLayer(hex);
    }});

    // Add all layers to map
    rawLayer.addTo(map);
    h3Layer.addTo(map);
    epLayer.addTo(map);

    // Layer control
    const baseMaps = {{
      "Dark Matter": darkTiles,
      "Satellite": satTiles
    }};
    const overlayMaps = {{
      "Harmonized Fire Episodes": epLayer,
      "H3 Res-7 Clusters": h3Layer,
      "Raw FIRMS Observations": rawLayer
    }};
    L.control.layers(baseMaps, overlayMaps, {{ position: 'topright' }}).addTo(map);
  </script>
</body>
</html>
"""

    output_html_path.parent.mkdir(parents=True, exist_ok=True)
    output_html_path.write_text(html_template, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="GeoHarmonix — Harmonize and map India active fire sample."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=ROOT / "data" / "samples" / "india_fire_sample.csv",
        help="Path to input raw FIRMS CSV file",
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        default=ROOT / "data" / "processed" / "india_harmonized_episodes.csv",
        help="Path to output harmonized episodes CSV",
    )
    parser.add_argument(
        "--output-geojson",
        type=Path,
        default=ROOT / "data" / "processed" / "india_harmonized_episodes.geojson",
        help="Path to output GeoJSON feature collection",
    )
    parser.add_argument(
        "--output-html",
        type=Path,
        default=ROOT / "data" / "processed" / "india_fire_map.html",
        help="Path to output interactive Leaflet HTML map",
    )

    args = parser.parse_args()

    print("===================================================================")
    print("      GeoHarmonix — Active Fire Harmonization & Mapping (India)    ")
    print("===================================================================")

    if not args.input.exists():
        print(f"Error: input file {args.input} does not exist.")
        sys.exit(1)

    print(f">> Loading raw FIRMS active fire detections: {args.input}")
    df = pd.read_csv(args.input)
    print(f"   Loaded {len(df)} raw fire detections.")

    print(">> Initializing FIRMSHarmonizer and cross-sensor calibration models...")
    harmonizer = FIRMSHarmonizer()

    print(">> Step 1: Harmonizing sensor geometry, SZA, and Two-Stage FRP...")
    harmonized_dets = harmonizer.harmonize_dataframe(df)
    print(f"   Harmonized {len(harmonized_dets)} detections.")

    print(
        ">> Step 2: Clustering multi-satellite overpasses into Fire Episodes (H3 + temporal window)..."
    )
    episodes = harmonizer.deduplicate_to_episodes(harmonized_dets)
    print(f"   Formed {len(episodes)} deduplicated physical Fire Episodes.")

    multi_obs = sum(1 for ep in episodes if ep.raw_detection_count > 1)
    suppression_pct = round((1 - (len(episodes) / max(len(df), 1))) * 100, 1)

    print("\n---------------- Harmonization Summary ----------------")
    print(f"  * Raw FIRMS Detections:           {len(df)}")
    print(f"  * Harmonized Physical Episodes:   {len(episodes)}")
    print(f"  * Multi-satellite Merged Fires:   {multi_obs}")
    print(f"  * Overpass Inflation Reduction:   {suppression_pct}%")
    print(f"  * Raw FRP Sum:                    {round(df['frp'].sum(), 1)} MW")
    print(
        f"  * Calibrated Harmonized FRP Sum:  {round(sum(ep.harmonized_frp_mw for ep in episodes), 1)} MW"
    )
    print("-------------------------------------------------------\n")

    # Export Tabular CSV
    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    summary_df = FIRMSHarmonizer.summarize_episodes_to_dataframe(episodes)
    summary_df.to_csv(args.output_csv, index=False)
    print(f">> Exported tabular summary: {args.output_csv}")

    # Export GeoJSON
    args.output_geojson.parent.mkdir(parents=True, exist_ok=True)
    geojson_data = generate_geojson(episodes, df)
    args.output_geojson.write_text(
        json.dumps(geojson_data, indent=2), encoding="utf-8"
    )
    print(f">> Exported GeoJSON features: {args.output_geojson}")

    # Export Interactive HTML Map
    args.output_html.parent.mkdir(parents=True, exist_ok=True)
    generate_interactive_html(episodes, df, args.output_html)
    print(f">> Exported interactive Leaflet HTML map: {args.output_html}")
    print("\nMapping complete! You can open the HTML map in your browser:")
    print(f"  file:///{args.output_html.resolve().as_posix()}")


if __name__ == "__main__":
    main()
