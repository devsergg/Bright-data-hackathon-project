/**
 * 57-facet modified brilliant, designed exactly on the unit circle and mapped
 * onto any girdle outline.
 *
 * Canonical round brilliant (radius 1, girdle plane y = 0):
 *
 *   crown:   1 table · 8 stars · 8 bezels · 16 upper-girdle halves
 *   pavilion: 8 mains · 16 lower-girdle halves · pointed culet
 *
 * Meetpoints, k = 0..7, θ_k = k·45° (mains), θ'_k = θ_k + 22.5°:
 *   T_k  table corner      (r_t, θ_k)    on the table plane
 *   S_k  star tip          (r_s, θ'_k)   on bezels k and k+1
 *   B_k  girdle (main)     (1,   θ_k)
 *   G_k  girdle (between)  (1,   θ'_k)
 *   L_k  lower-girdle tip  (r_l, θ'_k)   on pavilion mains k and k+1
 *   C    culet             (0)
 *
 * A bezel is the plane through B_k tilted at the crown angle α toward θ_k, so
 * any point p on it has  y = g/2 + tan α · (1 − p·u_k).  Placing T_k and S_k
 * with that formula makes every bezel and pavilion main exactly planar. Girdle
 * facets are planes through three meetpoints; the extra girdle samples between
 * B and G are dropped vertically onto those planes, which reproduces the real
 * scalloped girdle and keeps the facets planar.
 */
import { deg } from '../units';
import type { Outline } from './outlines';
import type { BrilliantProportions, FacetPolygon, Vec3 } from './types';

const STEP = Math.PI / 4; // 45°
const HALF = Math.PI / 8; // 22.5°

export interface BrilliantOptions {
  /** Girdle samples per 22.5° span (≥1). More = rounder girdle. */
  girdleSubdiv: number;
  /** True when the outline map is affine (round/oval) ⇒ quads are exactly planar. */
  planarMap: boolean;
}

