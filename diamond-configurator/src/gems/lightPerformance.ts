/**
 * CPU light-performance analysis — an ASET / DiamCalc-style evaluation of how
 * a cut handles light, computed on the exact facet geometry.
 *
 * By reciprocity we trace from the viewer: an orthographic grid of rays falls
 * straight onto the table, refracts in (Fresnel), and bounces inside with full
 * Fresnel energy splitting and total internal reflection. Wherever energy
 * leaves the stone, its exit direction tells us where the light the viewer
 * sees *came from*:
 *
 *   exits the crown, within 15° of vertical  → blocked by the viewer's head (contrast, ASET blue)
 *   exits the crown, 15°–45° from vertical   → brightest overhead light       (ASET red)
 *   exits the crown, 45°–90° from vertical   → low-angle ambient light        (ASET green)
 *   exits the pavilion / girdle              → light leakage, appears dark    (ASET white/black)
 *
 * "Light return" = crown exits (red + green + blue) ÷ energy that entered.
 * "Fire" = mean angular separation between the red- and blue-wavelength paths.
 */
import { DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { channelIORs } from '../units';
import type { FacetKind, GemBuild } from './types';

export interface TraceOptions {
  ior: number;
  maxBounces: number;
  /** Stop following a path once its energy falls below this. */
  minEnergy?: number;
}

export interface ExitSample {
  dir: Vector3;
  energy: number;
  kind: FacetKind;
  /** Index into TraceResult.path of the point where the light leaves. */
  at: number;
}

export interface TraceResult {
  /** Fresnel energy reflected off the entry facet. */
  entryReflect: number;
  exits: ExitSample[];
  /** Points along the dominant (highest-energy) internal path, starting at entry. */
  path: Vector3[];
  /** Energy still trapped after maxBounces. */
  trapped: number;
}

/** Unpolarised Fresnel reflectance; returns 1 for total internal reflection. */
export function fresnel(cosI: number, n1: number, n2: number): number {
  const sinT2 = (n1 / n2) ** 2 * (1 - cosI * cosI);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return (rs * rs + rp * rp) / 2;
}

/** GLSL-style refract; returns null on total internal reflection. `n` faces the incoming ray. */
export function refract(d: Vector3, n: Vector3, eta: number): Vector3 | null {
  const cosI = -n.dot(d);
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k < 0) return null;
  return d.clone().multiplyScalar(eta).addScaledVector(n, eta * cosI - Math.sqrt(k)).normalize();
}

export function reflect(d: Vector3, n: Vector3): Vector3 {
  return d.clone().addScaledVector(n, -2 * d.dot(n)).normalize();
}

export class GemTracer {
  readonly bvh: MeshBVH;
  private readonly facetKinds: FacetKind[];
  private readonly facetIdAttr: ArrayLike<number>;

  constructor(readonly gem: GemBuild, bvh?: MeshBVH) {
    this.bvh = bvh ?? new MeshBVH(gem.geometry);
    this.facetKinds = gem.facets.map((f) => f.kind);
    this.facetIdAttr = gem.geometry.getAttribute('facetId').array as ArrayLike<number>;
  }

  /** Trace a ray arriving from outside. */
  trace(origin: Vector3, dir: Vector3, opts: TraceOptions): TraceResult | null {
    const hit = this.bvh.raycastFirst(new Ray(origin, dir), DoubleSide);
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone(); // outward
    if (n.dot(dir) > 0) return null; // grazing a back face — ignore
    const cosI = -n.dot(dir);
    const R = fresnel(cosI, 1, opts.ior);
    const t = refract(dir, n, 1 / opts.ior);
    const res: TraceResult = { entryReflect: R, exits: [], path: [hit.point.clone()], trapped: 0 };
    if (!t) return res;

    let energy = 1 - R;
    let p = hit.point.clone();
    let d = t;
    const minE = opts.minEnergy ?? 1e-3;
    const ray = new Ray();
    for (let b = 0; b < opts.maxBounces && energy > minE; b++) {
      ray.origin.copy(p).addScaledVector(d, 1e-4);
      ray.direction.copy(d);
      const h = this.bvh.raycastFirst(ray, DoubleSide);
      if (!h || !h.face) break; // numerical escape
      const nOut = h.face.normal.clone();
      const nIn = nOut.clone().negate(); // faces the ray (inside)
      const ci = -nIn.dot(d);
      const F = fresnel(ci, opts.ior, 1);
      const kind = this.facetKinds[this.facetIdAttr[h.face.a]];
      p = h.point.clone();
      res.path.push(p.clone());
      if (F < 1) {
        const out = refract(d, nIn, opts.ior);
        if (out) res.exits.push({ dir: out, energy: energy * (1 - F), kind, at: res.path.length - 1 });
      }
      energy *= F;
      d = reflect(d, nIn);
    }
    res.trapped = energy;
    return res;
  }
}

