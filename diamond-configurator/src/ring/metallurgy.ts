/**
 * Metal mechanics and a "bench check" for the procedural settings.
 *
 * This is an engineering rule-of-thumb model, not FEA. It answers the questions
 * a setter and a CAD technician ask before casting:
 *
 *   - Is each prong thick enough to hold this stone in this alloy?
 *   - Can the prong tip be bent over the crown without cracking?
 *   - How much will it spring back, and how hard is it to push?
 *   - Will the band stay round? Can a bezel wall be burnished?
 *
 * Property values are typical published figures for cast / annealed alloys, for
 * orientation only. Calibrate MECH against your caster's alloy datasheets.
 */
import type { GemBuild } from '../gems/types';
import { METALS, type MetalId } from '../render/metals';
import type { RingConfig } from '../state';

export interface MetalMechanics {
  /** Vickers hardness, as cast / annealed. */
  hv: number;
  /** 0.2% yield strength, MPa. */
  yieldMPa: number;
  /** Elongation at break, %. Proxy for how far the metal bends before it cracks. */
  elongationPct: number;
  /** Young's modulus, GPa. */
  modulusGPa: number;
  /** g/cm³ */
  density: number;
  /** One line on how the alloy behaves at the setting bench. */
  bench: string;
}

export const MECH: Record<MetalId, MetalMechanics> = {
  platinum: {
    hv: 130,
    yieldMPa: 280,
    elongationPct: 35,
    modulusGPa: 170,
    density: 20.7,
    bench: 'Soft and very ductile: bends easily and smears rather than snapping, so prongs are made thicker to stay put.',
  },
  'white-gold-14k': {
    hv: 210,
    yieldMPa: 550,
    elongationPct: 20,
    modulusGPa: 105,
    density: 12.9,
    bench: 'Nickel white gold is hard and springy. Tips can crack if bent far cold; setters often anneal them first.',
  },
  'yellow-gold-18k': {
    hv: 150,
    yieldMPa: 320,
    elongationPct: 35,
    modulusGPa: 80,
    density: 15.6,
    bench: 'Forgiving to set, but softer than 14k, so prongs wear faster and need to be a little thicker.',
  },
  'yellow-gold-14k': {
    hv: 165,
    yieldMPa: 380,
    elongationPct: 30,
    modulusGPa: 87,
    density: 13.1,
    bench: 'The reference alloy here: a good balance of strength and ductility.',
  },
  'rose-gold-14k': {
    hv: 175,
    yieldMPa: 410,
    elongationPct: 25,
    modulusGPa: 90,
    density: 13.0,
    bench: 'Copper-rich: work-hardens quickly. Bend once and avoid re-tipping the same prong repeatedly.',
  },
  palladium: {
    hv: 110,
    yieldMPa: 230,
    elongationPct: 35,
    modulusGPa: 120,
    density: 12.0,
    bench: 'Light and very ductile, but the softest option, so it needs the thickest prongs.',
  },
};

/** Reference alloy for the scaling rules. */
const REF = MECH['yellow-gold-14k'];
/**
 * Prongs come out of the casting standing straight up (any inward lean would stop
 * the stone dropping in past the tips); the setter folds the whole fold.
 */
export const CAST_LEAN_DEG = 0;
/** A pusher curls the tip, so the plastic bend spreads over about this many prong diameters. */
const BEND_LENGTH_D = 3;
/** Fraction of elongation treated as safe for a single cold bend of a cast part. */
const SAFE_STRAIN_FRACTION = 0.75;

/** Mean girdle size: what drives how much a prong has to hold. */
const stoneSize = (gem: GemBuild) => (gem.metrics.widthMm + gem.metrics.lengthMm) / 2;

/**
 * Minimum prong diameter (mm). A prong resisting a snag is a cantilever whose
 * plastic moment is σy·d³/6, so equal holding strength needs d ∝ σy^(-1/3).
 * Reference: 14k yellow gold at 13% of the stone size, never under 0.6 mm.
 */
export function minProngDiameter(metal: MetalId, gem: GemBuild): number {
  const d = 0.13 * stoneSize(gem) * Math.cbrt(REF.yieldMPa / MECH[metal].yieldMPa);
  return Math.max(0.6, d);
}

/** What "auto" picks: 10% over the minimum, to the nearest 0.05 mm. */
export function recommendedProngDiameter(metal: MetalId, gem: GemBuild): number {
  return Math.ceil((minProngDiameter(metal, gem) * 1.1) / 0.05) * 0.05;
}

export function prongDiameter(cfg: RingConfig, gem: GemBuild): number {
  return cfg.prongDiameter ?? recommendedProngDiameter(cfg.metal, gem);
}

/** Bezel-facet angle at the girdle edge (degrees): the slope the prong tip must lie on. */
export function crownAngleDeg(gem: GemBuild): number {
  const r = stoneSize(gem) / 2;
  const run = r * (1 - gem.metrics.tablePct / 100);
  return (Math.atan2(gem.tableY - gem.girdleTopY, Math.max(run, 1e-3)) * 180) / Math.PI;
}

