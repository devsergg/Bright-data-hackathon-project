/**
 * Step cuts (emerald, asscher): concentric rings of trapezoid facets.
 *
 * The girdle is a rectangle with 45° chamfered corners (half-width 1,
 * half-length = ratio, chamfer leg c). Each ring is that octagon inset by a
 * uniform perpendicular distance d, i.e. the region
 *     |x| ≤ 1 − d,   |z| ≤ ratio − d,   |x| + |z| ≤ (1 + ratio − c) − d·√2
 * Because every ring edge is parallel to the matching girdle edge, each facet
 * between two rings is an exact planar trapezoid. On the pavilion the inset runs
 * to the inradius, so a rectangle collapses into a keel line and a square into
 * a point — exactly like a real emerald / asscher.
 */
import { deg } from '../units';
import type { FacetPolygon, StepProportions, Vec3 } from './types';

const SQRT2 = Math.SQRT2;

/** Ring of 8 vertices (some may coincide) for inset d. Edge order: R, NE, T, NW, L, SW, B, SE. */
export function insetOctagon(ratio: number, c: number, d: number): [number, number][] {
  const xR = Math.max(0, 1 - d);
  const zT = Math.max(0, ratio - d);
  const K = Math.max(0, 1 + ratio - c - d * SQRT2);
  // quadrant vertex on the right edge, and on the top edge
  const x1 = Math.min(xR, K);
  const z1 = Math.min(zT, Math.max(0, K - x1));
  const z2 = Math.min(zT, K);
  const x2 = Math.min(xR, Math.max(0, K - z2));
  return [
    [x1, -z1],
    [x1, z1],
    [x2, z2],
    [-x2, z2],
    [-x1, z1],
    [-x1, -z1],
    [-x2, -z2],
    [x2, -z2],
  ];
}

/** Largest inset before the octagon collapses (its inradius). */
export function octagonInradius(ratio: number, c: number): number {
  return Math.min(1, ratio, (1 + ratio - c) / SQRT2);
}

const EDGE_NAMES = ['side', 'corner', 'end', 'corner', 'side', 'corner', 'end', 'corner'];

/** Linearly spread step angles: steepest at the girdle (i = 0). */
function stepAngles(mean: number, spread: number, n: number): number[] {
  if (n === 1) return [mean];
  return Array.from({ length: n }, (_, i) => mean + spread * (0.5 - i / (n - 1)));
}

export function buildStepCut(p: StepProportions, ratio: number): FacetPolygon[] {
  const c = (p.cornerPct / 100) * 2;
  const gTop = p.girdlePct / 100;
  const nc = Math.max(1, Math.round(p.crownSteps));
  const np = Math.max(1, Math.round(p.pavilionSteps));

  // crown rings: d from 0 to d_table, y rising
  const dTable = 1 - p.tablePct / 100;
  const crownA = stepAngles(p.crownAngle, p.stepSpread, nc);
  const crown: { d: number; y: number }[] = [{ d: 0, y: gTop }];
  for (let i = 0; i < nc; i++) {
    const d = (dTable * (i + 1)) / nc;
    const prev = crown[crown.length - 1];
    crown.push({ d, y: prev.y + (d - prev.d) * Math.tan(deg(crownA[i])) });
  }

  // pavilion rings: d from 0 to the inradius, y falling
  const dMax = octagonInradius(ratio, c);
  const pavA = stepAngles(p.pavilionAngle, p.stepSpread, np);
  const pav: { d: number; y: number }[] = [{ d: 0, y: -gTop }];
  for (let i = 0; i < np; i++) {
    const d = (dMax * (i + 1)) / np;
    const prev = pav[pav.length - 1];
    pav.push({ d, y: prev.y - (d - prev.d) * Math.tan(deg(pavA[i])) });
  }

  const ring = (d: number, y: number): Vec3[] =>
    insetOctagon(ratio, c, d).map(([x, z]) => [x, y, z] as Vec3);

  const facets: FacetPolygon[] = [];
  const bridge = (a: Vec3[], b: Vec3[], kind: FacetPolygon['kind'], label: string) => {
    for (let k = 0; k < 8; k++) {
      const kn = (k + 1) % 8;
      facets.push({ name: `${label} ${EDGE_NAMES[k]} ${k + 1}`, kind, verts: [a[k], a[kn], b[kn], b[k]] });
    }
  };

  const crownRings = crown.map((r) => ring(r.d, r.y));
  for (let i = 0; i < nc; i++) bridge(crownRings[i], crownRings[i + 1], 'crown', `crown step ${i + 1}`);
  facets.push({ name: 'table', kind: 'table', verts: crownRings[nc] });

  const pavRings = pav.map((r) => ring(r.d, r.y));
  for (let i = 0; i < np; i++) bridge(pavRings[i], pavRings[i + 1], 'pavilion', `pavilion step ${i + 1}`);
  // close the pavilion: the last ring is a keel line or a point; if the
  // inradius is bound by the corners it can still be a small octagon.
  facets.push({ name: 'keel', kind: 'pavilion', verts: pavRings[np].slice() });

  bridge(crownRings[0], pavRings[0], 'girdle', 'girdle');
  return facets;
}
