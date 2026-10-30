/**
 * Metal material for the live viewer: threepipe's PhysicalMaterial, so the
 * webgi screen-space reflections and AO apply to it. Kept apart from
 * metals.ts, which is plain data shared with the (Node) tests.
 */
import { PhysicalMaterial } from 'threepipe';
import { applyMetal, type MetalId } from './metals';

export function makeMetalMaterial(id: MetalId, finish: 'polished' | 'satin' = 'polished'): PhysicalMaterial {
  const mat = new PhysicalMaterial({ metalness: 1, envMapIntensity: 1 });
  applyMetal(mat, id, finish);
  return mat;
}