export interface TipBend {
  /** How far the setter must fold the tip, degrees. */
  requiredDeg: number;
  /** Outer-fibre strain of that bend. */
  strain: number;
  /** Strain the alloy tolerates in one cold bend. */
  allowedStrain: number;
  /** Largest safe fold for this alloy, degrees. */
  maxDeg: number;
  /** Elastic spring-back after bending, degrees: the setter over-bends by this much. */
  springBackDeg: number;
  /** Push needed at the tip, newtons. */
  forceN: number;
}

/**
 * Bending the tip over the crown. A vertical prong lying down on a crown sloped
 * at α turns through 90° − α (less any lean cast in, CAST_LEAN_DEG).
 * Bending a rod through θ over a length L = k·d gives an outer-fibre strain
 * ε = θ·d / (2L) = θ / (2k). Spring-back of an elastic-plastic bend is
 * Δθ ≈ 3·(σy/E)·(ρ/t)·θ with ρ = L/θ, t = d, i.e. Δθ ≈ 3k·σy/E. The push to
 * yield the tip is the plastic moment σy·d³/6 over a lever of L.
 */
export function tipBend(metal: MetalId, gem: GemBuild, d: number): TipBend {
  const m = MECH[metal];
  const requiredDeg = Math.max(0, 90 - crownAngleDeg(gem) - CAST_LEAN_DEG);
  const theta = (requiredDeg * Math.PI) / 180;
  const strain = theta / (2 * BEND_LENGTH_D);
  const allowedStrain = (SAFE_STRAIN_FRACTION * m.elongationPct) / 100;
  const maxDeg = (allowedStrain * 2 * BEND_LENGTH_D * 180) / Math.PI;
  const springBackDeg = ((3 * BEND_LENGTH_D * m.yieldMPa) / (m.modulusGPa * 1000)) * (180 / Math.PI);
  const forceN = (m.yieldMPa * d ** 3) / 6 / (BEND_LENGTH_D * d);
  return { requiredDeg, strain, allowedStrain, maxDeg, springBackDeg, forceN };
}

/** Band thickness that resists going out of round as well as 1.35 mm × 2 mm in 14k (section ∝ σy·w·t²). */
export function minBandThickness(metal: MetalId, widthMm: number): number {
  return Math.max(1.2, 1.35 * Math.sqrt((REF.yieldMPa / MECH[metal].yieldMPa) * (2 / widthMm)));
}

/** Thickest bezel wall a setter can burnish over (force ∝ σy·t²); 0.65 mm in 14k. */
export function maxBezelWall(metal: MetalId): number {
  return 0.65 * Math.sqrt(REF.yieldMPa / MECH[metal].yieldMPa);
}

export type CheckStatus = 'ok' | 'caution' | 'risk';

export interface BenchCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** Short value shown next to the label, e.g. "0.95 mm (min 0.90)". */
  value: string;
  detail: string;
}

export interface BenchReport {
  metal: MetalId;
  prongDiameterMm: number;
  minProngMm: number;
  bend: TipBend;
  weightG: number | null;
  checks: BenchCheck[];
  worst: CheckStatus;
}

const POINTED = new Set(['pear', 'marquise', 'heart', 'princess']);

/** Status from a demand/capacity ratio: ≤ 0.8 fine, ≤ 1.1 at the edge, beyond that risky. */
const byRatio = (r: number): CheckStatus => (r <= 0.8 ? 'ok' : r <= 1.1 ? 'caution' : 'risk');

