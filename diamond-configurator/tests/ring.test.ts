import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildGem } from '../src/gems/build';
import { CUTS } from '../src/gems/catalog';
import type { CutId } from '../src/gems/types';
import {
  benchCheck,
  minBandThickness,
  minProngDiameter,
  recommendedProngDiameter,
  tipBend,
} from '../src/ring/metallurgy';
import { makeBezel, makeProng, meshVolume, outlineAt, sweep, type HeadParams } from '../src/ring/parts';
import { DEFAULT_CONFIG } from '../src/state';

const round1ct = buildGem({ cut: 'round', carat: 1, ratio: 1, proportions: CUTS.round.proportions });

function head(cut: CutId, carat = 1, bandWidth = 2): HeadParams {
  const gem = cut === 'round' && carat === 1 ? round1ct : buildGem({ cut, carat, ratio: CUTS[cut].ratio, proportions: CUTS[cut].proportions });
  const bandTopY = 8.4 + 1.7;
  return { gem, gemY: bandTopY + 0.9 - gem.culetY, bandTopY, bandWidth, prongRadius: recommendedProngDiameter('platinum', gem) / 2 };
}

/** Girdle radius in the direction of (x, z): the outline sample with the nearest bearing. */
function outlineRadiusAt(outline: [number, number][], x: number, z: number): number {
  const a = Math.atan2(z, x);
  let best = outline[0];
  let bd = Infinity;
  for (const o of outline) {
    const d = Math.abs(Math.atan2(Math.sin(Math.atan2(o[1], o[0]) - a), Math.cos(Math.atan2(o[1], o[0]) - a)));
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return Math.hypot(best[0], best[1]);
}

function verts(g: ReturnType<typeof makeProng>): Vector3[] {
  const p = g.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => new Vector3().fromBufferAttribute(p, i));
}

describe('metal mechanics', () => {
  it('softer alloys need thicker prongs', () => {
    const pd = minProngDiameter('palladium', round1ct);
    const pt = minProngDiameter('platinum', round1ct);
    const yg = minProngDiameter('yellow-gold-14k', round1ct);
    const wg = minProngDiameter('white-gold-14k', round1ct);
    expect(pd).toBeGreaterThan(pt);
    expect(pt).toBeGreaterThan(yg);
    expect(yg).toBeGreaterThan(wg);
    // ~0.85 mm in 14k for a 6.4 mm stone
    expect(yg).toBeGreaterThan(0.75);
    expect(yg).toBeLessThan(0.95);
  });

  it('recommended prongs clear the minimum', () => {
    for (const m of ['platinum', 'white-gold-14k', 'palladium'] as const) {
      expect(recommendedProngDiameter(m, round1ct)).toBeGreaterThanOrEqual(minProngDiameter(m, round1ct));
    }
  });

  it('nickel white gold tolerates the least bending, platinum the most margin', () => {
    const wg = tipBend('white-gold-14k', round1ct, 0.8);
    const pt = tipBend('platinum', round1ct, 0.9);
    expect(wg.maxDeg).toBeLessThan(pt.maxDeg);
    expect(wg.springBackDeg).toBeGreaterThan(pt.springBackDeg);
    // the fold itself depends on the stone, not the metal
    expect(wg.requiredDeg).toBeCloseTo(pt.requiredDeg, 6);
    // a well-cut round (crown ≈ 34.5°) needs the tip folded about 55°
    expect(pt.requiredDeg).toBeGreaterThan(50);
    expect(pt.requiredDeg).toBeLessThan(60);
  });

  it('band minimum grows as the band narrows or softens', () => {
    expect(minBandThickness('platinum', 2)).toBeGreaterThan(minBandThickness('yellow-gold-14k', 2));
    expect(minBandThickness('platinum', 1.6)).toBeGreaterThan(minBandThickness('platinum', 2.5));
  });

  it('flags thin prongs and passes the defaults', () => {
    const ok = benchCheck({ ...DEFAULT_CONFIG }, round1ct);
    expect(ok.checks.find((c) => c.id === 'prong-strength')!.status).toBe('ok');
    const thin = benchCheck({ ...DEFAULT_CONFIG, prongDiameter: 0.55 }, round1ct);
    expect(thin.checks.find((c) => c.id === 'prong-strength')!.status).toBe('risk');
    expect(thin.worst).toBe('risk');
  });
});

describe('head geometry', () => {
  it('sweeps are closed: volume matches a capsule', () => {
    const r = 0.5;
    const L = 4;
    const g = sweep([new Vector3(0, 0, 0), new Vector3(0, L / 2, 0), new Vector3(0, L, 0)], () => r, { segments: 64, radial: 48 });
    const capsule = Math.PI * r * r * L + (4 / 3) * Math.PI * r ** 3;
    expect(meshVolume(g)).toBeGreaterThan(capsule * 0.95);
    expect(meshVolume(g)).toBeLessThan(capsule * 1.02);
  });

  for (const cut of ['round', 'oval', 'emerald', 'pear'] as CutId[]) {
    it(`${cut}: prong feet land inside the band and prongs stay off the stone`, () => {
      const h = head(cut);
      const { gem, gemY } = h;
      for (const t of CUTS[cut].prongs6) {
        const v = verts(makeProng(h, t));
        // foot: the part sunk into the band stays within the band's width
        const low = v.filter((p) => p.y < h.bandTopY - h.prongRadius);
        expect(low.length).toBeGreaterThan(0);
        for (const p of low) expect(Math.abs(p.z)).toBeLessThanOrEqual(h.bandWidth / 2 + 0.02);

        // no vertex inside the pavilion (outline radius at the vertex's own bearing, scaled to its height)
        for (const p of v) {
          const yl = p.y - gemY;
          if (yl <= gem.culetY || yl >= gem.girdleBottomY) continue;
          const s = (yl - gem.culetY) / (gem.girdleBottomY - gem.culetY);
          expect(Math.hypot(p.x, p.z)).toBeGreaterThan(s * outlineRadiusAt(gem.outline, p.x, p.z) - 0.1);
        }
      }
    });
  }

  it('set tips rest on the crown; cast tips stand clear of it', () => {
    const h = head('round');
    const { gem, gemY } = h;
    const R = Math.hypot(...outlineAt(gem, 30));
    const tanC = (gem.tableY - gem.girdleTopY) / (R * (1 - gem.metrics.tablePct / 100));
    const crown = (r: number) => gemY + gem.girdleTopY + (R - r) * tanC;
    const set = verts(makeProng(h, 30, 'set'));
    const overCrown = set.filter((p) => p.y > gemY + gem.girdleTopY && Math.hypot(p.x, p.z) < R - 0.05);
    expect(overCrown.length).toBeGreaterThan(0); // the tip actually covers the crown
    for (const p of overCrown) expect(p.y).toBeGreaterThan(crown(Math.hypot(p.x, p.z)) - 0.06);
    // as cast, the prong must let the stone drop in: nothing reaches inside the girdle above it
    // (R here is the girdle radius on the prong's centre line)
    const cast = verts(makeProng(h, 30, 'cast'));
    const inside = cast.filter((p) => p.y > gemY + gem.girdleTopY && Math.hypot(p.x, p.z) < R - 0.05);
    expect(inside.length).toBe(0);
  });

  it('bezel cup is a closed solid', () => {
    const cup = makeBezel(head('round'), 0.6);
    expect(meshVolume(cup.geometry)).toBeGreaterThan(5);
    expect(meshVolume(cup.geometry)).toBeLessThan(80);
  });
});
