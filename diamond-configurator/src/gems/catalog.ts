/**
 * Cut catalog: display names, families and starting proportions.
 *
 * Round defaults follow the AGS/GIA "Excellent / Ideal-0" sweet spot
 * (table 56%, crown 34.5°, pavilion 40.8°, ≈ 61% depth). Fancy shapes use
 * common trade proportions — verify against your supplier's cutting specs.
 */
import type { BrilliantProportions, CutFamily, CutId, StepProportions } from './types';

export interface CutInfo {
  id: CutId;
  name: string;
  family: CutFamily;
  /** Default length/width ratio and the range the UI allows. */
  ratio: number;
  ratioRange: [number, number];
  proportions: BrilliantProportions | StepProportions;
  /** Girdle subdivisions per 22.5° span (brilliant family). */
  girdleSubdiv: number;
  /** Outline parameters (degrees) where prongs sit; t follows the outline map. */
  prongs4: number[];
  prongs6: number[];
  note?: string;
}

const brilliantIdeal: BrilliantProportions = {
  tablePct: 56,
  crownAngle: 34.5,
  pavilionAngle: 40.8,
  girdlePct: 3.0,
  starPct: 50,
  lowerHalfPct: 77,
};

const fancyBrilliant = (o: Partial<BrilliantProportions> = {}): BrilliantProportions => ({
  ...brilliantIdeal,
  tablePct: 58,
  crownAngle: 34,
  pavilionAngle: 41,
  girdlePct: 3.2,
  lowerHalfPct: 80,
  ...o,
});

const corners = [45, 135, 225, 315];
const sixRound = [30, 90, 150, 210, 270, 330];

export const CUTS: Record<CutId, CutInfo> = {
  round: {
    id: 'round',
    name: 'Round Brilliant',
    family: 'brilliant',
    ratio: 1,
    ratioRange: [1, 1],
    proportions: brilliantIdeal,
    girdleSubdiv: 4,
    prongs4: corners,
    prongs6: sixRound,
  },
  oval: {
    id: 'oval',
    name: 'Oval',
    family: 'brilliant',
    ratio: 1.4,
    ratioRange: [1.2, 1.75],
    proportions: fancyBrilliant(),
    girdleSubdiv: 6,
    prongs4: [40, 140, 220, 320],
    prongs6: [30, 90, 150, 210, 270, 330],
  },
  cushion: {
    id: 'cushion',
    name: 'Cushion',
    family: 'brilliant',
    ratio: 1.0,
    ratioRange: [1, 1.3],
    proportions: fancyBrilliant({ tablePct: 60, crownAngle: 35, pavilionAngle: 41.5 }),
    girdleSubdiv: 6,
    prongs4: corners,
    prongs6: [0, 45, 135, 180, 225, 315],
  },
  princess: {
    id: 'princess',
    name: 'Princess',
    family: 'brilliant',
    ratio: 1.0,
    ratioRange: [1, 1.1],
    proportions: fancyBrilliant({ tablePct: 66, crownAngle: 33, pavilionAngle: 42, girdlePct: 3.5 }),
    girdleSubdiv: 6,
    prongs4: corners,
    prongs6: corners,
    note: 'Modified-brilliant approximation. A true princess has chevron pavilion facets — replace with a Rhino gem model or a dedicated generator.',
  },
  radiant: {
    id: 'radiant',
    name: 'Radiant',
    family: 'brilliant',
    ratio: 1.25,
    ratioRange: [1, 1.5],
    proportions: fancyBrilliant({ tablePct: 64, crownAngle: 34, pavilionAngle: 41.5, girdlePct: 3.5 }),
    girdleSubdiv: 8,
    prongs4: corners,
    prongs6: corners,
    note: 'Modified-brilliant approximation of the radiant pattern.',
  },
  emerald: {
    id: 'emerald',
    name: 'Emerald',
    family: 'step',
    ratio: 1.4,
    ratioRange: [1.2, 1.7],
    proportions: {
      tablePct: 64,
      crownAngle: 36,
      pavilionAngle: 41,
      girdlePct: 3,
      crownSteps: 3,
      pavilionSteps: 3,
      stepSpread: 14,
      cornerPct: 14,
    },
    girdleSubdiv: 1,
    prongs4: corners,
    prongs6: corners,
  },
  asscher: {
    id: 'asscher',
    name: 'Asscher',
    family: 'step',
    ratio: 1.0,
    ratioRange: [1, 1.05],
    proportions: {
      tablePct: 58,
      crownAngle: 35,
      pavilionAngle: 42,
      girdlePct: 3,
      crownSteps: 3,
      pavilionSteps: 4,
      stepSpread: 14,
      cornerPct: 26,
    },
    girdleSubdiv: 1,
    prongs4: corners,
    prongs6: corners,
  },
  pear: {
    id: 'pear',
    name: 'Pear',
    family: 'brilliant',
    ratio: 1.6,
    ratioRange: [1.4, 1.8],
    proportions: fancyBrilliant(),
    girdleSubdiv: 8,
    prongs4: [90, 210, 330, 270],
    prongs6: [90, 20, 160, 225, 315, 270],
  },
  marquise: {
    id: 'marquise',
    name: 'Marquise',
    family: 'brilliant',
    ratio: 2.0,
    ratioRange: [1.75, 2.25],
    proportions: fancyBrilliant({ tablePct: 57 }),
    girdleSubdiv: 8,
    prongs4: [90, 270, 0, 180],
    prongs6: [90, 270, 30, 150, 210, 330],
  },
  heart: {
    id: 'heart',
    name: 'Heart',
    family: 'brilliant',
    ratio: 1.0,
    ratioRange: [0.9, 1.15],
    proportions: fancyBrilliant(),
    girdleSubdiv: 8,
    prongs4: [270, 30, 150, 90],
    prongs6: [270, 20, 160, 90, 220, 320],
  },
};

export const CUT_ORDER: CutId[] = [
  'round',
  'oval',
  'cushion',
  'princess',
  'emerald',
  'radiant',
  'asscher',
  'pear',
  'marquise',
  'heart',
];

export function isStep(p: BrilliantProportions | StepProportions): p is StepProportions {
  return (p as StepProportions).crownSteps !== undefined;
}
