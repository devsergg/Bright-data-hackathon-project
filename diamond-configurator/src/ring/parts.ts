/**
 * Procedural ring parts (placeholders until Rhino settings are loaded).
 *
 * Ring frame (millimetres): finger axis = Z, the head sits on top (+Y),
 * the band's inner circle is centred on the origin.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { GemBuild, Vec2 } from '../gems/types';

export interface BandParams {
  innerDiameter: number;
  width: number;
  thickness: number;
  /** Superellipse exponent of the cross-section: 2 = oval, higher = flatter "comfort fit". */
  profileExponent?: number;
}

/** Comfort-fit band: a superellipse cross-section revolved around the finger axis. */
export function makeBand(p: BandParams): BufferGeometry {
  const ri = p.innerDiameter / 2;
  const rc = ri + p.thickness / 2;
  const n = p.profileExponent ?? 3.2;
  const e = 2 / n;
  const pts: Vector2[] = [];
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = rc + (p.thickness / 2) * Math.sign(c) * Math.abs(c) ** e;
    const ax = (p.width / 2) * Math.sign(s) * Math.abs(s) ** e;
    pts.push(new Vector2(r, ax));
  }
  const g = new LatheGeometry(pts, 192);
  g.rotateX(Math.PI / 2); // lathe axis Y → finger axis Z
  g.computeVertexNormals();
  return g;
}

/** Sample the gem outline at outline parameter tDeg (outline is 256 param samples). */
export function outlineAt(gem: GemBuild, tDeg: number): Vec2 {
  const n = gem.outline.length;
  const i = Math.round((((tDeg % 360) + 360) % 360) / 360 * n) % n;
  return gem.outline[i];
}

export interface HeadParams {
  gem: GemBuild;
  /** Y of the gem's girdle plane in ring space. */
  gemY: number;
  /** Y of the top of the band. */
  bandTopY: number;
  prongRadius: number;
}

/**
 * One prong: hugs the pavilion from the band up to the girdle, then bends over
 * the crown edge and ends in a rounded tip.
 */
export function makeProng(h: HeadParams, tDeg: number, withTip = true): BufferGeometry[] {
  const { gem, gemY, bandTopY, prongRadius: pr } = h;
  const [gx, gz] = outlineAt(gem, tDeg);
  const R = Math.hypot(gx, gz);
  const ux = gx / R;
  const uz = gz / R;
  const at = (radial: number, y: number) => new Vector3(ux * radial, y, uz * radial);
  const pavY = (s: number) => gemY + gem.culetY * (1 - s) + gem.girdleBottomY * s;

  const pts: Vector3[] = [];
  const baseY = Math.min(bandTopY - pr * 0.5, pavY(0.15) - 0.4);
  pts.push(at(R * 0.5, baseY));
  for (const s of [0.2, 0.5, 0.8, 1.0]) pts.push(at(R * s + pr * 1.02, pavY(s)));
  if (withTip) {
    pts.push(at(R + pr * 0.75, gemY + gem.girdleTopY + pr * 0.55));
    pts.push(at(R + pr * 0.2, gemY + gem.girdleTopY + pr * 0.95));
  }
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const parts: BufferGeometry[] = [new TubeGeometry(curve, 64, pr, 14, false)];
  const end = pts[pts.length - 1];
  const tip = new SphereGeometry(pr * (withTip ? 1.05 : 1), 16, 12);
  tip.translate(end.x, end.y, end.z);
  parts.push(tip);
  return parts;
}

/** Closed rail around the pavilion that ties the prongs together (gallery). */
export function makeGalleryRail(h: HeadParams, s = 0.55, radiusScale = 0.75): BufferGeometry {
  const { gem, gemY, prongRadius: pr } = h;
  const y = gemY + gem.culetY * (1 - s) + gem.girdleBottomY * s;
  const step = Math.max(1, Math.floor(gem.outline.length / 64));
  const pts: Vector3[] = [];
  for (let i = 0; i < gem.outline.length; i += step) {
    const [x, z] = gem.outline[i];
    const r = Math.hypot(x, z);
    const k = (r * s + pr * 1.4) / r;
    pts.push(new Vector3(x * k, y, z * k));
  }
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  return new TubeGeometry(curve, 128, pr * radiusScale, 10, true);
}

/** Offset a star-shaped polyline outward along vertex normals. */
export function offsetOutline(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    // CCW polyline ⇒ (dz, −dx) points outward
    return [p[0] + nx * d, p[1] + nz * d] as Vec2;
  });
}

