/**
 * buildGem(spec) → millimetre-scale geometry + measured metrics.
 *
 * The facet pattern is generated at width 2 (canonical units), its volume is
 * integrated exactly from the closed mesh, and the whole stone is scaled
 * uniformly so its mass equals the requested carat weight
 * (volume × 3.52 mg/mm³ ÷ 200 mg/ct). No lookup tables — a deeper or spread
 * cut naturally changes the face-up size for the same carat, as in reality.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { caratsFromVolume, volumeFromCarats } from '../units';
import { buildBrilliant } from './brilliant';
import { CUTS, isStep } from './catalog';
import { makeOutline } from './outlines';
import { buildStepCut } from './stepcut';
import type { FacetPolygon, GemBuild, GemSpec, Vec2, Vec3 } from './types';

export function buildGem(spec: GemSpec): GemBuild {
  const info = CUTS[spec.cut];
  const ratio = info.ratioRange[0] === info.ratioRange[1] ? info.ratio : spec.ratio;
  const p = spec.proportions;

  let facets: FacetPolygon[];
  let outlinePts: Vec2[];
  if (isStep(p)) {
    facets = buildStepCut(p, ratio);
    outlinePts = makeOutline(spec.cut, ratio, p.cornerPct).polyline();
  } else {
    const outline = makeOutline(spec.cut, ratio);
    facets = buildBrilliant(p, outline, {
      girdleSubdiv: info.girdleSubdiv,
      planarMap: spec.cut === 'round' || spec.cut === 'oval',
    });
    outlinePts = outline.polyline(256);
  }

  orientFacets(facets);
  const tris = triangulate(facets);
  const unitVolume = meshVolume(tris.positions);
  const scale = Math.cbrt(volumeFromCarats(spec.carat) / unitVolume);

  const scaled = facets.map((f) => ({ ...f, verts: f.verts.map((v) => mul(v, scale)) }));
  const positions = tris.positions.map((v) => v * scale);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('facetId', new BufferAttribute(new Uint16Array(tris.facetIds), 1));
  geometry.computeVertexNormals(); // non-indexed ⇒ flat per-triangle normals
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // metrics
  const ys = facets.flatMap((f) => f.verts.map((v) => v[1]));
  const tableY = Math.max(...ys);
  const culetY = Math.min(...ys);
  const girdle = facets.filter((f) => f.kind === 'girdle');
  const gTops = girdle.flatMap((f) => f.verts.filter((v) => v[1] >= 0).map((v) => v[1]));
  const gBots = girdle.flatMap((f) => f.verts.filter((v) => v[1] < 0).map((v) => v[1]));
  const girdleTopY = Math.max(...gTops);
  const girdleBottomY = Math.min(...gBots);
  const girdleMin = minGirdleThickness(girdle);

  const xs = outlinePts.map((q) => q[0]);
  const zs = outlinePts.map((q) => q[1]);
  const width = (Math.max(...xs) - Math.min(...xs)) * scale;
  const length = (Math.max(...zs) - Math.min(...zs)) * scale;
  const depth = (tableY - culetY) * scale;
  const W = 2; // canonical width
  const metrics = {
    carat: caratsFromVolume(unitVolume * scale ** 3),
    widthMm: width,
    lengthMm: length,
    depthMm: depth,
    depthPct: ((tableY - culetY) / W) * 100,
    tablePct: p.tablePct,
    crownHeightPct: ((tableY - girdleTopY) / W) * 100,
    pavilionDepthPct: ((girdleBottomY - culetY) / W) * 100,
    girdleMinPct: (girdleMin / W) * 100,
    volumeMm3: unitVolume * scale ** 3,
    facetCount: countFacets(facets),
    ratio: length / width,
  };

  return {
    spec,
    geometry,
    facets: scaled,
    metrics,
    outline: outlinePts.map(([x, z]) => [x * scale, z * scale] as Vec2),
    girdleTopY: girdleTopY * scale,
    girdleBottomY: girdleBottomY * scale,
    tableY: tableY * scale,
    culetY: culetY * scale,
  };
}

/** Split facets ("bezel 3a"/"bezel 3b") count once; the girdle band is not counted. */
function countFacets(facets: FacetPolygon[]): number {
  const names = new Set<string>();
  for (const f of facets) {
    if (f.kind === 'girdle') continue;
    if (polygonArea3(f.verts) < 1e-10) continue;
    names.add(f.name.replace(/[ab]$/, ''));
  }
  return names.size;
}

function minGirdleThickness(girdle: FacetPolygon[]): number {
  let m = Infinity;
  for (const f of girdle) {
    // quads [top_i, top_j, bot_j, bot_i] after orientation may be reversed; pair by x/z
    const tops = f.verts.filter((v) => v[1] >= 0);
    const bots = f.verts.filter((v) => v[1] < 0);
    for (const t of tops) {
      for (const b of bots) {
        if (Math.abs(t[0] - b[0]) < 1e-9 && Math.abs(t[2] - b[2]) < 1e-9) m = Math.min(m, t[1] - b[1]);
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------- mesh utils

export function newellNormal(v: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

function polygonArea3(v: Vec3[]): number {
  const n = newellNormal(v);
  return Math.hypot(n[0], n[1], n[2]) / 2;
}

/**
 * Make every facet wind counter-clockwise seen from outside: crown/table
 * normals point up, pavilion normals down, girdle normals away from the axis.
 * (All outlines are star-shaped about the origin, so this test is reliable.)
 */
export function orientFacets(facets: FacetPolygon[]): void {
  for (const f of facets) {
    const n = newellNormal(f.verts);
    let out: number;
    if (f.kind === 'girdle') {
      const c = centroid(f.verts);
      out = n[0] * c[0] + n[2] * c[2];
    } else {
      out = f.kind === 'pavilion' ? -n[1] : n[1];
    }
    // reverse but keep the first vertex (the fan apex for girdle-facet fans)
    if (out < 0) f.verts = [f.verts[0], ...f.verts.slice(1).reverse()];
  }
}

function centroid(v: Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (const p of v) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return [c[0] / v.length, c[1] / v.length, c[2] / v.length];
}

/**
 * Triangulate facets. Triangles and quads split directly; larger polygons fan
 * from their first vertex if convex-safe (girdle facets: apex first), and the
 * table fans from its centroid (handles the heart's star-shaped table).
 * Degenerate triangles (collapsed step-cut rings) are dropped.
 */
export function triangulate(facets: FacetPolygon[]): { positions: number[]; facetIds: number[] } {
  const positions: number[] = [];
  const facetIds: number[] = [];
  const push = (a: Vec3, b: Vec3, c: Vec3, id: number) => {
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(cr[0], cr[1], cr[2]) < 1e-12) return;
    positions.push(...a, ...b, ...c);
    facetIds.push(id, id, id);
  };
  facets.forEach((f, id) => {
    const v = f.verts;
    if (f.kind === 'table' || (f.name === 'keel' && v.length > 4)) {
      const c = centroid(v);
      for (let i = 0; i < v.length; i++) push(c, v[i], v[(i + 1) % v.length], id);
    } else {
      for (let i = 1; i < v.length - 1; i++) push(v[0], v[i], v[i + 1], id);
    }
  });
  return { positions, facetIds };
}

/** Signed volume of a closed, outward-wound triangle soup. */
export function meshVolume(positions: ArrayLike<number>): number {
  let vol = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return vol / 6;
}

function mul(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}