export interface LightReport {
  /** Fraction of entering light returned through the crown toward the viewer hemisphere. */
  lightReturn: number;
  /** Light return that is NOT blocked by the viewer's head — what reads as "bright". */
  brightness: number;
  /** Fraction leaving through the pavilion or girdle. */
  leakage: number;
  /** Share of returned light that is viewer-obstructed (contrast pattern). */
  contrast: number;
  /** Share of returned light from the bright 15°–45° cone. */
  brightCone: number;
  /** Mean red/blue exit separation in degrees (fire potential). */
  fireDeg: number;
  /** Mean internal bounces of the dominant path. */
  meanBounces: number;
  /** ASET-style top-view map, RGBA, size × size. */
  image: Uint8ClampedArray;
  size: number;
}

/**
 * @param size      image resolution (rays per side)
 * @param eyeDistMm viewer distance above the table; 250 mm is a typical
 *                  inspection distance and matches ASET's viewing geometry
 */
export function analyzeLight(
  gem: GemBuild,
  size = 96,
  tracer = new GemTracer(gem),
  eyeDistMm = 250,
): LightReport {
  const [iorR, iorG, iorB] = channelIORs(1);
  const bb = gem.geometry.boundingBox!;
  const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.02;
  const cx = (bb.max.x + bb.min.x) / 2;
  const cz = (bb.max.z + bb.min.z) / 2;
  const eye = new Vector3(cx, gem.tableY + eyeDistMm, cz);
  const img = new Uint8ClampedArray(size * size * 4);

  let entered = 0, ret = 0, leak = 0, blue = 0, red = 0;
  let fireSum = 0, fireW = 0, bounceSum = 0, rays = 0;
  const cos15 = Math.cos((15 * Math.PI) / 180);
  const cos45 = Math.cos((45 * Math.PI) / 180);

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = cx - span / 2 + ((i + 0.5) / size) * span;
      const z = cz - span / 2 + ((j + 0.5) / size) * span;
      const dir = new Vector3(x, gem.tableY, z).sub(eye).normalize();
      const r = tracer.trace(eye, dir, { ior: iorG, maxBounces: 12 });
      const px = (j * size + i) * 4;
      if (!r) continue;
      rays++;
      bounceSum += r.path.length - 1;
      const inE = 1 - r.entryReflect;
      entered += inE;
      let cr = 0, cg = 0, cb = 0, lk = 0;
      for (const e of r.exits) {
        if (e.kind !== 'pavilion' && e.kind !== 'girdle' && e.dir.y > 0) {
          ret += e.energy;
          if (e.dir.y >= cos15) { blue += e.energy; cb += e.energy; }
          else if (e.dir.y >= cos45) { red += e.energy; cr += e.energy; }
          else cg += e.energy;
        } else {
          leak += e.energy;
          lk += e.energy;
        }
      }
      const norm = inE > 0 ? 1 / inE : 0;
      // leakage shows as near-black, like a real ASET image
      img[px] = 255 * Math.min(1, cr * norm * 1.2 + lk * norm * 0.1);
      img[px + 1] = 255 * Math.min(1, cg * norm * 1.2 + lk * norm * 0.1);
      img[px + 2] = 255 * Math.min(1, cb * norm * 1.2 + lk * norm * 0.1);
      img[px + 3] = 255;

      // fire: compare dominant exit directions for red and blue wavelengths
      if ((i + j) % 2 === 0) {
        const rr = tracer.trace(eye, dir, { ior: iorR, maxBounces: 12 });
        const rb = tracer.trace(eye, dir, { ior: iorB, maxBounces: 12 });
        const dr = dominantCrownExit(rr);
        const db = dominantCrownExit(rb);
        if (dr && db) {
          const sep = Math.acos(Math.min(1, dr.dir.dot(db.dir))) * (180 / Math.PI);
          // a large separation means the two wavelengths took different facet
          // paths (a topology change, not dispersion) — leave those out
          if (sep < 8) {
            const w = Math.min(dr.energy, db.energy);
            fireSum += sep * w;
            fireW += w;
          }
        }
      }
    }
  }
  return {
    lightReturn: entered ? ret / entered : 0,
    brightness: entered ? (ret - blue) / entered : 0,
    leakage: entered ? leak / entered : 0,
    contrast: ret ? blue / ret : 0,
    brightCone: ret ? red / ret : 0,
    fireDeg: fireW ? fireSum / fireW : 0,
    meanBounces: rays ? bounceSum / rays : 0,
    image: img,
    size,
  };
}

function dominantCrownExit(r: TraceResult | null): ExitSample | null {
  if (!r) return null;
  let best: ExitSample | null = null;
  for (const e of r.exits) {
    if (e.kind === 'pavilion' || e.kind === 'girdle' || e.dir.y <= 0) continue;
    if (!best || e.energy > best.energy) best = e;
  }
  return best;
}