/** Bezel collar: a metal wall around the girdle with a lip over the crown edge. */
export function makeBezel(h: HeadParams, wall: number, lip = 0.25): BufferGeometry {
  const { gem, gemY } = h;
  const outer = offsetOutline(gem.outline, wall);
  const inner = offsetOutline(gem.outline, -lip);
  // shape y = −z so that rotateX(−π/2) maps it back onto +z
  const shape = new Shape(outer.map(([x, z]) => new Vector2(x, -z)));
  shape.holes.push(new Shape(inner.map(([x, z]) => new Vector2(x, -z)).reverse()));
  const bottom = gemY + gem.girdleBottomY - Math.max(0.9, gem.metrics.widthMm * 0.12);
  const top = gemY + gem.girdleTopY + 0.3;
  const bevel = Math.min(0.15, wall * 0.25);
  const g = new ExtrudeGeometry(shape, {
    depth: top - bottom - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bottom + bevel, 0);
  g.computeVertexNormals();
  return g;
}

/** Evenly spaced points (by arc length) along a closed polyline. */
export function resampleClosed(poly: Vec2[], count: number): { p: Vec2; tangent: Vec2 }[] {
  const n = poly.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[n];
  const out: { p: Vec2; tangent: Vec2 }[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (cum[seg + 1] < s) seg++;
    const a = poly[seg];
    const b = poly[(seg + 1) % n];
    const f = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1;
    out.push({ p: [a[0] + tx * f, a[1] + tz * f], tangent: [tx / tl, tz / tl] });
  }
  return out;
}

export function perimeter(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

export interface MeleeLayout {
  /** Instance matrices for melee stones (gem local frame → ring frame). */
  stones: Matrix4[];
  /** Metal geometry (frame / beads). */
  metal: BufferGeometry[];
}

/** Halo of melee around the centre stone. */
export function layoutHalo(h: HeadParams, meleeDiameter: number, meleeGem: GemBuild): MeleeLayout {
  const { gem, gemY, prongRadius: pr } = h;
  const dm = meleeDiameter;
  const gap = 0.1;
  const path = offsetOutline(gem.outline, pr * 0.5 + dm / 2 + 0.08);
  const count = Math.max(8, Math.floor(perimeter(path) / (dm + gap)));
  const samples = resampleClosed(path, count);
  const y = gemY + gem.girdleTopY - meleeGem.tableY * 0.6 - dm * 0.08;
  const stones = samples.map(({ p }) => new Matrix4().makeTranslation(p[0], y, p[1]));

  const metal: BufferGeometry[] = [];
  const frameY = y + meleeGem.girdleBottomY - dm * 0.12;
  const curve = new CatmullRomCurve3(path.filter((_, i) => i % 2 === 0).map(([x, z]) => new Vector3(x, frameY, z)), true);
  metal.push(new TubeGeometry(curve, 256, dm * 0.42, 10, true));
  // shared beads between stones, inside and outside the row
  for (let k = 0; k < count; k++) {
    const a = samples[k].p;
    const b = samples[(k + 1) % count].p;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const tx = b[0] - a[0];
    const tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = tz / tl;
    const nz = -tx / tl;
    for (const side of [1, -1]) {
      const bead = new SphereGeometry(dm * 0.15, 10, 8);
      bead.translate(mx + nx * side * dm * 0.4, y + meleeGem.girdleTopY + dm * 0.05, mz + nz * side * dm * 0.4);
      metal.push(bead);
    }
  }
  return { stones, metal };
}

/**
 * Pavé row along the top of a band, from angle `fromDeg` to `toDeg` on each
 * side of the head (or all the way round for an eternity band, fromDeg = 0, toDeg = 180).
 */
export function layoutPave(
  band: BandParams,
  meleeDiameter: number,
  meleeGem: GemBuild,
  fromDeg: number,
  toDeg: number,
  zOffset = 0,
): MeleeLayout {
  const ro = band.innerDiameter / 2 + band.thickness;
  const dm = meleeDiameter;
  const step = (dm + 0.12) / ro; // radians per stone
  const stones: Matrix4[] = [];
  const metal: BufferGeometry[] = [];
  const angles: number[] = [];
  const a0 = (fromDeg * Math.PI) / 180;
  const a1 = (toDeg * Math.PI) / 180;
  const full = fromDeg <= 0 && toDeg >= 180;
  if (full) {
    const n = Math.floor((2 * Math.PI) / step);
    for (let i = 0; i < n; i++) angles.push((i / n) * 2 * Math.PI);
  } else {
    for (let a = a0 + step / 2; a <= a1; a += step) angles.push(a, -a);
  }
  const zAxis = new Vector3(0, 0, 1);
  const seatR = ro - meleeGem.tableY * 0.9;
  for (const a of angles) {
    const q = new Quaternion().setFromAxisAngle(zAxis, -a);
    const pos = new Vector3(Math.sin(a) * seatR, Math.cos(a) * seatR, zOffset);
    stones.push(new Matrix4().compose(pos, q, new Vector3(1, 1, 1)));
    for (const side of [1, -1]) {
      const b = new SphereGeometry(dm * 0.16, 10, 8);
      const ab = a + step / 2;
      const rr = ro + dm * 0.02;
      b.translate(Math.sin(ab) * rr, Math.cos(ab) * rr, zOffset + side * dm * 0.42);
      metal.push(b);
    }
  }
  return { stones, metal };
}
