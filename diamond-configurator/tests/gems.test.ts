import { describe, expect, it } from 'vitest';
import { buildGem, newellNormal } from '../src/gems/build';
import { CUTS, CUT_ORDER } from '../src/gems/catalog';
import type { CutId, GemSpec } from '../src/gems/types';
import { caratsFromVolume, diamondIOR, usRingSizeToInnerDiameter } from '../src/units';

const spec = (cut: CutId, carat = 1): GemSpec => ({
  cut,
  carat,
  ratio: CUTS[cut].ratio,
  proportions: { ...CUTS[cut].proportions },
});

/** Every undirected edge must be used exactly twice, in opposite directions. */
function edgeReport(pos: ArrayLike<number>) {
  const key = (i: number) =>
    `${Math.round(pos[i] * 1e5)},${Math.round(pos[i + 1] * 1e5)},${Math.round(pos[i + 2] * 1e5)}`;
  const directed = new Map<string, number>();
  for (let t = 0; t < pos.length; t += 9) {
    const k = [key(t), key(t + 3), key(t + 6)];
    for (let e = 0; e < 3; e++) {
      const a = k[e];
      const b = k[(e + 1) % 3];
      if (a === b) continue;
      const id = `${a}|${b}`;
      directed.set(id, (directed.get(id) ?? 0) + 1);
    }
  }
  let open = 0;
  let flipped = 0;
  for (const [id, n] of directed) {
    const [a, b] = id.split('|');
    const back = directed.get(`${b}|${a}`) ?? 0;
    if (n > 1) flipped++;
    if (back !== n) open++;
  }
  return { open, flipped };
}

describe('units', () => {
  it('diamond IOR matches the textbook D-line value', () => {
    expect(diamondIOR(589.3)).toBeCloseTo(2.417, 2);
    // dispersion B–G (686.7 – 430.8 nm) is 0.044
    expect(diamondIOR(430.8) - diamondIOR(686.7)).toBeCloseTo(0.044, 2);
  });
  it('ring size 6 is 16.51 mm', () => {
    expect(usRingSizeToInnerDiameter(6)).toBeCloseTo(16.51, 2);
  });
});

describe.each(CUT_ORDER)('%s', (cut) => {
  const gem = buildGem(spec(cut));
  const pos = gem.geometry.getAttribute('position').array;

  it('is a closed, consistently wound solid', () => {
    const r = edgeReport(pos);
    expect(r.open).toBe(0);
    expect(r.flipped).toBe(0);
  });

  it('weighs exactly the requested carats', () => {
    expect(gem.metrics.carat).toBeCloseTo(1, 6);
    expect(caratsFromVolume(gem.metrics.volumeMm3)).toBeCloseTo(1, 6);
  });

  it('has its girdle on y = 0 with table up', () => {
    expect(gem.tableY).toBeGreaterThan(0);
    expect(gem.culetY).toBeLessThan(0);
    expect(gem.girdleTopY).toBeGreaterThan(gem.girdleBottomY);
    expect(gem.metrics.girdleMinPct).toBeGreaterThan(0);
  });

  it('every triangle faces outward', () => {
    // star-shaped about the vertical axis ⇒ outward normals point away from it or up/down
    let bad = 0;
    for (let t = 0; t < pos.length; t += 9) {
      const a: [number, number, number] = [pos[t], pos[t + 1], pos[t + 2]];
      const b: [number, number, number] = [pos[t + 3], pos[t + 4], pos[t + 5]];
      const c: [number, number, number] = [pos[t + 6], pos[t + 7], pos[t + 8]];
      const n = newellNormal([a, b, c]);
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      const cz = (a[2] + b[2] + c[2]) / 3;
      const mid = (gem.tableY + gem.culetY) / 2;
      if (n[0] * cx + n[1] * (cy - mid) + n[2] * cz <= 0) bad++;
    }
    expect(bad).toBe(0);
  });
});

describe('round brilliant', () => {
  const gem = buildGem(spec('round'));

  it('has 57 facets', () => {
    expect(gem.metrics.facetCount).toBe(57);
  });

  it('1.00 ct ideal cut is ~6.4–6.5 mm across (trade reference 6.4–6.5 mm)', () => {
    expect(gem.metrics.widthMm).toBeGreaterThan(6.35);
    expect(gem.metrics.widthMm).toBeLessThan(6.6);
  });

  it('ideal proportions give ~15% crown, ~43% pavilion, ~61% depth', () => {
    expect(gem.metrics.crownHeightPct).toBeCloseTo(15.0, 0);
    expect(gem.metrics.pavilionDepthPct).toBeCloseTo(43.1, 0);
    expect(gem.metrics.depthPct).toBeGreaterThan(60);
    expect(gem.metrics.depthPct).toBeLessThan(63);
  });

  it('every facet is planar', () => {
    for (const f of gem.facets) {
      const n = newellNormal(f.verts);
      const len = Math.hypot(...n);
      if (len < 1e-9) continue;
      const u = n.map((x) => x / len);
      const d0 = u[0] * f.verts[0][0] + u[1] * f.verts[0][1] + u[2] * f.verts[0][2];
      for (const v of f.verts) {
        expect(Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2] - d0)).toBeLessThan(1e-6);
      }
    }
  });

  it('scales width with the cube root of carat', () => {
    const two = buildGem(spec('round', 2));
    expect(two.metrics.widthMm / gem.metrics.widthMm).toBeCloseTo(Math.cbrt(2), 6);
  });
});

describe('elongated shapes', () => {
  it('honour the length/width ratio', () => {
    for (const cut of ['oval', 'pear', 'marquise', 'emerald'] as CutId[]) {
      const g = buildGem(spec(cut));
      expect(g.metrics.ratio).toBeCloseTo(CUTS[cut].ratio, 1);
    }
  });
});
