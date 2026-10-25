/**
 * Body colour as Beer–Lambert absorption coefficients (mm⁻¹, linear R/G/B).
 *
 * Near-colourless grades: Cape-series yellow comes from N3 centres absorbing
 * violet/blue, so the blue coefficient dominates. These values are VISUAL
 * calibrations (a 1 ct stone's mean internal path is ~10–20 mm) — tune them
 * against reference photos of graded stones under the same lighting preset.
 */
export type ColorGrade =
  | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K'
  | 'fancy-yellow' | 'fancy-pink' | 'fancy-blue' | 'champagne' | 'black';

const cape = (blue: number): [number, number, number] => [blue * 0.04, blue * 0.3, blue];

export const COLOR_GRADES: Record<ColorGrade, { label: string; absorption: [number, number, number] }> = {
  D: { label: 'D — colourless', absorption: [0, 0, 0] },
  E: { label: 'E — colourless', absorption: cape(0.0015) },
  F: { label: 'F — colourless', absorption: cape(0.003) },
  G: { label: 'G — near colourless', absorption: cape(0.006) },
  H: { label: 'H — near colourless', absorption: cape(0.009) },
  I: { label: 'I — near colourless', absorption: cape(0.014) },
  J: { label: 'J — near colourless', absorption: cape(0.02) },
  K: { label: 'K — faint yellow', absorption: cape(0.03) },
  'fancy-yellow': { label: 'Fancy Intense Yellow', absorption: [0.002, 0.03, 0.22] },
  'fancy-pink': { label: 'Fancy Pink', absorption: [0.004, 0.09, 0.03] },
  'fancy-blue': { label: 'Fancy Blue', absorption: [0.11, 0.035, 0.004] },
  champagne: { label: 'Champagne', absorption: [0.02, 0.05, 0.11] },
  black: { label: 'Black', absorption: [2.5, 2.5, 2.5] },
};

export const COLOR_ORDER: ColorGrade[] = [
  'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
  'fancy-yellow', 'fancy-pink', 'fancy-blue', 'champagne', 'black',
];
