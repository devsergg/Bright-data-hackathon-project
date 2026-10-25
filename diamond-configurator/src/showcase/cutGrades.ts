/**
 * Cut-quality presets. Shoppers choose a grade; the grade changes real facet
 * angles, and the live light analysis shows the consequence. The deltas walk
 * away from the ideal the way commercial cutting does: bigger tables, flatter
 * crowns, deeper pavilions and thicker girdles to save weight.
 */
import { CUTS, isStep } from '../gems/catalog';
import type { BrilliantProportions, CutId, Proportions, StepProportions } from '../gems/types';

export type CutGrade = 'ideal' | 'excellent' | 'very-good' | 'good';

export const CUT_GRADES: { id: CutGrade; label: string; note: string }[] = [
  { id: 'ideal', label: 'Ideal', note: 'Angles tuned for maximum light return.' },
  { id: 'excellent', label: 'Excellent', note: 'Within a hair of ideal. Hard to tell apart by eye.' },
  { id: 'very-good', label: 'Very Good', note: 'Flatter crown and larger table: a bit less fire.' },
  { id: 'good', label: 'Good', note: 'Cut deeper to keep weight. Noticeably darker areas.' },
];

const BRILLIANT: Record<CutGrade, Partial<Record<keyof BrilliantProportions, number>>> = {
  ideal: {},
  excellent: { tablePct: 1.5, crownAngle: 0.6, pavilionAngle: 0.3, girdlePct: 0.3 },
  'very-good': { tablePct: 4, crownAngle: -2.5, pavilionAngle: 0.9, girdlePct: 0.8 },
  good: { tablePct: 7, crownAngle: -4, pavilionAngle: 1.7, girdlePct: 1.3 },
};

const STEP: Record<CutGrade, Partial<Record<keyof StepProportions, number>>> = {
  ideal: {},
  excellent: { tablePct: 2, pavilionAngle: 1.2 },
  'very-good': { tablePct: 5, crownAngle: -3, pavilionAngle: 2.8, girdlePct: 0.8 },
  good: { tablePct: 8, crownAngle: -5, pavilionAngle: 4.5, girdlePct: 1.3 },
};

export function gradeProportions(cut: CutId, grade: CutGrade): Proportions {
  const p = CUTS[cut].proportions;
  const delta = (isStep(p) ? STEP : BRILLIANT)[grade] as Record<string, number>;
  const out = { ...p } as unknown as Record<string, number>;
  for (const [k, d] of Object.entries(delta)) out[k] = Math.round((out[k] + d) * 100) / 100;
  return out as unknown as Proportions;
}

/** Which grade the current proportions match, or 'custom' after manual edits. */
export function detectGrade(cut: CutId, p: Proportions): CutGrade | 'custom' {
  const key = JSON.stringify(p);
  for (const g of CUT_GRADES) if (JSON.stringify(gradeProportions(cut, g.id)) === key) return g.id;
  return 'custom';
}
