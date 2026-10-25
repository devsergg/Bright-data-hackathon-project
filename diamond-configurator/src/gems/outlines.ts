/**
 * Girdle outlines (top view), normalised so the WIDTH (x extent) is 2 and the
 * LENGTH (z extent) is 2 × ratio. Every outline is star-shaped about the origin.
 *
 * `point(t)` maps the canonical circle parameter t ∈ [0, 2π) to the outline.
 * Brilliant facet patterns are designed on the unit circle and pushed onto the
 * outline through this map (interior point r·(cos t, sin t) → r·point(t)), so the
 * 8 main facets land on t = k·45°: for elongated shapes k = 2 / 6 are the tips,
 * for square shapes k = 1, 3, 5, 7 are the corners.
 *
 * Ellipses use the exact parametric form, which makes the map affine, so a
 * planar round-brilliant facet stays exactly planar on an oval.
 */
import type { CutId, Vec2 } from './types';

export interface Outline {
  point(t: number): Vec2;
  /** Dense closed polyline (CCW) for drawing, settings and area. */
  polyline(segments?: number): Vec2[];
}

const TAU = Math.PI * 2;

function ellipse(ratio: number): Outline {
  const point = (t: number): Vec2 => [Math.cos(t), ratio * Math.sin(t)];
  return { point, polyline: (n = 256) => sampleParam(point, n) };
}

function sampleParam(point: (t: number) => Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) out.push(point((i / n) * TAU));
  return out;
}

/**
 * Outline defined by a dense closed polyline; point(t) casts a ray from the
 * origin at the "affine angle" φ = atan2(ratio·sin t, cos t), so t = 45° lands
 * on the corner of a ratio-scaled square, and t = 90° on the +z tip.
 */
function fromPolyline(poly: Vec2[], ratio: number): Outline {
  const point = (t: number): Vec2 => {
    const dx = Math.cos(t);
    const dz = ratio * Math.sin(t);
    const s = rayPolyline(poly, dx, dz);
    return [dx * s, dz * s];
  };
  return {
    point,
    polyline: (n?: number) => (n ? sampleParam(point, n) : poly.slice()),
  };
}

/** Distance multiplier s such that s·(dx, dz) lies on the polyline. */
function rayPolyline(poly: Vec2[], dx: number, dz: number): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    const ex = bx - ax;
    const ez = bz - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-14) continue;
    const s = (ax * ez - az * ex) / den;
    const u = (ax * dz - az * dx) / den;
    if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9 && s < best) best = s;
  }
  return best;
}

/** Superellipse |x|^n + |z/ratio|^n = 1 (cushion, near-square princess). */
function superellipse(ratio: number, n: number, samples = 2048): Vec2[] {
  const e = 2 / n;
  const pts: Vec2[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([Math.sign(c) * Math.abs(c) ** e, ratio * Math.sign(s) * Math.abs(s) ** e]);
  }
  return pts;
}

/** Rectangle with 45° chamfered corners; `corner` is the chamfer leg (width = 2). */
export function cutCornerRect(ratio: number, corner: number): Vec2[] {
  const hx = 1;
  const hz = ratio;
  const c = Math.min(corner, hx * 0.999);
  return [
    [hx, -hz + c],
    [hx, hz - c],
    [hx - c, hz],
    [-hx + c, hz],
    [-hx, hz - c],
    [-hx, -hz + c],
    [-hx + c, -hz],
    [hx - c, -hz],
  ];
}

/** Densify a polygon so ray casting and offsetting stay smooth. */
function densify(poly: Vec2[], perEdge = 64): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    for (let j = 0; j < perEdge; j++) {
      const f = j / perEdge;
      out.push([ax + (bx - ax) * f, az + (bz - az) * f]);
    }
  }
  return out;
}

/**
 * Marquise: lens formed by two circular arcs meeting at the tips (0, ±ratio).
 * Circle centred at (−c, 0) with radius 1 + c passes through (1, 0) and (0, ±L)
 * when c = (L² − 1) / 2.
 */
function marquise(ratio: number, samples = 2048): Vec2[] {
  const L = ratio;
  const c = (L * L - 1) / 2;
  const R = 1 + c;
  const pts: Vec2[] = [];
  const a = Math.asin(L / R); // half-angle subtended by each arc
  const half = samples / 2;
  for (let i = 0; i < half; i++) {
    const th = -a + (2 * a * i) / half; // right arc, centre (−c, 0)
    pts.push([-c + R * Math.cos(th), R * Math.sin(th)]);
  }
  for (let i = 0; i < half; i++) {
    const th = Math.PI - a + (2 * a * i) / half; // left arc, centre (+c, 0)
    pts.push([c + R * Math.cos(th), R * Math.sin(th)]);
  }
  return pts;
}