export function benchCheck(
  cfg: RingConfig,
  gem: GemBuild,
  opts: { metalVolumeMm3?: number | null; bezelWallMm?: number; meleeMm?: number } = {},
): BenchReport {
  const m = MECH[cfg.metal];
  const checks: BenchCheck[] = [];
  const d = prongDiameter(cfg, gem);
  const dMin = minProngDiameter(cfg.metal, gem);
  const bend = tipBend(cfg.metal, gem, d);
  const hasProngTips = cfg.setting !== 'bezel';
  const metalName = METALS[cfg.metal].label.replace(/ \(.*\)/, '');

  if (hasProngTips) {
    const r = dMin / d;
    checks.push({
      id: 'prong-strength',
      label: 'Prong strength',
      status: r <= 1 ? 'ok' : r <= 1.1 ? 'caution' : 'risk',
      value: `${d.toFixed(2)} mm · min ${dMin.toFixed(2)}`,
      detail:
        r <= 1
          ? `Thick enough to hold a ${stoneSize(gem).toFixed(1)} mm stone in ${metalName}.`
          : `Below the ${dMin.toFixed(2)} mm this alloy needs for a ${stoneSize(gem).toFixed(1)} mm stone: prongs can bend open on a snag.`,
    });

    const br = bend.strain / bend.allowedStrain;
    checks.push({
      id: 'tip-bend',
      label: 'Tip bend',
      status: byRatio(br),
      value: `${bend.requiredDeg.toFixed(0)}° of max ${bend.maxDeg.toFixed(0)}°`,
      detail:
        `The tip folds ${bend.requiredDeg.toFixed(0)}° onto a ${crownAngleDeg(gem).toFixed(1)}° crown. ` +
        (br <= 0.8
          ? `${m.elongationPct}% elongation leaves plenty of margin.`
          : br <= 1.1
            ? 'Near the limit for a cold bend: anneal the tips before setting, and bend once.'
            : 'Likely to crack if bent cold: anneal, pre-bend in wax, or choose a more ductile alloy.'),
    });

    checks.push({
      id: 'setting-feel',
      label: 'Setting feel',
      status: 'ok',
      value: `${bend.springBackDeg.toFixed(1)}° spring-back · ${bend.forceN.toFixed(0)} N`,
      detail: `Over-bend by about ${bend.springBackDeg.toFixed(1)}° so the tip lands on the crown. ${m.bench}`,
    });

    if (cfg.setting === 'solitaire-4' && stoneSize(gem) >= 8) {
      checks.push({
        id: 'prong-count',
        label: 'Prong count',
        status: 'caution',
        value: '4 on a large stone',
        detail: 'Above ~2 ct, losing one of four prongs frees the stone. Six prongs, or a 4-double-claw head, are safer.',
      });
    }
    if (POINTED.has(cfg.cut)) {
      checks.push({
        id: 'points',
        label: 'Exposed points',
        status: 'caution',
        value: 'protect the corners',
        detail: 'Points and corners chip easily. In production these get V-prongs; the preview shows round prongs.',
      });
    }
  }

  if (cfg.setting === 'bezel' && opts.bezelWallMm) {
    const tMax = maxBezelWall(cfg.metal);
    const r = opts.bezelWallMm / tMax;
    checks.push({
      id: 'bezel-burnish',
      label: 'Bezel burnishing',
      status: byRatio(r * 0.85),
      value: `${opts.bezelWallMm.toFixed(2)} mm wall · max ${tMax.toFixed(2)}`,
      detail:
        r <= 1
          ? 'Thin enough to push over the crown without chipping the girdle.'
          : 'Too stiff to burnish cleanly in this alloy: thin the top of the wall or choose a softer metal.',
    });
  }

  const tMin = minBandThickness(cfg.metal, cfg.bandWidth);
  checks.push({
    id: 'band',
    label: 'Band stays round',
    status: cfg.bandThickness >= tMin ? 'ok' : cfg.bandThickness >= tMin * 0.92 ? 'caution' : 'risk',
    value: `${cfg.bandThickness.toFixed(2)} mm · min ${tMin.toFixed(2)}`,
    detail:
      cfg.bandThickness >= tMin
        ? `Stiff enough at ${cfg.bandWidth.toFixed(1)} mm wide in ${metalName}.`
        : `Thin for ${metalName} at this width: it can squeeze oval with daily wear. Go thicker or wider.`,
  });

  if (cfg.pave && opts.meleeMm) {
    const need = 0.6 * opts.meleeMm + 0.8;
    checks.push({
      id: 'pave',
      label: 'Pavé seats',
      status: cfg.bandThickness >= need ? 'ok' : 'risk',
      value: `${opts.meleeMm.toFixed(2)} mm stones`,
      detail:
        cfg.bandThickness >= need
          ? 'Enough metal under the pavé seats.'
          : `Seats cut ${(0.6 * opts.meleeMm).toFixed(2)} mm deep need a band at least ${need.toFixed(2)} mm thick.`,
    });
  }

  const weightG = opts.metalVolumeMm3 ? (opts.metalVolumeMm3 * m.density) / 1000 : null;
  const rank: Record<CheckStatus, number> = { ok: 0, caution: 1, risk: 2 };
  const worst = checks.reduce<CheckStatus>((w, c) => (rank[c.status] > rank[w] ? c.status : w), 'ok');
  return { metal: cfg.metal, prongDiameterMm: d, minProngMm: dMin, bend, weightG, checks, worst };
}

export interface MetalComparison {
  metal: MetalId;
  hv: number;
  /** Largest safe single fold of a prong tip, degrees. */
  maxBendDeg: number;
  /** Fold this stone needs, degrees (same for every metal). */
  requiredBendDeg: number;
  minProngMm: number;
  /** Weight of this ring's metal (from the current geometry's volume), grams. */
  weightG: number | null;
}

/**
 * How every alloy would behave for this exact stone and ring. Weight assumes the
 * same geometry; in practice a softer alloy's thicker prongs add a little more.
 */
export function compareMetals(gem: GemBuild, metalVolumeMm3: number | null, order: MetalId[]): MetalComparison[] {
  return order.map((metal) => {
    const b = tipBend(metal, gem, minProngDiameter(metal, gem));
    return {
      metal,
      hv: MECH[metal].hv,
      maxBendDeg: b.maxDeg,
      requiredBendDeg: b.requiredDeg,
      minProngMm: minProngDiameter(metal, gem),
      weightG: metalVolumeMm3 ? (metalVolumeMm3 * MECH[metal].density) / 1000 : null,
    };
  });
}
