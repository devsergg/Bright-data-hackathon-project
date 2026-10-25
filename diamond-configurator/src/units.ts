/**
 * Physical constants and unit conversions.
 *
 * Scene units are MILLIMETRES everywhere (geometry, camera, absorption
 * coefficients). Model in Rhino with the document unit set to millimetres.
 */

/** Diamond density, mg per mm³ (3.52 g/cm³). */
export const DIAMOND_DENSITY_MG_PER_MM3 = 3.52;
/** One metric carat in milligrams. */
export const MG_PER_CARAT = 200;

export function caratsFromVolume(volumeMm3: number): number {
  return (volumeMm3 * DIAMOND_DENSITY_MG_PER_MM3) / MG_PER_CARAT;
}

export function volumeFromCarats(carats: number): number {
  return (carats * MG_PER_CARAT) / DIAMOND_DENSITY_MG_PER_MM3;
}

/**
 * Refractive index of diamond from its Sellmeier equation
 * (Peter 1923, as tabulated by refractiveindex.info), valid 0.225–2.5 µm.
 *   n² = 1 + 4.3356 λ²/(λ² − 0.1060²) + 0.3306 λ²/(λ² − 0.1750²)
 */
export function diamondIOR(wavelengthNm: number): number {
  const l2 = (wavelengthNm / 1000) ** 2;
  const n2 = 1 + (4.3356 * l2) / (l2 - 0.106 ** 2) + (0.3306 * l2) / (l2 - 0.175 ** 2);
  return Math.sqrt(n2);
}

/** Representative wavelengths for the R, G and B render channels. */
export const CHANNEL_WAVELENGTHS_NM = { r: 640, g: 540, b: 460 } as const;

/** Sodium D-line refractive index (589.3 nm) — the textbook "2.417". */
export const DIAMOND_IOR_D = diamondIOR(589.3);

/**
 * Per-channel IOR. `dispersionScale` = 1 is physical; >1 exaggerates fire,
 * <1 softens it (useful for matching photography, which under-records fire).
 */
export function channelIORs(dispersionScale = 1): [number, number, number] {
  const g = diamondIOR(CHANNEL_WAVELENGTHS_NM.g);
  const r = g + (diamondIOR(CHANNEL_WAVELENGTHS_NM.r) - g) * dispersionScale;
  const b = g + (diamondIOR(CHANNEL_WAVELENGTHS_NM.b) - g) * dispersionScale;
  return [r, g, b];
}

/**
 * US/Canada ring size → inner diameter (mm).
 * Standard linear relation: d = 11.63 + 0.8128 × size (size 6 → 16.51 mm).
 */
export function usRingSizeToInnerDiameter(size: number): number {
  return 11.63 + 0.8128 * size;
}

/** ISO 8653 ring size is the inner circumference in millimetres. */
export function usRingSizeToISO(size: number): number {
  return Math.PI * usRingSizeToInnerDiameter(size);
}

export const deg = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
