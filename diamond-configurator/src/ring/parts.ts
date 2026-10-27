/**
 * Procedural ring parts (placeholders until Rhino settings are loaded).
 *
 * Ring frame (millimetres): finger axis = Z, the head sits on top (+Y),
 * the band's inner circle is centred on the origin.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  Quaternion,
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
  /** Y of the top of the band (= band outer radius; the band is centred on the origin). */
  bandTopY: number;
  /** Band width along the finger axis: prong feet must land inside it. */
  bandWidth: number;
  prongRadius: number;
}

// ------------------------------------------------------------------ sweep

export type Cap = 'dome' | 'flat' | 'none';

/**
 * Sweep a circle of varying radius along a smooth curve through `points`.
 * Rotation-minimising frames (no twist), closed with dome or flat caps so every
 * part is watertight: no open tube ends where parts meet.
 */
export function sweep(
  points: Vector3[],
  radius: (u: number) => number,
  opts: { segments?: number; radial?: number; start?: Cap; end?: Cap } = {},
): BufferGeometry {
  const { segments = 48, radial = 16, start = 'dome', end = 'dome' } = opts;
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const P = curve.getSpacedPoints(segments);
  const T = P.map((_, i) => curve.getTangentAt(i / segments).normalize());
  // initial normal: any vector perpendicular to the first tangent
  const seed = Math.abs(T[0].y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  let N = new Vector3().crossVectors(T[0], seed).normalize();
  const frames: { p: Vector3; t: Vector3; n: Vector3; r: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    if (i > 0) N = N.clone().applyQuaternion(new Quaternion().setFromUnitVectors(T[i - 1], T[i])).normalize();
    frames.push({ p: P[i], t: T[i], n: N, r: radius(i / segments) });
  }
  // rings: [centre, normal, tangent, radius]
  const rings: { c: Vector3; n: Vector3; t: Vector3; r: number }[] = [];
  const cap = (f: (typeof frames)[number], dir: 1 | -1, kind: Cap) => {
    const out: typeof rings = [];
    if (kind === 'dome') {
      const K = 6;
      for (let k = 1; k <= K; k++) {
        const phi = (k / K) * (Math.PI / 2);
        out.push({ c: f.p.clone().addScaledVector(f.t, dir * f.r * Math.sin(phi)), n: f.n, t: f.t, r: Math.max(1e-4, f.r * Math.cos(phi)) });
      }
    } else if (kind === 'flat') out.push({ c: f.p.clone(), n: f.n, t: f.t, r: 1e-4 });
    return out;
  };
  rings.push(...cap(frames[0], -1, start).reverse());
  for (const f of frames) rings.push({ c: f.p, n: f.n, t: f.t, r: f.r });
  rings.push(...cap(frames[frames.length - 1], 1, end));

  const pos: number[] = [];
  const v = new Vector3();
  for (const g of rings) {
    const b = new Vector3().crossVectors(g.t, g.n).normalize();
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      v.copy(g.c).addScaledVector(g.n, g.r * Math.cos(a)).addScaledVector(b, g.r * Math.sin(a));
      pos.push(v.x, v.y, v.z);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ head

/**
 * Pavilion and crown slopes of the gem along one outline direction. R is the
 * largest girdle radius across the prong's width, so on points and corners the
 * prong seats clear of the stone instead of cutting the corner.
 */
function profileAt(h: HeadParams, tDeg: number) {
  const { gem } = h;
  const [gx, gz] = outlineAt(gem, tDeg);
  const R0 = Math.hypot(gx, gz);
  const u = { x: gx / R0, z: gz / R0 };
  const half = Math.asin(Math.min(1, (h.prongRadius * 1.1) / R0));
  let R = R0;
  for (const [x, z] of gem.outline) {
    const d = Math.atan2(x * u.z - z * u.x, x * u.x + z * u.z); // bearing relative to u
    if (Math.abs(d) <= half) R = Math.max(R, Math.hypot(x, z) * Math.cos(d));
  }
  const pavDrop = gem.girdleBottomY - gem.culetY;
  const beta = Math.atan2(pavDrop, R); // pavilion angle along this direction
  const tableR = R * (gem.metrics.tablePct / 100);
  const tanC = (gem.tableY - gem.girdleTopY) / Math.max(R - tableR, 1e-3);
  return { R, u, beta, tanC };
}

/**
 * Centre of a rod of radius `pr` resting on the pavilion at fraction s (0 = culet,
 * 1 = girdle), offset along the surface normal so it touches without cutting in.
 */
function onPavilion(h: HeadParams, R: number, beta: number, s: number, pr: number): [number, number] {
  const { gem, gemY } = h;
  const radial = s * R + pr * Math.sin(beta);
  const y = gemY + gem.culetY + s * (gem.girdleBottomY - gem.culetY) - pr * Math.cos(beta);
  return [radial, y];
}

/** Where a prong lands on the band: inside the band's width, sunk into the metal. */
function prongFoot(h: HeadParams, ux: number, uz: number, radial: number, footR: number): Vector3 {
  const x = ux * radial;
  const zMax = Math.max(0, h.bandWidth / 2 - footR * 1.05);
  const z = Math.max(-zMax, Math.min(zMax, uz * radial));
  const y = Math.sqrt(Math.max(0, h.bandTopY ** 2 - x * x)) - footR * 0.9;
  return new Vector3(x, y, z);
}

export type ProngTip = 'set' | 'cast';

/**
 * One prong: rises from the band, rests on the pavilion, runs up the girdle and
 * (set) folds over the crown edge, or (cast) stands as it comes out of the
 * casting, `castLeanDeg` off vertical, before the setter bends it.
 * Tapers from 1.3× at the foot to 0.85× at the tip, like a real claw.
 */
export function makeProng(h: HeadParams, tDeg: number, tip: ProngTip = 'set', castLeanDeg = 0): BufferGeometry {
  const { gem, gemY, prongRadius: pr } = h;
  const { R, u, beta, tanC } = profileAt(h, tDeg);
  const at = (radial: number, y: number) => new Vector3(u.x * radial, y, u.z * radial);

  const pts: Vector3[] = [];
  const seat = pr * 1.03; // a hair of clearance, as a setter leaves
  const [r30] = onPavilion(h, R, beta, 0.3, seat);
  const foot = prongFoot(h, u.x, u.z, r30, pr * 1.3);
  // leave the band straight up, so the sunk-in foot doesn't spill over the band's edge
  pts.push(foot, foot.clone().setY(h.bandTopY + pr * 0.4));
  // two points on the pavilion line before the contact run, so the curve arrives
  // already parallel to the stone instead of overshooting into it
  for (const s of [0.18, 0.3, 0.6, 0.88]) pts.push(at(...onPavilion(h, R, beta, s, seat)));
  const girdleMid = gemY + (gem.girdleTopY + gem.girdleBottomY) / 2;
  pts.push(at(R + pr, gemY + gem.girdleBottomY - pr * 0.15));
  pts.push(at(R + pr, girdleMid));

  // the folded tip lies along the crown slope; its centre rides high enough that the
  // tilted cross-section (radius 0.85·pr) clears the crown: r / cos(crown angle)
  const lift = (pr * 0.85) / Math.cos(Math.atan(tanC)) + 0.03;
  const onCrown = (r: number) => at(r, gemY + gem.girdleTopY + (R - r) * tanC + lift);
  const bendPt = at(R + pr * 0.7, gemY + gem.girdleTopY + pr * 0.5);
  const tipEnd = onCrown(R - pr * 0.5);
  if (tip === 'set') {
    pts.push(bendPt, onCrown(R - pr * 0.05), tipEnd);
  } else {
    const len = bendPt.distanceTo(pts[pts.length - 1]) + tipEnd.distanceTo(bendPt);
    const lean = (castLeanDeg * Math.PI) / 180;
    const dir = new Vector3(-u.x * Math.sin(lean), Math.cos(lean), -u.z * Math.sin(lean));
    const base = pts[pts.length - 1];
    pts.push(base.clone().addScaledVector(dir, len * 0.5), base.clone().addScaledVector(dir, len));
  }

  // taper: thick foot (a fillet into the band) that is back to full size before the
  // prong first touches the pavilion, an even shank, and a slightly finer tip
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
  const footEnd = (0.85 * pts[0].distanceTo(pts[1])) / total;
  const radius = (t: number) =>
    t < footEnd ? pr * (1.3 - 0.3 * smooth(t / footEnd)) : pr * (1 - 0.15 * smooth((t - 0.75) / 0.25));
  return sweep(pts, radius, { segments: 72, radial: 18, start: 'dome', end: 'dome' });
}

/** A bezel post: from the band up into the underside of the bezel cup. */
export function makePost(h: HeadParams, tDeg: number, topRadial: number, topY: number): BufferGeometry {
  const { prongRadius: pr } = h;
  const { R, u, beta } = profileAt(h, tDeg);
  const at = (radial: number, y: number) => new Vector3(u.x * radial, y, u.z * radial);
  const [r30, y30] = onPavilion(h, R, beta, 0.3, pr);
  const foot = prongFoot(h, u.x, u.z, r30, pr * 1.3);
  const top = at(topRadial, topY);
  const pts = [foot, at(Math.min(r30, topRadial), Math.min(y30, (foot.y + topY) / 2)), top];
  return sweep(pts, (t) => pr * (1.3 - 0.3 * smooth(t / 0.2)), { segments: 40, radial: 16, end: 'flat' });
}

/** Closed rail around the pavilion tying the prongs together, on the same line the prongs rest on. */
export function makeGalleryRail(h: HeadParams, s = 0.6, radiusScale = 0.72): BufferGeometry {
  const { gem, prongRadius: pr } = h;
  const step = Math.max(1, Math.floor(gem.outline.length / 96));
  const pts: Vector3[] = [];
  for (let i = 0; i < gem.outline.length; i += step) {
    const [x, z] = gem.outline[i];
    const R = Math.hypot(x, z);
    const beta = Math.atan2(gem.girdleBottomY - gem.culetY, R);
    const [radial, y] = onPavilion(h, R, beta, s, pr);
    pts.push(new Vector3((x / R) * radial, y, (z / R) * radial));
  }
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  return new TubeGeometry(curve, 160, pr * radiusScale, 12, true);
}

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** Enclosed volume (mm³) of a closed mesh, by signed tetrahedra. */
export function meshVolume(g: BufferGeometry): number {
  return Math.abs(signedVolume(g));
}

function signedVolume(g: BufferGeometry): number {
  const p = g.getAttribute('position');
  const idx = g.getIndex();
  const n = idx ? idx.count : p.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1);
    c.fromBufferAttribute(p, i2);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
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

export interface BezelCup {
  geometry: BufferGeometry;
  /** Radial offset (from the girdle) and y of the cup's underside, where posts attach. */
  footOffset: number;
  footY: number;
}

/**
 * Bezel cup: a closed metal profile swept around the girdle outline. The wall
 * stands `wall` thick at the girdle, its lip is burnished `lip` mm over the
 * crown, and below the girdle it tapers along the pavilion like a real cup, so
 * it meets short posts instead of hanging over the band.
 */
export function makeBezel(h: HeadParams, wall: number, lip = 0.3): BezelCup {
  const { gem, gemY } = h;
  const step = Math.max(1, Math.floor(gem.outline.length / 128));
  const dirs: { u: Vec2; R: number; beta: number; tanC: number }[] = [];
  for (let i = 0; i < gem.outline.length; i += step) {
    const [x, z] = gem.outline[i];
    const R = Math.hypot(x, z);
    const tableR = R * (gem.metrics.tablePct / 100);
    dirs.push({
      u: [x / R, z / R],
      R,
      beta: Math.atan2(gem.girdleBottomY - gem.culetY, R),
      tanC: (gem.tableY - gem.girdleTopY) / Math.max(R - tableR, 1e-3),
    });
  }
  const gT = gemY + gem.girdleTopY;
  const gB = gemY + gem.girdleBottomY;
  const sBottom = 0.5; // the cup reaches halfway down the pavilion
  const base = Math.max(0.35, wall * 0.7); // metal under the seat
  // profile as [radial offset from girdle, y], per direction (depends on R, beta, tanC); closed loop, CCW
  const profile = (d: (typeof dirs)[number]): [number, number][] => {
    const pavY = (s: number) => gemY + gem.culetY + s * (gem.girdleBottomY - gem.culetY);
    const pavO = (s: number) => (s - 1) * d.R;
    const lipTop = gT + lip * d.tanC + 0.12;
    return [
      [wall, gT + 0.1], // outer wall, top
      [wall * 0.55, lipTop + 0.02], // rounded shoulder
      [-lip, lipTop], // lip edge, over the crown
      [-lip, gT + lip * d.tanC], // lip underside on the crown
      [0, gT], // seat: girdle top
      [0, gB], // seat: girdle bottom
      [pavO(0.8), pavY(0.8)], // seat follows the pavilion
      [pavO(sBottom), pavY(sBottom)],
      [pavO(sBottom) + base, pavY(sBottom) - base * 0.6], // underside
      [wall * 0.6, gB - (gT - gB) - 0.35], // outer flank tapers out
      [wall, gB - 0.1],
    ];
  };
  const pos: number[] = [];
  const idx: number[] = [];
  const M = profile(dirs[0]).length;
  const N = dirs.length;
  // one vertex strip per profile segment so the creases stay crisp
  for (let j = 0; j < M; j++) {
    const first = pos.length / 3;
    for (let i = 0; i < N; i++) {
      const d = dirs[i];
      const prof = profile(d);
      for (const k of [j, (j + 1) % M]) {
        const [o, y] = prof[k];
        pos.push(d.u[0] * (d.R + o), y, d.u[1] * (d.R + o));
      }
    }
    for (let i = 0; i < N; i++) {
      const a = first + i * 2;
      const b = first + ((i + 1) % N) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  let g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (signedVolume(g) < 0) {
    const flipped: number[] = [];
    for (let t = 0; t < idx.length; t += 3) flipped.push(idx[t], idx[t + 2], idx[t + 1]);
    g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setIndex(flipped);
  }
  g.computeVertexNormals();
  const prof0 = profile(dirs[0]);
  return { geometry: g, footOffset: prof0[8][0], footY: prof0[8][1] };
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
export function layoutHalo(h: HeadParams, meleeDiameter: number, meleeGem: GemBuild, prongAngles: number[] = []): MeleeLayout {
  const { gem, gemY, prongRadius: pr } = h;
  const dm = meleeDiameter;
  const gap = 0.1;
  // the halo row sits outside the centre prongs, not through them
  const clearance = 2 * pr + 0.12;
  const path = offsetOutline(gem.outline, clearance + dm / 2);
  const count = Math.max(8, Math.floor(perimeter(path) / (dm + gap)));
  const samples = resampleClosed(path, count);
  const y = gemY + gem.girdleTopY - meleeGem.tableY * 0.6 - dm * 0.08;
  const stones = samples.map(({ p }) => new Matrix4().makeTranslation(p[0], y, p[1]));

  const metal: BufferGeometry[] = [];
  const frameY = y + meleeGem.girdleBottomY - dm * 0.12;
  const curve = new CatmullRomCurve3(path.filter((_, i) => i % 2 === 0).map(([x, z]) => new Vector3(x, frameY, z)), true);
  metal.push(new TubeGeometry(curve, 256, dm * 0.42, 10, true));
  // struts from each centre prong out to the halo frame, so the halo is carried by the head
  for (const t of prongAngles) {
    const { R, u } = profileAt(h, t);
    const from = new Vector3(u.x * (R + pr * 0.6), frameY, u.z * (R + pr * 0.6));
    const to = new Vector3(u.x * (R + clearance + dm / 2), frameY, u.z * (R + clearance + dm / 2));
    metal.push(sweep([from, from.clone().lerp(to, 0.5), to], () => pr * 0.75, { segments: 8, radial: 12 }));
  }
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
