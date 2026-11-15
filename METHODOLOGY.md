# GeoHarmonix: Methodology

How GeoHarmonix turns NASA FIRMS fire detections from two satellite families into one record that can be compared across 26 years, and what it does **not** claim.

The full equations and code references are in [`docs/02_Cross_Sensor_Harmonization_Spec.md`](docs/02_Cross_Sensor_Harmonization_Spec.md). The code is in [`packages/harmonization-core`](packages/harmonization-core). This page is the short version.

## 1. The problem

NASA FIRMS publishes active-fire detections from two sensor families:

| Family | Satellites | Pixel size | In service |
|---|---|---|---|
| MODIS | Terra, Aqua | 1 km at nadir, up to 9.69 km² at the swath edge | 2000 onwards |
| VIIRS 375 m | Suomi-NPP, NOAA-20, NOAA-21 | 0.13 km² at nadir | 2012 onwards |

A MODIS pixel at the swath edge is about **74 times** larger than a VIIRS pixel at nadir. VIIRS therefore sees much smaller fires, and every time a new satellite joins, raw counts jump. In the Mekong region the raw index rises **+1,311%** in 2024 against 2005, and in the Amazon **+714%**. Most of that is a change of sensors, not a change in fire.

## 2. The pipeline

Each step is a pure function in `harmonization-core` with tests.

1. **Footprint reconstruction.** The real pixel size is rebuilt from the scan angle (MODIS bow-tie growth, VIIRS three-zone aggregation), so a large edge pixel is not treated like a small nadir pixel.
2. **H3 allocation.** Each footprint is spread over Uber H3 hexagons (resolution 7 and 8) with weights that sum to 1, so a detection's energy is conserved.
3. **Day and night.** Day or night is recomputed from the solar zenith angle (day when the angle is below 85°), because near-real-time VIIRS data labels it by orbit direction instead.
4. **Noise removal.** South Atlantic Anomaly spikes (night pulses with no background heating) are rejected, and static heat sources are filtered. MODIS 0–100 confidence and VIIRS low/nominal/high are mapped to one probability of fire.
5. **Fire-power calibration, two stages.** A scan-angle correction, then a blend of a power-law fit and empirical quantile mapping, fitted on **20,786 coincident Aqua and Suomi-NPP cell pairs**.
6. **Fire episodes.** Detections of the same fire seen by several satellites within 60 minutes and a footprint-sized distance are merged into one episode.
7. **Observation effort.** Counts are divided by an effort factor Ω that grows as satellites are added (about 0.5 in 2000, 1.0 for Terra plus Aqua, about 2.1 from 2024), so more satellites do not look like more fire.
8. **Calendar.** The result is a 26-year by 73-pentad (5-day) Burning Activity Calendar with three indices: fire density (HFD), radiative flux (HRF) and a standardized anomaly index (SFAI, a robust z-score that needs at least 8 observed years).

## 3. Results

Measured on 3.3 million real FIRMS detections, using the coincident-pair set:

| Measure | Before | After |
|---|---|---|
| Distribution distance between sensors (KS) | 0.1153 | **0.0353** (−69.4%) |
| Fire-power agreement (R², log scale) | 0.7839 | **0.8048** |
| Fire-power error (RMSE, MW per cell) | 141.1 | 134.1 |
| Mean count ratio VIIRS / MODIS | 3.67× | 1.00× |

The Mekong 2024 step shrinks from an index of 1,411 to 90.5, and the Amazon from 814 to 37.7 (2005 = 100).

## 4. Limits

These are in the project on purpose, and the dashboard repeats them.

- **No reliable fire-power gain is shown.** The table above is in-sample. Fitted on pairs through 2019 and tested on 2020, the RMSE falls from 155.9 to 155.2 MW, and the 95% interval of that change (−6.0 to +7.3 MW) **includes zero**. We do not claim a fire-power improvement.
- **This is an empirical adjustment, not a physical calibration.** It does not count unique fires and does not measure burned area. Differences in sensitivity, overpass schedule and archive completeness remain.
- **Only one 5-day window per year is measured.** In the calendar, other windows are modelled from the seasonal shape or interpolated, and are marked as such. Monthly charts are therefore mostly modelled.
- **State and country numbers are map samples.** The state search and Regional Fire Intelligence count the detections in the map's sample for that year's measured window, not every detection.
- **Cloud weighting is a model.** ERA5 cloud cover is a reanalysis field, not an observation at the overpass time, and the linear weighting is an assumption.
- **The live view is simplified.** The live NASA panel shows only the last days of FIRMS data. Satellite positions use a two-body orbit with J2 drift from public orbital elements, accurate to a few kilometres near the element's date, which is enough to show passes but not for navigation.
- **Boundaries.** The India map uses the official boundary of Kashmir; base layers come from Natural Earth.

## 5. Data and sources

- **NASA FIRMS** (MODIS C6.1 and VIIRS 375 m C2): fire detections. <https://firms.modaps.eosdis.nasa.gov/>
- **NASA GIBS**: satellite imagery for the map. <https://www.earthdata.nasa.gov/data/tools/gibs>
- **CelesTrak**: public orbital elements for the live satellite positions. <https://celestrak.org/>
- **Natural Earth**: boundaries and relief. <https://www.naturalearthdata.com/>
- **Key references:** Giglio, Schroeder and Justice (2016), *The collection 6 MODIS active fire detection algorithm and fire products*, Remote Sensing of Environment 178; Schroeder et al. (2014), *The New VIIRS 375 m active fire detection data product*, Remote Sensing of Environment 143. The spec lists all references.

## 6. Reproduce it

```bash
uv sync --group dev
uv run python -m pytest
uv run python -m benchmark_cli.run_experiments
```

Set `FIRMS_MAP_KEY` (a free NASA FIRMS key) in `.env` to fetch fresh data. The key is never committed.

## 7. AI assistance

An AI coding assistant (Claude, by Anthropic) helped write the dashboard code, Hindi translations, text and demo deck. The scientific method and results come from the team's analysis of NASA FIRMS data.