export function buildBrilliant(
  p: BrilliantProportions,
  outline: Outline,
  opts: BrilliantOptions,
): FacetPolygon[] {
  const rt = p.tablePct / 100;
  const tanA = Math.tan(deg(p.crownAngle));
  const tanB = Math.tan(deg(p.pavilionAngle));
  const gTop = p.girdlePct / 100; // half of (girdlePct% × width 2)
  const gBot = -gTop;
  const cosH = Math.cos(HALF);

  // radial positions on the canonical circle
  const rTableEdge = rt * cosH; // table edge midpoint distance at θ'
  const rs = rTableEdge + (p.starPct / 100) * (1 - rTableEdge);
  const rl = 1 - p.lowerHalfPct / 100;

  const yTable = gTop + tanA * (1 - rt);
  const yStar = gTop + tanA * (1 - rs * cosH);
  const yLower = gBot - tanB * (1 - rl * cosH);
  const yCulet = gBot - tanB;

  const map = (r: number, t: number, y: number): Vec3 => {
    const [x, z] = outline.point(t);
    return [r * x, y, r * z];
  };

  const T: Vec3[] = [];
  const S: Vec3[] = [];
  const L: Vec3[] = [];
  for (let k = 0; k < 8; k++) {
    const tb = k * STEP;
    T.push(map(rt, tb, yTable));
    S.push(map(rs, tb + HALF, yStar));
    L.push(map(rl, tb + HALF, yLower));
  }
  const C: Vec3 = [0, yCulet, 0];

  // girdle samples: index i over 16 spans × subdiv
  const sub = Math.max(1, Math.round(opts.girdleSubdiv));
  const nG = 16 * sub;
  const girdleXZ: [number, number][] = [];
  for (let i = 0; i < nG; i++) {
    const [x, z] = outline.point((i / nG) * 2 * Math.PI);
    girdleXZ.push([x, z]);
  }
  const top: Vec3[] = new Array(nG);
  const bot: Vec3[] = new Array(nG);
  // meetpoints sit exactly at ±g/2
  for (let i = 0; i < nG; i += sub) {
    top[i] = [girdleXZ[i][0], gTop, girdleXZ[i][1]];
    bot[i] = [girdleXZ[i][0], gBot, girdleXZ[i][1]];
  }

  const facets: FacetPolygon[] = [];
  const add = (name: string, kind: FacetPolygon['kind'], verts: Vec3[]) =>
    facets.push({ name, kind, verts });
  const wrap = (i: number) => ((i % nG) + nG) % nG;
  // On strongly curved fancy outlines the scallop between meetpoints can dip
  // through the girdle; keep at least 35% of the nominal thickness there.
  const minHalf = 0.35 * gTop;
  const clampTop = (y: number) => Math.max(y, minHalf);
  const clampBot = (y: number) => Math.min(y, -minHalf);

  // table
  add('table', 'table', T.slice());

  for (let k = 0; k < 8; k++) {
    const kn = (k + 1) % 8;
    const kp = (k + 7) % 8;
    const iB = k * 2 * sub; // girdle index at θ_k
    const iG = iB + sub; // at θ'_k
    const iBn = wrap(iB + 2 * sub); // at θ_{k+1}

    // star
    add(`star ${k + 1}`, 'crown', [T[k], T[kn], S[k]]);

    // bezel (kite T_k, S_{k-1}, B_k, S_k)
    const Bk = top[iB];
    if (opts.planarMap) {
      add(`bezel ${k + 1}`, 'crown', [T[k], S[kp], Bk, S[k]]);
    } else {
      add(`bezel ${k + 1}a`, 'crown', [T[k], S[kp], Bk]);
      add(`bezel ${k + 1}b`, 'crown', [T[k], Bk, S[k]]);
    }

    // upper girdle halves: planes through S_k, B_k, G_k  and  S_k, G_k, B_{k+1}
    const ugA = girdleFacet(S[k], iB, iG, top, girdleXZ, nG, clampTop);
    const ugB = girdleFacet(S[k], iG, iBn, top, girdleXZ, nG, clampTop);
    add(`upper girdle ${2 * k + 1}`, 'crown', ugA);
    add(`upper girdle ${2 * k + 2}`, 'crown', ugB);

    // lower girdle halves
    const lgA = girdleFacet(L[k], iB, iG, bot, girdleXZ, nG, clampBot);
    const lgB = girdleFacet(L[k], iG, iBn, bot, girdleXZ, nG, clampBot);
    add(`lower girdle ${2 * k + 1}`, 'pavilion', lgA);
    add(`lower girdle ${2 * k + 2}`, 'pavilion', lgB);

    // pavilion main (kite B'_k, L_k, C, L_{k-1})
    const Bb = bot[iB];
    if (opts.planarMap) {
      add(`pavilion main ${k + 1}`, 'pavilion', [Bb, L[k], C, L[kp]]);
    } else {
      add(`pavilion main ${k + 1}a`, 'pavilion', [Bb, L[k], C]);
      add(`pavilion main ${k + 1}b`, 'pavilion', [Bb, C, L[kp]]);
    }
  }

  // girdle band
  for (let i = 0; i < nG; i++) {
    const j = wrap(i + 1);
    add(`girdle ${i + 1}`, 'girdle', [top[i], top[j], bot[j], bot[i]]);
  }

  return facets;
}

/**
 * Fan polygon apex → girdle[i0..i1]. Fills in the intermediate girdle samples
 * by projecting them vertically onto the plane (apex, girdle[i0], girdle[i1]).
 */
function girdleFacet(
  apex: Vec3,
  i0: number,
  i1: number,
  ring: Vec3[],
  xz: [number, number][],
  nG: number,
  clampY: (y: number) => number,
): Vec3[] {
  const a = ring[i0];
  const b = ring[i1 % nG];
  const n = cross(sub3(a, apex), sub3(b, apex));
  const span = ((i1 - i0) % nG + nG) % nG;
  const verts: Vec3[] = [apex, a];
  for (let s = 1; s < span; s++) {
    const i = (i0 + s) % nG;
    const [x, z] = xz[i];
    const y = clampY(apex[1] - (n[0] * (x - apex[0]) + n[2] * (z - apex[2])) / n[1]);
    ring[i] = [x, y, z];
    verts.push(ring[i]);
  }
  verts.push(b);
  return verts;
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