/**
 * Pear: semicircle (radius 1) at the −z end, tapering through two tangent arcs
 * to a tip at +z. Total length 2·ratio, bounding box centred on the origin.
 */
function pear(ratio: number, samples = 2048): Vec2[] {
  const cz = 1 - ratio; // centre of the round end
  const Lt = 2 * ratio - 1; // tip distance above that centre
  const c = (Lt * Lt - 1) / 2;
  const R = 1 + c;
  const a = Math.asin(Lt / R);
  const pts: Vec2[] = [];
  const q = samples / 4;
  // right taper arc (centre (−c, cz)), from equator up to the tip
  for (let i = 0; i < q; i++) {
    const th = (a * i) / q;
    pts.push([-c + R * Math.cos(th), cz + R * Math.sin(th)]);
  }
  // left taper arc (centre (+c, cz)), from the tip down to the equator
  for (let i = 0; i < q; i++) {
    const th = Math.PI - a + (a * i) / q;
    pts.push([c + R * Math.cos(th), cz + R * Math.sin(th)]);
  }
  // round end: semicircle from (−1, cz) through (0, cz−1) to (1, cz)
  for (let i = 0; i < 2 * q; i++) {
    const th = Math.PI + (Math.PI * i) / (2 * q);
    pts.push([Math.cos(th), cz + Math.sin(th)]);
  }
  return pts;
}

/**
 * Heart: two lobes (circles radius r at (±a, b)) joined by tangent lines to a
 * point at the −z end. `cleft` controls lobe overlap (0 = no cleft).
 * Built at an arbitrary scale, then normalised to width 2 / length 2·ratio.
 */
function heart(ratio: number, cleft = 0.55, samples = 2048): Vec2[] {
  const r = 1;
  const a = r * cleft; // lobe centre offset; a < r ⇒ circles overlap ⇒ cleft
  const halfW = a + r;
  const length = 2 * ratio * halfW; // scale so width = 2·halfW
  const topY = r; // lobe tops at y = b + r with b = 0
  const tipY = topY - length;
  const cleftY = Math.sqrt(r * r - a * a);
  // tangent point on the right lobe from the tip (0, tipY)
  const dx = 0 - a;
  const dy = tipY - 0;
  const d2 = dx * dx + dy * dy;
  const base = Math.atan2(dy, dx);
  const off = Math.acos(r / Math.sqrt(d2));
  const tanAngle = base + off; // tangent point angle on the right lobe (below centre, outer side)
  const cleftAngle = Math.atan2(cleftY, -a);
  const right: Vec2[] = [];
  const n = samples / 2;
  // from tip → tangent point (straight), then CCW around lobe to the cleft
  const arcStart = tanAngle;
  let arcEnd = cleftAngle;
  while (arcEnd < arcStart) arcEnd += TAU;
  const lineN = Math.floor(n * 0.25);
  const tx = a + r * Math.cos(tanAngle);
  const ty = r * Math.sin(tanAngle);
  for (let i = 0; i < lineN; i++) {
    const f = i / lineN;
    right.push([tx * f, tipY + (ty - tipY) * f]);
  }
  const arcN = n - lineN;
  for (let i = 0; i < arcN; i++) {
    const th = arcStart + ((arcEnd - arcStart) * i) / arcN;
    right.push([a + r * Math.cos(th), r * Math.sin(th)]);
  }
  // mirror for the left half (reverse order to stay CCW)
  const left: Vec2[] = right.map(([x, y]) => [-x, y] as Vec2).reverse();
  const pts = [...right, [0, cleftY] as Vec2, ...left.slice(0, -1)];
  // normalise: width → 2, centre bounding box
  const s = 1 / halfW;
  const cy = (topY + tipY) / 2;
  return pts.map(([x, y]) => [x * s, (y - cy) * s] as Vec2);
}

export function makeOutline(cut: CutId, ratio: number, cornerPct = 0): Outline {
  switch (cut) {
    case 'round':
      return ellipse(1);
    case 'oval':
      return ellipse(ratio);
    case 'cushion':
      return fromPolyline(superellipse(ratio, 3.2), ratio);
    case 'princess':
      return fromPolyline(superellipse(ratio, 40), ratio);
    case 'radiant':
    case 'emerald':
    case 'asscher':
      return fromPolyline(densify(cutCornerRect(ratio, (cornerPct / 100) * 2)), ratio);
    case 'pear':
      return fromPolyline(pear(ratio), ratio);
    case 'marquise':
      return fromPolyline(marquise(ratio), ratio);
    case 'heart':
      return fromPolyline(heart(ratio), ratio);
  }
}

/** Shoelace area of a closed polyline. */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}
