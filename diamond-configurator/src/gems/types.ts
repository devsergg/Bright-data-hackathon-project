import type { BufferGeometry } from 'three';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type CutId =
  | 'round'
  | 'oval'
  | 'cushion'
  | 'princess'
  | 'radiant'
  | 'emerald'
  | 'asscher'
  | 'pear'
  | 'marquise'
  | 'heart';

/** Which generator builds the facet pattern. */
export type CutFamily = 'brilliant' | 'step';

/** Where a facet sits. Used for orientation, analysis and UI highlighting. */
export type FacetKind = 'table' | 'crown' | 'girdle' | 'pavilion';

export interface BrilliantProportions {
  /** Table width as % of girdle width. */
  tablePct: number;
  /** Bezel (crown main) angle in degrees, measured from the girdle plane. */
  crownAngle: number;
  /** Pavilion main angle in degrees, measured from the girdle plane. */
  pavilionAngle: number;
  /** Girdle thickness at the facet meetpoints, % of width. */
  girdlePct: number;
  /** Star facet length, % of the distance from table edge to girdle. */
  starPct: number;
  /** Lower girdle facet length, % of the distance from girdle to culet. */
  lowerHalfPct: number;
}

export interface StepProportions {
  tablePct: number;
  /** Mean crown step angle (deg). Steps get steeper toward the girdle. */
  crownAngle: number;
  /** Mean pavilion step angle (deg). */
  pavilionAngle: number;
  girdlePct: number;
  crownSteps: number;
  pavilionSteps: number;
  /** Difference between outermost and innermost step angle (deg). */
  stepSpread: number;
  /** Corner chamfer leg length as % of width. */
  cornerPct: number;
}

export type Proportions = BrilliantProportions | StepProportions;

export interface GemSpec {
  cut: CutId;
  carat: number;
  /** Length ÷ width. 1 for round/princess/asscher. */
  ratio: number;
  proportions: Proportions;
}

/** A planar (or near-planar) facet polygon, before triangulation. */
export interface FacetPolygon {
  name: string;
  kind: FacetKind;
  verts: Vec3[];
}

export interface GemMetrics {
  carat: number;
  /** Girdle width (mm) — the shorter outline dimension. */
  widthMm: number;
  /** Girdle length (mm). Equals width for round/square shapes. */
  lengthMm: number;
  /** Table to culet (mm). */
  depthMm: number;
  depthPct: number;
  tablePct: number;
  crownHeightPct: number;
  pavilionDepthPct: number;
  /** Thinnest girdle point, % of width. */
  girdleMinPct: number;
  volumeMm3: number;
  /** Facets excluding the girdle band. */
  facetCount: number;
  ratio: number;
}

export interface GemBuild {
  spec: GemSpec;
  /** Non-indexed, flat-shaded, millimetres, girdle plane at y = 0, table up (+Y), length along Z. */
  geometry: BufferGeometry;
  /** Facet polygons in millimetres (same frame as geometry). */
  facets: FacetPolygon[];
  metrics: GemMetrics;
  /** Girdle outline (top view, x/z in mm), CCW, used by settings (prongs, bezel, halo). */
  outline: Vec2[];
  girdleTopY: number;
  girdleBottomY: number;
  tableY: number;
  culetY: number;
}
