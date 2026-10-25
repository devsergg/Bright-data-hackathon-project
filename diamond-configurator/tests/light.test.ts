import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildGem } from '../src/gems/build';
import { CUTS } from '../src/gems/catalog';
import { analyzeLight, fresnel, refract } from '../src/gems/lightPerformance';
import type { BrilliantProportions } from '../src/gems/types';

const round = (o: Partial<BrilliantProportions> = {}) =>
  buildGem({
    cut: 'round',
    carat: 1,
    ratio: 1,
    proportions: { ...(CUTS.round.proportions as BrilliantProportions), ...o },
  });

describe('optics primitives', () => {
  it('normal-incidence diamond reflectance is ~17%', () => {
    expect(fresnel(1, 1, 2.417)).toBeCloseTo(((2.417 - 1) / (2.417 + 1)) ** 2, 6);
    expect(fresnel(1, 1, 2.417)).toBeCloseTo(0.172, 3);
  });
  it('critical angle of diamond is ~24.4°', () => {
    const crit = Math.asin(1 / 2.417);
    expect((crit * 180) / Math.PI).toBeCloseTo(24.44, 1);
    const n = new Vector3(0, 1, 0); // facing the ray travelling downward
    const steep = new Vector3(Math.sin(crit - 0.01), -Math.cos(crit - 0.01), 0);
    const shallow = new Vector3(Math.sin(crit + 0.01), -Math.cos(crit + 0.01), 0);
    expect(refract(steep, n, 2.417)).not.toBeNull();
    expect(refract(shallow, n, 2.417)).toBeNull();
    expect(fresnel(Math.cos(crit + 0.01), 2.417, 1)).toBe(1);
  });
});

describe('light performance', () => {
  const ideal = analyzeLight(round(), 48);
  const shallow = analyzeLight(round({ pavilionAngle: 38.5 }), 48); // "fish-eye"
  const deep = analyzeLight(round({ pavilionAngle: 43.5 }), 48); // "nail-head"

  it('ideal round returns most of the light', () => {
    expect(ideal.lightReturn).toBeGreaterThan(0.7);
    expect(ideal.leakage).toBeLessThan(0.25);
  });

  it('ideal beats shallow ("fish-eye") and deep ("nail-head") pavilions', () => {
    // shallow pavilions return light from straight overhead, which the viewer's
    // own head blocks — so compare unobstructed brightness, as ASET does
    expect(ideal.brightness).toBeGreaterThan(shallow.brightness);
    expect(ideal.brightness).toBeGreaterThan(deep.brightness);
    expect(shallow.contrast).toBeGreaterThan(ideal.contrast);
    expect(ideal.leakage).toBeLessThan(deep.leakage);
  });

  it('produces dispersion (fire) and an image', () => {
    expect(ideal.fireDeg).toBeGreaterThan(0.1);
    expect(ideal.image.length).toBe(48 * 48 * 4);
  });
});
