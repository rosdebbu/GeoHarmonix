import type { RegionId } from '@/lib/calendar/types';

export type AnnualSeries = {
  years: number[];
  raw: number[];
  harmonized: number[];
  measured: number[];
  /** Raw growth between two Measured Epochs, in percent. */
  rawGrowthPct: number;
  /** The two Measured Epochs `rawGrowthPct` is read between. */
  growthWindow: readonly [from: number, to: number];
  trendPct: number;
};

export type Epoch = {
  year: number;
  date: string | null;
  raw: number;
  episodes: number | null;
  harmonized: number;
  sensors: number;
  saa: number;
  szaPct: number;
};

export type MapPhysics = {
  modisNadir: number;
  modisEdge: number;
  viirsNadir: number;
  viirsEdge: number;
  ratio: number;
};

export type MapFilters = {
  sza: boolean;
  saa: boolean;
  static: boolean;
  dedup: boolean;
};

export type MapLayers = {
  footprints: boolean;
  hex: boolean;
  overlay: boolean;
  /** Colour the dots by fire power instead of by sensor. */
  power: boolean;
};

export type Calibration = {
  r2Raw: number;
  r2Harmonized: number;
  rmseRaw: number;
  rmseHarmonized: number;
  ksBefore: number;
  ksAfter: number;
  pairs: number;
  /** The held-out check: RMSE gain in MW on years after `trainLastYear`, with its 95% interval. */
  holdout: {
    gainMw: number;
    ciLowMw: number;
    ciHighMw: number;
    trainLastYear: number;
  };
};

export type SfaiPeak = {
  value: number | null;
  pentad: number | null;
};

/** One measured epoch, split by sensor family. */
export type LabEpoch = {
  year: number;
  modis: number;
  viirs: number;
  /** Detections rejected as South Atlantic Anomaly noise. */
  saa: number;
  /** Share of detections whose day/night class changed once the sun angle was applied, percent. */
  szaPct: number;
};

/** The omission-factor fit: trained on some years, checked on later ones (1 = the views agree). */
export type Omission = {
  kFit: number;
  trainYears: number[];
  before: Record<string, number>;
  after: Record<string, number>;
};

export type SensorLabData = { epochs: LabEpoch[]; omission: Omission | null };

export type WorkbenchData = {
  lab: Record<RegionId, SensorLabData>;
  series: Record<RegionId, AnnualSeries>;
  epochs: Record<RegionId, Epoch[]>;
  sfai: Record<RegionId, Record<number, SfaiPeak>>;
  physics: MapPhysics;
  calibration: Calibration;
};
