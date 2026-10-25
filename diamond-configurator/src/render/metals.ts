/**
 * Precious-metal PBR presets.
 *
 * `color` is the linear-space specular reflectance at normal incidence (F0),
 * which for metals IS the base colour in the metal/roughness model. Pure-metal
 * values are from measured optical constants (Naty Hoffman, "Physics and Math
 * of Shading", SIGGRAPH 2015); alloy values are interpolated approximations —
 * calibrate them against photos of your actual metal samples.
 */
import { Color, MeshPhysicalMaterial } from 'three';

export type MetalId =
  | 'platinum'
  | 'white-gold-14k'
  | 'yellow-gold-14k'
  | 'yellow-gold-18k'
  | 'rose-gold-14k'
  | 'palladium';

export interface MetalPreset {
  label: string;
  color: [number, number, number]; // linear F0
  roughness: number;
}

export const METALS: Record<MetalId, MetalPreset> = {
  platinum: { label: 'Platinum (950)', color: [0.673, 0.637, 0.585], roughness: 0.14 },
  // white gold is almost always rhodium plated — rhodium F0 ≈ 0.78
  'white-gold-14k': { label: '14k White Gold (rhodium)', color: [0.79, 0.78, 0.765], roughness: 0.12 },
  'yellow-gold-14k': { label: '14k Yellow Gold', color: [0.94, 0.74, 0.42], roughness: 0.13 },
  'yellow-gold-18k': { label: '18k Yellow Gold', color: [1.0, 0.766, 0.336], roughness: 0.12 },
  'rose-gold-14k': { label: '14k Rose Gold', color: [0.96, 0.64, 0.52], roughness: 0.13 },
  palladium: { label: 'Palladium (950)', color: [0.733, 0.697, 0.652], roughness: 0.15 },
};

export const METAL_ORDER: MetalId[] = [
  'platinum',
  'white-gold-14k',
  'yellow-gold-18k',
  'yellow-gold-14k',
  'rose-gold-14k',
  'palladium',
];

export function makeMetalMaterial(id: MetalId, finish: 'polished' | 'satin' = 'polished'): MeshPhysicalMaterial {
  const m = METALS[id];
  const mat = new MeshPhysicalMaterial({
    color: new Color().setRGB(...m.color),
    metalness: 1,
    roughness: finish === 'satin' ? 0.38 : m.roughness,
    envMapIntensity: 1,
  });
  mat.name = `metal:${id}`;
  return mat;
}

export function applyMetal(mat: MeshPhysicalMaterial, id: MetalId, finish: 'polished' | 'satin'): void {
  const m = METALS[id];
  mat.color.setRGB(...m.color);
  mat.roughness = finish === 'satin' ? 0.38 : m.roughness;
  mat.name = `metal:${id}`;
}
